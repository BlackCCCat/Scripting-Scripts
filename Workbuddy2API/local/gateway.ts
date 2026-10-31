import { ChatUpstreamError, completeChat, type ChatRequest } from "./chat"
import { accounts, listenPort, modelCatalogNeedsRefresh, modelIds, serviceEnabled, setServiceEnabled } from "./store"
import { refreshModelCatalog, timeOrderedId } from "./upstream"
import { endServiceActivity, showServiceActivity } from "./serviceActivity"
import { clearPendingStop, markServiceHttpStopped, pendingStopId } from "./serviceControl"

const LAN = "wb2api.local.lan"
let server: HttpServer | null = null
let runId: string | null = null
let starting: Promise<void> | null = null
let stopping: Promise<void> | null = null
let refreshingBackground: Promise<void> | null = null
let keptAlive = false
let activityActive = false
let backgroundIssue = ""
let activityIssue = ""
let lastError = ""
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

export function subscribeGateway(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function lanEnabled(): boolean { return Storage.get<boolean>(LAN) === true }
export function setLanEnabled(value: boolean) {
  if (!Storage.set(LAN, value)) throw new Error("局域网设置保存失败")
  notify()
}

export function gatewayState() {
  return { running: server?.state === "running", port: server?.port ?? listenPort(), lan: lanEnabled(), keptAlive, activityActive, backgroundIssue, activityIssue, lastError }
}

export function currentServiceRunId(): string | null { return server?.state === "running" ? runId : null }

const serviceActivityState = (active: boolean) => ({ runId: runId ?? "", port: server?.port ?? listenPort(), lan: lanEnabled(), keptAlive: active })

async function refreshBackgroundService(): Promise<void> {
  if (refreshingBackground) return refreshingBackground
  const action = updateBackgroundService()
  refreshingBackground = action
  try { await action } finally { refreshingBackground = null }
}

async function updateBackgroundService(): Promise<void> {
  if (server?.state !== "running") return
  try {
    const requested = await BackgroundKeeper.keepAlive()
    const state = await BackgroundKeeper.getState()
    keptAlive = requested && state.requested && state.isActive
    backgroundIssue = keptAlive ? "" : state.lastFailure ?? "系统未启动后台保活"
  } catch (error) {
    keptAlive = false
    backgroundIssue = error instanceof Error ? error.message : String(error)
  }
  try {
    activityActive = await showServiceActivity(serviceActivityState(keptAlive))
    activityIssue = activityActive || !keptAlive ? "" : "系统未允许显示或活动已被移除"
  } catch (error) {
    activityActive = false
    activityIssue = error instanceof Error ? error.message : String(error)
  }
  notify()
}

function json(status: number, value: unknown): HttpResponse {
  const body = Data.fromRawString(JSON.stringify(value), "utf-8")
  if (!body) throw new Error("JSON 编码失败")
  return HttpResponse.raw(status, status === 200 ? "OK" : "Error", {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body,
  })
}

function bufferedStream(result: Record<string, unknown>, includeUsage: boolean): HttpResponse {
  const choice = (result.choices as any[])[0]
  const { role, ...message } = choice.message
  const base = { id: result.id, object: "chat.completion.chunk", created: result.created, model: result.model }
  const parts = [
    { ...base, choices: [{ index: 0, delta: { role, ...message }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] },
  ]
  if (includeUsage && result.usage) parts.push({ ...base, choices: [], usage: result.usage } as typeof parts[number])
  const body = Data.fromRawString(parts.map(part => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n", "utf-8")
  if (!body) throw new Error("SSE 编码失败")
  // shortcut: HttpServer 只接受完整 Data 响应，流式客户端会在上游完成后一次收到所有事件。
  return HttpResponse.raw(200, "OK", { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" }, body })
}

function apiError(status: number, message: string): HttpResponse {
  return json(status, { error: { message, type: status === 401 ? "authentication_error" : status >= 500 ? "api_error" : "invalid_request_error" } })
}

export async function startGateway(): Promise<void> {
  if (stopping) await stopping
  if (starting) return starting
  if (server?.state === "running") return
  const pending = pendingStopId()
  if (pending) clearPendingStop(pending)
  const action = openGateway()
  starting = action
  try { await action } finally { starting = null }
}

async function openGateway(): Promise<void> {
  const next = new HttpServer()
  next.listenAddressIPv4 = lanEnabled() ? "0.0.0.0" : "127.0.0.1"
  next.registerAsyncHandler("/v1/models", async request => {
    if (request.method !== "GET") return apiError(405, "仅支持 GET")
    try {
      if (accounts().some(item => item.enabled !== false) && modelCatalogNeedsRefresh()) await refreshModelCatalog()
      return json(200, { object: "list", data: modelIds().map(id => ({ id, object: "model", owned_by: id.startsWith("cn:") ? "Workbuddy" : "Workbuddy AI" })) })
    } catch (error) { return apiError(502, error instanceof Error ? error.message : String(error)) }
  })
  next.registerAsyncHandler("/v1/chat/completions", async request => {
    if (request.method !== "POST") return apiError(405, "仅支持 POST")
    let payload: ChatRequest
    try { payload = JSON.parse(request.body.toRawString("utf-8") ?? "") as ChatRequest }
    catch { return apiError(400, "请求体不是有效 JSON") }
    try {
      const result = await completeChat(payload)
      return payload.stream === true ? bufferedStream(result, (payload.stream_options as { include_usage?: boolean } | undefined)?.include_usage === true) : json(200, result)
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return apiError(msg.includes("没有可用账号") ? 503 : error instanceof ChatUpstreamError ? 502 : 400, msg)
    }
  })
  next.setNotFoundHandler(async () => apiError(404, "路径不存在"))
  const port = listenPort()
  const error = next.start({ forceIPv4: true, maxRequestBodySize: 8 * 1024 * 1024, port })
  if (error || next.port == null) {
    lastError = `端口 ${port}：${error || "未取得端口"}`
    notify()
    throw new Error(`HTTP 服务启动失败：${lastError}`)
  }
  try { setServiceEnabled(true) }
  catch (error) { next.stop(); throw error }
  server = next
  runId = timeOrderedId()
  lastError = ""
  await refreshBackgroundService()
}

export async function stopGateway(): Promise<void> {
  if (stopping) return stopping
  const action = closeGateway()
  stopping = action
  try { await action } finally { stopping = null }
}

async function closeGateway(): Promise<void> {
  if (starting) { try { await starting } catch { } }
  if (refreshingBackground) { try { await refreshingBackground } catch { } }
  let settingsError: unknown = null
  try { setServiceEnabled(false) } catch (error) { settingsError = error }
  const finalState = serviceActivityState(false)
  try { server?.stop() }
  finally {
    server = null
    if (runId) markServiceHttpStopped(runId)
    try {
      activityIssue = await endServiceActivity(finalState) ? "" : "实时活动未能结束，重新打开脚本时会重试"
    } catch (error) { activityIssue = error instanceof Error ? error.message : String(error) }
    try { await BackgroundKeeper.stopKeepAlive() }
    catch (error) { backgroundIssue = error instanceof Error ? error.message : String(error) }
    keptAlive = false
    activityActive = false
    runId = null
    notify()
    if (activityIssue) throw new Error(activityIssue)
    if (settingsError) throw settingsError
  }
}

export async function restoreGateway(): Promise<void> {
  if (stopping) { try { await stopping } catch { }; return }
  const pending = pendingStopId()
  if (pending) {
    try {
      if (server?.state === "running") await stopGateway()
      else setServiceEnabled(false)
      clearPendingStop(pending)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      notify()
      return
    }
  }
  if (!serviceEnabled()) {
    if (server?.state === "running" || keptAlive) {
      try { await stopGateway() }
      catch (error) { activityIssue = error instanceof Error ? error.message : String(error); notify() }
      return
    }
    try { activityIssue = await endServiceActivity(serviceActivityState(false)) ? "" : "实时活动未能结束" }
    catch (error) { activityIssue = error instanceof Error ? error.message : String(error) }
    notify()
    return
  }
  try {
    if (server?.state === "running") await refreshBackgroundService()
    else await startGateway()
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    try { await endServiceActivity(serviceActivityState(false)) } catch { }
    notify()
  }
}
