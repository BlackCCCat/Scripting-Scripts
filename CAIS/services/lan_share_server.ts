import { Device, Path, Script, fetch } from "scripting"
import type { CaisSettings, ClipGroup, ClipItem, ClipListScope } from "../types"
import {
  addClipFromPayload,
  addFavoriteFromInput,
  editClipContent,
  getClipById,
  getClipCounts,
  getClipGroups,
  getFullClipContent,
  updateClipTitle,
} from "../storage/clip_repository"
import { bumpClipDataVersion, readClipDataVersion, subscribeClipDataChanges } from "../storage/change_signal"
import { initializeDatabase, readDatabaseDataVersion } from "../storage/database"
import { imagePreviewPath } from "../storage/image_store"
import { loadSettings } from "../storage/settings_store"
import { getLanShareAccessToken } from "./lan_share_credentials"
import { imageFromUploadRequest, MAX_LAN_IMAGE_UPLOAD_BYTES } from "./lan_share_image_upload"

const MAX_REQUEST_BODY_SIZE = MAX_LAN_IMAGE_UPLOAD_BYTES + 256 * 1024
const MAX_TEXT_LENGTH = 500_000
const MAX_TITLE_LENGTH = 160
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_REQUESTS = 600
const VERSION_POLL_INTERVAL_MS = 700

export type LanShareRuntimeState = "stopped" | "starting" | "running" | "delegated" | "error"

export type LanShareRuntimeStatus = {
  state: LanShareRuntimeState
  port: number
  address?: string
  accessUrl?: string
  accessCode: string
  message: string
}

type RateEntry = { count: number; resetAt: number }

let server: HttpServer | null = null
let serverPort: number | null = null
let versionTimer: any = null
let lastBroadcastVersion = 0
let lastDatabaseDataVersion: number | null = null
let checkingDatabaseDataVersion = false
let unsubscribeDataChanges: (() => void) | null = null
let activeAccessToken = ""
let sessions: WebSocketSession[] = []
let reconcileQueue: Promise<LanShareRuntimeStatus> = Promise.resolve({
  state: "stopped",
  port: 8787,
  accessCode: "",
  message: "局域网共享已关闭",
})
let runtimeStatus: LanShareRuntimeStatus = {
  state: "stopped",
  port: 8787,
  accessCode: "",
  message: "局域网共享已关闭",
}
let writeQueue: Promise<void> = Promise.resolve()
let lastStartAttemptAt = 0
const rateEntries = new Map<string, RateEntry>()
const assetCache = new Map<string, Data>()

function dataFromString(value: string): Data {
  const data = Data.fromRawString(value || " ", "utf-8")
  if (!data) throw new Error("响应编码失败")
  return data
}

function rawResponse(
  statusCode: number,
  phrase: string,
  body: string,
  contentType: string,
  headers: Record<string, string> = {}
): HttpResponse {
  return HttpResponse.raw(statusCode, phrase, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
    body: dataFromString(body),
  })
}

function jsonResponse(value: unknown, statusCode = 200, phrase = "OK"): HttpResponse {
  return rawResponse(statusCode, phrase, JSON.stringify(value), "application/json; charset=utf-8")
}

function errorResponse(statusCode: number, message: string): HttpResponse {
  const phrase = statusCode === 400 ? "Bad Request"
    : statusCode === 401 ? "Unauthorized"
      : statusCode === 404 ? "Not Found"
        : statusCode === 405 ? "Method Not Allowed"
          : statusCode === 409 ? "Conflict"
            : statusCode === 429 ? "Too Many Requests"
              : "Internal Server Error"
  return jsonResponse({ error: message }, statusCode, phrase)
}

function header(request: HttpRequest, name: string): string {
  const expected = name.toLowerCase()
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() === expected) return String(value)
  }
  return ""
}

function queryValue(request: HttpRequest, key: string): string {
  return request.queryParams.find((item) => item.key === key)?.value ?? ""
}

function requestToken(request: HttpRequest): string {
  return (header(request, "x-cais-token") || queryValue(request, "token")).trim().toUpperCase()
}

function isPublicAsset(path: string): boolean {
  return path === "/" || path === "/assets/app.css" || path === "/assets/app.js" || path === "/favicon.ico"
}

function rateLimitResponse(request: HttpRequest): HttpResponse | null {
  const now = Date.now()
  const key = request.address || "unknown"
  const current = rateEntries.get(key)
  if (!current || current.resetAt <= now) {
    rateEntries.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return null
  }
  current.count += 1
  if (current.count > RATE_LIMIT_REQUESTS) return errorResponse(429, "请求过于频繁，请稍后再试")
  return null
}

function privateIPv4Address(): string | undefined {
  let interfaces: Record<string, Device.NetworkInterface[]>
  try {
    interfaces = Device.networkInterfaces?.() ?? {}
  } catch {
    return undefined
  }
  const values = Object.entries(interfaces)
    .sort(([left], [right]) => (left === "en0" ? -1 : right === "en0" ? 1 : left.localeCompare(right)))
    .flatMap(([, entries]) => entries)
  const ipv4 = values.filter((entry) => entry.family === "IPv4" && !entry.isInternal)
  const privateAddress = ipv4.find((entry) => {
    const address = entry.address
    if (/^10\./.test(address) || /^192\.168\./.test(address)) return true
    const match = address.match(/^172\.(\d+)\./)
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
  })
  return privateAddress?.address ?? ipv4[0]?.address
}

function statusFor(state: LanShareRuntimeState, port: number, message: string): LanShareRuntimeStatus {
  const address = privateIPv4Address()
  const baseUrl = address ? `http://${address}:${port}` : undefined
  const available = state === "running" || state === "delegated"
  return {
    state,
    port,
    address: baseUrl,
    accessUrl: available && baseUrl ? `${baseUrl}/?token=${encodeURIComponent(getLanShareAccessToken())}` : undefined,
    accessCode: getLanShareAccessToken(),
    message,
  }
}

function setRuntimeStatus(next: LanShareRuntimeStatus): LanShareRuntimeStatus {
  runtimeStatus = next
  return next
}

function parseJsonBody(request: HttpRequest): any {
  const raw = request.body?.toRawString?.("utf-8") ?? ""
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error("请求内容不是有效的 JSON")
  }
}

function requireMethod(request: HttpRequest, method: string): HttpResponse | null {
  return request.method.toUpperCase() === method ? null : errorResponse(405, `请使用 ${method} 请求`)
}

function validItemId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,160}$/.test(id)
}

function webItem(item: ClipItem) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    content: item.kind === "image" ? "" : item.content,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    pinned: item.pinned,
    favorite: item.favorite,
    manualFavorite: Boolean(item.manualFavorite),
    hasImage: item.kind === "image" && Boolean(item.imagePath),
  }
}

function webGroups(groups: ClipGroup[]) {
  return groups.map((group) => ({
    title: group.title,
    items: group.items.map(webItem),
  }))
}

function notifyDataChanged(version = readClipDataVersion()): void {
  if (version <= lastBroadcastVersion) return
  lastBroadcastVersion = version
  const message = JSON.stringify({ type: "dataChanged", version })
  sessions = sessions.filter((session) => {
    try {
      session.writeText(message)
      return true
    } catch {
      return false
    }
  })
}

function startVersionBroadcasting(): void {
  stopVersionBroadcasting()
  lastBroadcastVersion = readClipDataVersion()
  unsubscribeDataChanges = subscribeClipDataChanges(notifyDataChanged)
  void readDatabaseDataVersion().then((version) => {
    lastDatabaseDataVersion = version
  }).catch(() => {})
  activeAccessToken = getLanShareAccessToken()
  versionTimer = (globalThis as any).setInterval?.(() => {
    const accessToken = getLanShareAccessToken()
    if (accessToken !== activeAccessToken) {
      activeAccessToken = accessToken
      sessions.forEach((session) => {
        try { session.close() } catch {}
      })
      sessions = []
    }
    if (!checkingDatabaseDataVersion) {
      checkingDatabaseDataVersion = true
      void readDatabaseDataVersion().then((databaseVersion) => {
        if (lastDatabaseDataVersion != null && databaseVersion !== lastDatabaseDataVersion) {
          lastDatabaseDataVersion = databaseVersion
          bumpClipDataVersion()
        } else {
          lastDatabaseDataVersion = databaseVersion
        }
      }).catch(() => {}).finally(() => {
        checkingDatabaseDataVersion = false
      })
    }
  }, VERSION_POLL_INTERVAL_MS)
}

function stopVersionBroadcasting(): void {
  if (versionTimer) (globalThis as any).clearInterval?.(versionTimer)
  versionTimer = null
  unsubscribeDataChanges?.()
  unsubscribeDataChanges = null
  activeAccessToken = ""
  lastDatabaseDataVersion = null
  checkingDatabaseDataVersion = false
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation)
  writeQueue = result.then(() => undefined, () => undefined)
  return result
}

function assetData(fileName: string): Data | null {
  const cached = assetCache.get(fileName)
  if (cached) return cached
  const path = Path.join(Script.directory, "web", fileName)
  const data = Data.fromFile(path)
  if (data) assetCache.set(fileName, data)
  return data
}

function assetResponse(fileName: string, contentType: string, html = false): HttpResponse {
  const data = assetData(fileName)
  if (!data) return errorResponse(404, "网页资源不存在")
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }
  if (html) {
    headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self' ws:; base-uri 'none'; frame-ancestors 'none'"
    headers["Referrer-Policy"] = "no-referrer"
  }
  return HttpResponse.raw(200, "OK", { headers, body: data })
}

async function imageResponse(id: string, original = false, download = false): Promise<HttpResponse> {
  const item = await getClipById(id)
  if (!item?.imagePath || item.kind !== "image") return errorResponse(404, "图片不存在")
  const path = original ? item.imagePath : imagePreviewPath(item.imagePath) ?? item.imagePath
  const fm = (globalThis as any).FileManager
  try {
    if (
      typeof fm?.isFileStoredIniCloud === "function" &&
      typeof fm?.isiCloudFileDownloaded === "function" &&
      typeof fm?.downloadFileFromiCloud === "function" &&
      fm.isFileStoredIniCloud(path) &&
      !fm.isiCloudFileDownloaded(path)
    ) {
      await fm.downloadFileFromiCloud(path)
    }
  } catch {
  }
  const data = Data.fromFile(path)
  if (!data) return errorResponse(404, "图片文件不可读取")
  const lower = path.toLowerCase()
  const contentType = lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : "image/png"
  return HttpResponse.raw(200, "OK", {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": download ? "no-store" : "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      ...(download ? { "Content-Disposition": `attachment; filename="CAIS-${id}.${contentType === "image/jpeg" ? "jpg" : "png"}"` } : {}),
    },
    body: data,
  })
}

function registerRoutes(nextServer: HttpServer): void {
  nextServer.registerMiddleware(async (request) => {
    const limited = rateLimitResponse(request)
    if (limited) return limited
    if (isPublicAsset(request.path)) return null
    if (requestToken(request) !== getLanShareAccessToken()) return errorResponse(401, "访问码无效")
    return null
  })

  nextServer.registerAsyncHandler("/", async (request) => {
    const invalid = requireMethod(request, "GET")
    return invalid ?? assetResponse("lan_share.html", "text/html; charset=utf-8", true)
  })
  nextServer.registerAsyncHandler("/assets/app.css", async (request) => {
    const invalid = requireMethod(request, "GET")
    return invalid ?? assetResponse("lan_share.css", "text/css; charset=utf-8")
  })
  nextServer.registerAsyncHandler("/assets/app.js", async (request) => {
    const invalid = requireMethod(request, "GET")
    return invalid ?? assetResponse("lan_share.js", "text/javascript; charset=utf-8")
  })
  nextServer.registerAsyncHandler("/favicon.ico", async () => HttpResponse.raw(204, "No Content"))

  nextServer.registerAsyncHandler("/api/health", async (request) => {
    const invalid = requireMethod(request, "GET")
    return invalid ?? jsonResponse({ service: "CAIS", version: 1, port: serverPort })
  })
  nextServer.registerAsyncHandler("/api/items", async (request) => {
    if (request.method.toUpperCase() === "GET") {
      const scope: ClipListScope = queryValue(request, "scope") === "favorites" ? "favorites" : "clipboard"
      const search = queryValue(request, "query").slice(0, 200)
      const limit = Math.max(1, Math.min(100, Number(queryValue(request, "limit")) || 40))
      const offset = Math.max(0, Number(queryValue(request, "offset")) || 0)
      const groups = await getClipGroups(scope, search, limit, offset)
      const counts = await getClipCounts()
      return jsonResponse({
        groups: webGroups(groups),
        counts,
        limit,
        offset,
        hasMore: groups.some((group) => group.items.length >= limit),
        capabilities: { imageUpload: loadSettings().captureImages },
        version: readClipDataVersion(),
      })
    }
    if (request.method.toUpperCase() !== "POST") return errorResponse(405, "请使用 GET 或 POST 请求")
    try {
      const body = parseJsonBody(request)
      const content = String(body.content ?? "")
      const title = String(body.title ?? "").slice(0, MAX_TITLE_LENGTH)
      const scope: ClipListScope = body.scope === "favorites" ? "favorites" : "clipboard"
      if (!content.trim()) return errorResponse(400, "内容不能为空")
      if (content.length > MAX_TEXT_LENGTH) return errorResponse(400, "内容过长")
      const item = await enqueueWrite(async () => {
        if (scope === "favorites") return addFavoriteFromInput(title, content)
        const settings = loadSettings()
        const result = await addClipFromPayload(
          { kind: "text", text: content },
          { ...settings, captureText: true }
        )
        if (result.status === "skipped") throw new Error(result.reason)
        return title.trim() ? updateClipTitle(result.item, title) : result.item
      })
      return jsonResponse({ item: webItem(item) }, 201, "Created")
    } catch (error: any) {
      const message = String(error?.message ?? error ?? "保存失败")
      return errorResponse(message.includes("重复") ? 409 : 400, message)
    }
  })

  nextServer.registerAsyncHandler("/api/items/:id/content", async (request) => {
    const id = String(request.params.id ?? "")
    if (!validItemId(id)) return errorResponse(400, "条目标识无效")
    if (request.method.toUpperCase() === "GET") {
      const item = await getClipById(id)
      if (!item) return errorResponse(404, "条目不存在")
      return jsonResponse({ item: webItem(item), content: await getFullClipContent(id) })
    }
    if (request.method.toUpperCase() !== "PATCH") return errorResponse(405, "请使用 GET 或 PATCH 请求")
    try {
      const body = parseJsonBody(request)
      const content = String(body.content ?? "")
      if (!content.trim()) return errorResponse(400, "内容不能为空")
      if (content.length > MAX_TEXT_LENGTH) return errorResponse(400, "内容过长")
      const item = await enqueueWrite(async () => {
        const current = await getClipById(id)
        if (!current) throw new Error("条目不存在")
        if (current.kind === "image") throw new Error("图片条目只能修改标题")
        return editClipContent(current, content)
      })
      return jsonResponse({ item: webItem(item) })
    } catch (error: any) {
      const message = String(error?.message ?? error ?? "修改失败")
      return errorResponse(message === "条目不存在" ? 404 : 400, message)
    }
  })

  nextServer.registerAsyncHandler("/api/items/:id/title", async (request) => {
    const invalid = requireMethod(request, "PATCH")
    if (invalid) return invalid
    const id = String(request.params.id ?? "")
    if (!validItemId(id)) return errorResponse(400, "条目标识无效")
    try {
      const body = parseJsonBody(request)
      const title = String(body.title ?? "")
      if (title.length > MAX_TITLE_LENGTH) return errorResponse(400, "标题过长")
      const item = await enqueueWrite(async () => {
        const current = await getClipById(id)
        if (!current) throw new Error("条目不存在")
        return updateClipTitle(current, title)
      })
      return jsonResponse({ item: webItem(item) })
    } catch (error: any) {
      const message = String(error?.message ?? error ?? "标题保存失败")
      return errorResponse(message === "条目不存在" ? 404 : 400, message)
    }
  })

  nextServer.registerAsyncHandler("/api/items/:id/image", async (request) => {
    const invalid = requireMethod(request, "GET")
    if (invalid) return invalid
    const id = String(request.params.id ?? "")
    if (!validItemId(id)) return errorResponse(400, "条目标识无效")
    const download = queryValue(request, "download") === "1"
    const original = download || queryValue(request, "original") === "1"
    return imageResponse(id, original, download)
  })

  nextServer.registerAsyncHandler("/api/images", async (request) => {
    const invalid = requireMethod(request, "POST")
    if (invalid) return invalid
    try {
      const settings = loadSettings()
      if (!settings.captureImages) return errorResponse(403, "图片采集未开启")
      const image = imageFromUploadRequest(request)
      const result = await enqueueWrite(() => addClipFromPayload({ kind: "image", image }, settings))
      if (result.status === "skipped") throw new Error(result.reason)
      return jsonResponse({ item: webItem(result.item) }, 201, "Created")
    } catch (error: any) {
      const message = String(error?.message ?? error ?? "图片保存失败")
      return errorResponse(message.includes("重复") ? 409 : 400, message)
    }
  })

  nextServer.registerWebsocket("/ws", {
    onConnected: (session) => {
      sessions.push(session)
      try {
        session.writeText(JSON.stringify({ type: "connected", version: readClipDataVersion() }))
      } catch {
      }
    },
    onDisconnected: (session) => {
      sessions = sessions.filter((item) => item !== session)
    },
  })

  nextServer.setNotFoundHandler(async () => errorResponse(404, "接口不存在"))
}

async function probeExistingServer(port: number): Promise<boolean> {
  const request = fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: { "X-CAIS-Token": getLanShareAccessToken() },
  }).then(async (response) => {
    if (!response.ok) return false
    const value = await response.json() as any
    return value?.service === "CAIS"
  }).catch(() => false)
  let timer: any
  const timeout = new Promise<boolean>((resolve) => {
    timer = (globalThis as any).setTimeout?.(() => resolve(false), 700)
  })
  const result = await Promise.race([request, timeout])
  if (timer) (globalThis as any).clearTimeout?.(timer)
  return result
}

function stopOwnedServer(): void {
  stopVersionBroadcasting()
  sessions.forEach((session) => {
    try { session.close() } catch {}
  })
  sessions = []
  try { server?.stop() } catch {}
  server = null
  serverPort = null
}

async function applyDesiredState(settings: CaisSettings): Promise<LanShareRuntimeStatus> {
  const port = settings.lanSharingPort
  if (!settings.lanSharingEnabled) {
    stopOwnedServer()
    return setRuntimeStatus(statusFor("stopped", port, "局域网共享已关闭"))
  }

  if (server?.state === "running" && serverPort === port) {
    return setRuntimeStatus(statusFor("running", port, "服务正在运行"))
  }

  const retryDelay = runtimeStatus.state === "delegated" ? 3000 : runtimeStatus.state === "error" ? 5000 : 0
  if (runtimeStatus.port === port && retryDelay > 0 && Date.now() - lastStartAttemptAt < retryDelay) {
    return statusFor(runtimeStatus.state, port, runtimeStatus.message)
  }

  if (server) stopOwnedServer()
  lastStartAttemptAt = Date.now()
  setRuntimeStatus(statusFor("starting", port, "正在启动局域网服务"))
  const ServerClass = (globalThis as any).HttpServer
  if (typeof ServerClass !== "function") {
    return setRuntimeStatus(statusFor("error", port, "当前 Scripting 版本不支持局域网服务"))
  }
  let nextServer: HttpServer
  let error: string | null
  try {
    await initializeDatabase()
    nextServer = new ServerClass() as HttpServer
    registerRoutes(nextServer)
    error = nextServer.start({
      port,
      forceIPv4: true,
      maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
      maxWebSocketPayloadSize: 32 * 1024,
    })
  } catch (caught: any) {
    return setRuntimeStatus(statusFor("error", port, `启动失败：${String(caught?.message ?? caught ?? "未知错误")}`))
  }
  if (error) {
    const delegated = await probeExistingServer(port)
    if (delegated) {
      return setRuntimeStatus(statusFor("delegated", port, "服务由另一个 CAIS 窗口提供"))
    }
    return setRuntimeStatus(statusFor("error", port, `启动失败：${error}`))
  }
  server = nextServer
  serverPort = nextServer.port ?? port
  startVersionBroadcasting()
  return setRuntimeStatus(statusFor("running", serverPort, "服务正在运行"))
}

export function reconcileLanShareServer(settings: CaisSettings): Promise<LanShareRuntimeStatus> {
  reconcileQueue = reconcileQueue.then(
    () => applyDesiredState(settings),
    () => applyDesiredState(settings)
  )
  return reconcileQueue
}

export function getLanShareRuntimeStatus(settings = loadSettings()): LanShareRuntimeStatus {
  if (!settings.lanSharingEnabled && runtimeStatus.state !== "stopped") {
    return statusFor("stopped", settings.lanSharingPort, "局域网共享已关闭")
  }
  if (runtimeStatus.port !== settings.lanSharingPort) {
    return statusFor(settings.lanSharingEnabled ? "starting" : "stopped", settings.lanSharingPort, settings.lanSharingEnabled ? "等待服务启动" : "局域网共享已关闭")
  }
  return statusFor(runtimeStatus.state, runtimeStatus.port, runtimeStatus.message)
}

export function releaseLanShareServer(): void {
  stopOwnedServer()
  setRuntimeStatus(statusFor("stopped", runtimeStatus.port, "局域网共享已关闭"))
}
