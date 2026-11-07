import { ChatUpstreamError, completeChat, streamChat, type ChatRequest } from "./chat"
import { accountRotationEnabled, accounts, addressHost, fixedAccountUid, listenPort, modelCatalog, modelCatalogNeedsRefresh, modelIds, serviceEnabled, setServiceEnabled } from "./store"
import { refreshModelCatalog, timeOrderedId } from "./upstream"
import { endServiceActivity, showServiceActivity } from "./serviceActivity"
import { clearPendingStop, pendingStopId } from "./serviceControl"
import { HttpReply, RawHttpServer, type HttpInput } from "./rawHttp"
import { beginDiagnosticRun, endDiagnosticRun } from "./diagnostics"

const LAN = "wb2api.local.lan"
let server: RawHttpServer | null = null
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
let catalogRefresh: Promise<unknown> | null = null
function ensureModelCatalog(): Promise<unknown> {
  if (!catalogRefresh) catalogRefresh = refreshModelCatalog().finally(() => { catalogRefresh = null })
  return catalogRefresh
}

export function subscribeGateway(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function lanEnabled(): boolean { return Storage.get<boolean>(LAN) === true }
export function setLanEnabled(value: boolean) {
  if (!Storage.set(LAN, value)) throw new Error("局域网设置保存失败")
  notify()
}

export function serviceDefaultHost(): string {
  if (!lanEnabled()) return "127.0.0.1"
  const interfaces = Device.networkInterfaces()
  const addresses = Object.entries(interfaces).flatMap(([name, items]) => items.filter(item => item.family === "IPv4" && !item.isInternal).map(item => ({ name, address: item.address })))
  return addresses.find(item => item.name === "en0")?.address ?? addresses[0]?.address ?? "<本机局域网 IP>"
}

export function serviceAddress(): string {
  return `http://${addressHost(serviceDefaultHost())}:${gatewayState().port}`
}

export function gatewayState() {
  return { running: server?.running === true, port: server?.port ?? listenPort(), lan: lanEnabled(), keptAlive, activityActive, backgroundIssue, activityIssue, lastError }
}

export function currentServiceRunId(): string | null { return server?.running ? runId : null }

const serviceActivityState = (active: boolean) => ({ runId: runId ?? "", port: server?.port ?? listenPort(), lan: lanEnabled(), keptAlive: active })

async function refreshBackgroundService(): Promise<void> {
  if (refreshingBackground) return refreshingBackground
  const action = updateBackgroundService()
  refreshingBackground = action
  try { await action } finally { refreshingBackground = null }
}

async function updateBackgroundService(): Promise<void> {
  if (!server?.running) return
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

const errorBody = (status: number, message: string) => ({ error: { message, type: status === 401 ? "authentication_error" : status >= 500 ? "api_error" : "invalid_request_error" } })

async function handleApi(request: HttpInput, reply: HttpReply): Promise<void> {
  const trace = reply.trace
  if (request.path === "/v1/models") {
    if (request.method !== "GET") return reply.json(405, errorBody(405, "仅支持 GET"))
    try {
      trace?.mark("models.lookup")
      if (accounts().some(item => item.enabled !== false) && modelCatalogNeedsRefresh()) {
        try { await ensureModelCatalog() }
        catch (error) { trace?.fail("models.refresh", error); if (!modelCatalog().length) throw error }
      }
      const ids = modelIds(accountRotationEnabled() ? undefined : fixedAccountUid())
      trace?.mark("models.ready", { count: ids.length })
      return reply.json(200, { object: "list", data: ids.map(id => ({ id, object: "model", owned_by: id.startsWith("cn:") ? "Workbuddy" : "Workbuddy AI" })) })
    } catch (error) { trace?.fail("models.error", error); return reply.json(502, errorBody(502, error instanceof Error ? error.message : String(error))) }
  }
  if (request.path !== "/v1/chat/completions") return reply.json(404, errorBody(404, "路径不存在"))
  if (request.method !== "POST") return reply.json(405, errorBody(405, "仅支持 POST"))
  let payload: ChatRequest
  try { payload = JSON.parse(request.body) as ChatRequest }
  catch (error) { trace?.fail("chat.invalid_json", error); return reply.json(400, errorBody(400, "请求体不是有效 JSON")) }
  trace?.setChat(typeof payload?.model === "string" ? payload.model : "", payload?.stream === true)
  try {
    if (payload.stream === true) {
      await reply.startEvents()
      let heartbeatCount = 0
      const heartbeat = setInterval(() => {
        if (!reply.signal.aborted) void reply.comment()
          .then(() => trace?.mark("downstream.heartbeat", { count: ++heartbeatCount }))
          .catch(error => { if (!(error instanceof Error) || error.message !== "事件流已结束") trace?.fail("downstream.heartbeat", error) })
      }, 15_000)
      try { await streamChat(payload, event => reply.event(event), reply.signal, trace) }
      finally { clearInterval(heartbeat) }
      await reply.endEvents()
    } else await reply.json(200, await completeChat(payload, undefined, "main", trace, reply.signal))
  } catch (error) {
    trace?.fail("gateway.error", error)
    if (reply.signal.aborted) return
    const message = error instanceof Error ? error.message : String(error)
    if (reply.headersSent) {
      await reply.event(errorBody(502, message))
      await reply.endEvents("error")
    } else {
      const status = message.includes("没有可用账号") ? 503 : error instanceof ChatUpstreamError ? 502 : 400
      await reply.json(status, errorBody(status, message))
    }
  }
}

export async function startGateway(): Promise<void> {
  if (stopping) await stopping
  if (starting) return starting
  if (server?.running) return
  const pending = pendingStopId()
  if (pending) clearPendingStop(pending)
  const action = openGateway()
  starting = action
  try { await action } finally { starting = null }
}

async function openGateway(): Promise<void> {
  const next = new RawHttpServer(handleApi)
  const port = listenPort()
  try { await next.start(port, lanEnabled()) }
  catch (error) {
    lastError = `端口 ${port}：${error instanceof Error ? error.message : String(error)}`
    notify()
    throw new Error(`HTTP 服务启动失败：${lastError}`)
  }
  try { setServiceEnabled(true) }
  catch (error) { await next.stop(); throw error }
  server = next
  runId = timeOrderedId()
  await beginDiagnosticRun(port, lanEnabled())
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
  try { await server?.stop() }
  finally {
    await endDiagnosticRun()
    server = null
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
      if (server?.running) await stopGateway()
      else setServiceEnabled(false)
      clearPendingStop(pending)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      notify()
      return
    }
  }
  if (!serviceEnabled()) {
    if (server?.running || keptAlive) {
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
    if (server?.running) await refreshBackgroundService()
    else await startGateway()
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    try { await endServiceActivity(serviceActivityState(false)) } catch { }
    notify()
  }
}
