export type DiagnosticFields = Record<string, string | number | boolean>
export type DiagnosticEvent = { at: number; stage: string; fields?: DiagnosticFields }
export type DiagnosticRequest = {
  id: string
  at: number
  method?: string
  path?: string
  model?: string
  stream?: boolean
  status?: number
  outcome?: "ok" | "error" | "closed" | "untracked"
  events: DiagnosticEvent[]
  droppedEvents: number
}
export type DiagnosticRun = {
  startedAt: number
  endedAt?: number
  port: number
  lan: boolean
  requests: DiagnosticRequest[]
  droppedRequests: number
  saveFailed?: boolean
}

const RUN_KEY = "wb2api.local.diagnostic-run"
const ENABLED_KEY = "wb2api.local.diagnostics-enabled"
const FILE_NAME = "WorkBuddy2API-HTTP-Diagnostics.log"
const LEGACY_FILE_NAME = "WorkBuddy2API-HTTP-Diagnostics.jsonl"
const MAX_REQUESTS = 200
const MAX_EVENTS = 80
const listeners = new Set<() => void>()
let active = false
let current: DiagnosticRun | null = null
let sequence = 0
let fileQueue: Promise<void> = Promise.resolve()
let fileReady: boolean | null = null
let pendingLines: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
const logPath = () => `${FileManager.documentsDirectory}/${FILE_NAME}`
const legacyPath = () => `${FileManager.documentsDirectory}/${LEGACY_FILE_NAME}`

export const diagnosticStageNames: Record<string, string> = {
  "socket.accepted": "客户端已连接", "socket.closed": "客户端连接关闭", "socket.error": "客户端连接错误",
  "http.headers": "已读取请求头", "http.body": "已读取请求体", "http.parse": "请求解析失败", "http.finish": "请求结束",
  "chat.validated": "聊天请求已识别", "chat.invalid_json": "请求 JSON 无效", "chat.attempt_failed": "账号请求失败",
  "models.lookup": "查询模型", "models.ready": "模型列表已生成", "models.error": "模型查询失败",
  "route.candidates": "筛选账号", "route.selected": "选用账号", "route.failure": "换号决策",
  "credential.check": "检查账号凭据", "credential.ready": "凭据就绪",
  "upstream.send": "发送上游请求", "upstream.connect": "连接上游失败", "upstream.headers": "收到上游响应头",
  "upstream.error_body": "读取上游错误失败", "upstream.body": "已读取上游响应", "upstream.first_event": "收到首个生成事件",
  "upstream.thinking_started": "开始生成思考", "upstream.answer_started": "开始生成回答", "upstream.waiting": "等待上游后续数据",
  "upstream.progress": "生成进度", "upstream.done": "上游正常结束", "upstream.missing_done": "上游缺少结束标记",
  "upstream.completed": "上游结果已解析", "upstream.usage": "Token 用量", "upstream.interrupted": "中断时的生成量", "upstream.read": "读取上游响应失败",
  "upstream.parse": "上游事件格式错误", "upstream.event_error": "上游返回错误事件", "upstream.decode": "上游解码失败", "upstream.aggregate": "聚合上游响应失败",
  "downstream.headers": "已发送客户端响应头", "downstream.completed": "客户端响应写完", "downstream.heartbeat": "已发送流式心跳", "downstream.event": "客户端事件写入失败", "downstream.write": "客户端连接写入失败",
  "socket.idle_timeout": "本机连接空闲超时", "gateway.error": "接口返回错误", "gateway.unhandled": "服务内部错误",
  "client.aborted": "客户端已断开", "service.stopped": "HTTP 服务已关闭", "logging.disabled": "日志记录已关闭",
}

const fieldNames: Record<string, string> = {
  status: "HTTP 状态", bodyBytes: "响应体字节", bytesWritten: "已发客户端字节", bytesRead: "已收上游字节",
  bytes: "字节", requestBytes: "上游请求字节", count: "数量", events: "生成事件", attempt: "第几次尝试",
  account: "脱敏账号", site: "账号区域", uidSuffix: "UID 尾号", bound: "命中会话绑定", rotation: "账号轮询", thinking: "开启推理",
  reasoningChars: "思考字符", answerChars: "回答字符", stream: "流式", durationMs: "耗时毫秒",
  elapsedMs: "已耗时毫秒", idleMs: "未收到数据毫秒", thinkingDurationMs: "思考持续毫秒", phase: "当前阶段",
  totalTokens: "总 Token", promptTokens: "输入 Token", completionTokens: "输出 Token", cacheHitTokens: "缓存命中 Token",
  code: "错误码", upstreamCode: "上游业务码", name: "错误类型", message: "错误说明", outcome: "结果",
  retryable: "上游允许换号", willRetry: "本次实际换号", emitted: "已向客户端发出内容", aborted: "客户端已断开",
  method: "方法", path: "路径", model: "模型", port: "端口", lan: "局域网监听", enabled: "日志开启", summary: "结论",
}

export const diagnosticOutcomeName = (value?: string) => ({ ok: "成功", error: "失败", closed: "连接关闭", untracked: "记录已暂停" } as Record<string, string>)[value ?? ""] ?? "进行中"
export const diagnosticStageName = (stage: string) => diagnosticStageNames[stage] ?? stage
export function diagnosticFieldsText(fields?: DiagnosticFields): string {
  return fields ? Object.entries(fields).map(([key, value]) => `${fieldNames[key] ?? key}=${typeof value === "boolean" ? value ? "是" : "否" : value}`).join(" · ") : ""
}
export function diagnosticFailure(request: DiagnosticRequest): string {
  if (request.outcome !== "error" && request.outcome !== "closed") return ""
  const interrupted = request.events.findLast(item => item.stage === "upstream.interrupted")?.fields
  const progress = interrupted ? `（中断前：思考 ${interrupted.reasoningChars ?? 0} 字符，回答 ${interrupted.answerChars ?? 0} 字符，接收 ${interrupted.bytesRead ?? 0} 字节）` : ""
  const errors = request.events.filter(event => event.fields?.name || event.fields?.upstreamCode)
  const event = errors.findLast(item => item.stage !== "gateway.error" && item.stage !== "chat.attempt_failed") ?? errors.at(-1)
  if (event) {
    const fields = event.fields ?? {}
    return `${diagnosticStageName(event.stage)}${fields.message ? `：${fields.message}` : fields.upstreamCode ? `：上游业务码 ${fields.upstreamCode}` : fields.status ? `：HTTP ${fields.status}` : `：${fields.name ?? "未知错误"}`}${progress}`
  }
  const last = request.events.findLast(item => item.stage === "socket.idle_timeout" || item.stage === "socket.closed" || item.stage === "client.aborted" || item.stage === "service.stopped")
  return `${last ? diagnosticStageName(last.stage) : request.status ? `HTTP ${request.status}` : "未记录具体原因"}${progress}`
}

function logLine(at: number, id: string, stage: string, fields?: DiagnosticFields): string {
  const detail = diagnosticFieldsText(fields)
  return `${diagnosticLocalTime(at)}  [${id}]  ${stage}${detail ? `  |  ${detail}` : ""}\n`
}

let logTimeFormatter: DateFormatter | null = null
export function diagnosticLocalTime(at: number): string {
  if (!logTimeFormatter) {
    logTimeFormatter = new DateFormatter()
    logTimeFormatter.calendar = "gregorian"
    logTimeFormatter.locale = "en_US_POSIX"
    logTimeFormatter.timeZone = "autoupdatingCurrent"
    logTimeFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZZ"
  }
  return logTimeFormatter.string(new Date(at))
}

function localizeOldLog(text: string): string {
  return text.replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z(?=  \[)/gm,
    value => diagnosticLocalTime(Date.parse(value)))
}

function formatEntry(entry: Record<string, unknown>): string {
  const at = typeof entry.at === "number" ? entry.at : Date.now()
  const id = typeof entry.id === "string" ? entry.id : "服务"
  const fields = entry.fields as DiagnosticFields | undefined
  switch (entry.kind) {
    case "run.started": return logLine(at, id, "HTTP 服务启动", { port: Number(entry.port), lan: entry.lan === true, enabled: entry.enabled === true })
    case "run.ended": return logLine(at, id, "HTTP 服务关闭")
    case "run.cleared": return logLine(at, id, "日志已手动清理", { port: Number(entry.port), lan: entry.lan === true })
    case "logging.enabled": return logLine(at, id, "已开启日志记录")
    case "logging.disabled": return logLine(at, id, "已关闭日志记录")
    case "request.started": return logLine(at, id, "客户端已连接")
    case "request.meta": return logLine(at, id, "请求信息", Object.fromEntries(["method", "path", "model", "stream"].filter(key => entry[key] !== undefined).map(key => [key, entry[key]])) as DiagnosticFields)
    case "request.event": return logLine(at, id, diagnosticStageName(String(entry.stage)), fields)
    case "request.finished": return logLine(at, id, `请求${diagnosticOutcomeName(String(entry.outcome))}`, {
      ...(entry.status !== undefined ? { status: Number(entry.status) } : {}),
      ...(typeof entry.durationMs === "number" ? { durationMs: entry.durationMs } : {}),
      ...(typeof entry.summary === "string" ? { summary: entry.summary } : {}),
    })
    default: return ""
  }
}

function appendFile(entry: Record<string, unknown>, force = false) {
  if (!active || !current || !force && !diagnosticsEnabled()) return
  pendingLines.push(formatEntry(entry))
  if (pendingLines.length >= 20) void flushFile()
  else if (!flushTimer) flushTimer = setTimeout(() => { void flushFile() }, 250)
}

function flushFile(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (!pendingLines.length) return fileQueue
  const text = pendingLines.join("")
  pendingLines = []
  fileQueue = fileQueue.then(async () => { if (fileReady !== false) await FileManager.appendText(logPath(), text) }).catch(() => {
    fileReady = false
    if (current) { current.saveFailed = true; save() }
  })
  return fileQueue
}

export function diagnosticsEnabled(): boolean { return Storage.get<boolean>(ENABLED_KEY) !== false }
export function setDiagnosticsEnabled(value: boolean) {
  if (!Storage.set(ENABLED_KEY, value)) throw new Error("诊断日志设置保存失败")
  if (!value && active && current) {
    for (const request of current.requests) {
      if (request.outcome) continue
      request.outcome = "untracked"
      request.events.push({ at: Date.now(), stage: "logging.disabled" })
      appendFile({ kind: "request.finished", id: request.id, at: Date.now(), outcome: "untracked" }, true)
    }
    appendFile({ kind: "logging.disabled", at: Date.now() }, true)
    void flushFile()
    save()
  }
  if (value && active) appendFile({ kind: "logging.enabled", at: Date.now() }, true)
  notify()
}

function notify() { for (const listener of listeners) listener() }
export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function save() {
  if (!current) return
  if (!Storage.set(RUN_KEY, current)) current.saveFailed = true
  notify()
}

export function diagnosticSnapshot(): DiagnosticRun | null {
  const run = current ?? Storage.get<DiagnosticRun>(RUN_KEY)
  return run ? { ...run, requests: run.requests.map(request => ({ ...request, events: [...request.events] })) } : null
}

export async function beginDiagnosticRun(port: number, lan: boolean) {
  active = true
  sequence = 0
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  pendingLines = []
  current = { startedAt: Date.now(), port, lan, requests: [], droppedRequests: 0 }
  fileReady = false
  const header = formatEntry({ kind: "run.started", at: current.startedAt, port, lan, enabled: diagnosticsEnabled() })
  fileQueue = FileManager.writeAsString(logPath(), header)
    .then(async () => { fileReady = true; if (await FileManager.exists(legacyPath())) await FileManager.remove(legacyPath()) })
    .catch(() => { if (current) current.saveFailed = true })
  save()
  await fileQueue
}

export async function endDiagnosticRun() {
  if (!active || !current) return
  current.endedAt = Date.now()
  for (const request of current.requests) {
    if (request.outcome) continue
    request.outcome = "closed"
    request.events.push({ at: Date.now(), stage: "service.stopped" })
    appendFile({ kind: "request.finished", id: request.id, at: Date.now(), outcome: "closed", durationMs: Date.now() - request.at, summary: "HTTP 服务关闭" }, true)
  }
  appendFile({ kind: "run.ended", at: current.endedAt }, true)
  active = false
  save()
  await flushFile()
}

export async function clearDiagnosticRun() {
  if (current && active) {
    current.requests = []
    current.droppedRequests = 0
    const header = formatEntry({ kind: "run.cleared", at: Date.now(), startedAt: current.startedAt, port: current.port, lan: current.lan })
    fileQueue = flushFile().then(() => FileManager.writeAsString(logPath(), header))
      .then(() => { fileReady = true })
      .catch(() => { fileReady = false; if (current) { current.saveFailed = true; save() } })
    save()
    await flushFile()
  } else {
    await fileQueue
    if (await FileManager.exists(logPath())) await FileManager.remove(logPath())
    if (await FileManager.exists(legacyPath())) await FileManager.remove(legacyPath())
    current = null
    Storage.remove(RUN_KEY)
    fileReady = false
    notify()
  }
}

export async function exportDiagnosticFile(): Promise<string> {
  const stamp = diagnosticLocalTime(diagnosticSnapshot()?.startedAt ?? Date.now()).replace(/[ :]/g, "-")
  const path = `${FileManager.temporaryDirectory}/WorkBuddy2API-HTTP-${stamp}-${Date.now()}.log`
  await flushFile()
  if (fileReady === true && await FileManager.exists(logPath())) await FileManager.copyFile(logPath(), path)
  else await FileManager.writeAsString(path, await readDiagnosticLog())
  return path
}

async function readLegacyLog(): Promise<string> {
  const legacy = await FileManager.readAsString(legacyPath())
  return legacy.split("\n").flatMap(line => {
    if (!line.trim()) return []
    try { return [formatEntry(JSON.parse(line) as Record<string, unknown>)] }
    catch { return [] }
  }).join("")
}

export async function readDiagnosticLog(): Promise<string> {
  await flushFile()
  if (await FileManager.exists(logPath()) && fileReady !== false) return localizeOldLog(await FileManager.readAsString(logPath()))
  if (await FileManager.exists(legacyPath())) return readLegacyLog()
  throw new Error("日志文件不可用，请检查存储空间")
}

function safeError(error: unknown): DiagnosticFields {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {}
  const rawName = error instanceof Error ? error.name : "UnknownError"
  const name = /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(rawName) ? rawName : "Error"
  const rawCode = typeof value.code === "number" && Number.isInteger(value.code) ? String(value.code) : value.code
  const code = typeof rawCode === "string" && /^(?:[A-Z][A-Z0-9_]{1,39}|-?\d{1,6})$/.test(rawCode) ? rawCode : ""
  const status = typeof value.status === "number" && Number.isInteger(value.status) ? value.status : 0
  const detail = typeof value.detail === "string" ? value.detail : ""
  const upstreamCode = detail.match(/"code"\s*:\s*"?(\d{1,6})"?/)?.[1] ?? ""
  const message = error instanceof Error ? error.message : ""
  const safeMessage = /网络连接已中断|网络连接已丢失|network connection was lost|connection reset|socket hang up/i.test(message) ? "网络连接中断"
    : /timeout|timed out|超时/i.test(message) ? "请求超时"
    : /客户端连接已关闭|aborted|cancelled|canceled/i.test(message) ? "客户端主动断开或取消"
    : message.includes("没有可用账号") ? "没有符合模型、区域、启用及额度条件的账号"
    : message.includes("固定账号已停用") ? "所选固定账号已停用"
    : message.includes("固定账号额度已用尽") ? "所选固定账号额度已用尽"
    : message.includes("固定账号的该模型正在限流") ? "所选固定账号的模型正在限流"
    : message.includes("上游模型限流") ? "上游模型限流"
    : message.includes("需要 model 和非空 messages 数组") ? "请求缺少模型或消息"
    : /上游响应不完整|上游事件流格式错误|上游响应超过 12 MB|上游响应解码失败/.exec(message)?.[0]
  const upstreamReason = /6004|14003|6000/.test(upstreamCode) ? "模型限流或繁忙"
    : upstreamCode === "14018" ? "账号额度不足" : undefined
  return { name, ...(code ? { code } : {}), ...(status ? { status } : {}),
    ...(upstreamCode ? { upstreamCode } : {}), message: safeMessage ?? upstreamReason ?? (status >= 400 ? `上游返回 HTTP ${status}，原文已省略` : "原始错误已省略，查看相邻阶段与计数") }
}

export class DiagnosticTrace {
  constructor(readonly id: string) {}

  private request(): DiagnosticRequest | null {
    return active && diagnosticsEnabled() ? current?.requests.find(item => item.id === this.id) ?? null : null
  }

  setRequest(method: string, path: string) {
    const request = this.request()
    if (!request) return
    request.method = method.slice(0, 12)
    request.path = path === "/v1/models" || path === "/v1/chat/completions" ? path : "<其他路径>"
    appendFile({ kind: "request.meta", id: this.id, method: request.method, path: request.path })
    this.mark("http.headers")
  }

  setChat(model: string, stream: boolean) {
    const request = this.request()
    if (!request) return
    request.model = /^[A-Za-z0-9._:-]{1,80}$/.test(model) ? model : "<无效模型名>"
    request.stream = stream
    appendFile({ kind: "request.meta", id: this.id, model: request.model, stream })
    this.mark("chat.validated")
  }

  mark(stage: string, fields?: DiagnosticFields) {
    const request = this.request()
    if (!request) return
    if (request.events.length >= MAX_EVENTS) {
      request.events.splice(1, 1)
      request.droppedEvents++
    }
    request.events.push({ at: Date.now(), stage, ...(fields ? { fields } : {}) })
    appendFile({ kind: "request.event", id: this.id, at: Date.now(), stage, ...(fields ? { fields } : {}) })
    save()
  }

  fail(stage: string, error: unknown) { this.mark(stage, safeError(error)); void flushFile() }

  finish(outcome: "ok" | "error" | "closed", status?: number) {
    const request = this.request()
    if (!request || request.outcome) return
    request.outcome = outcome
    if (status !== undefined) request.status = status
    this.mark("http.finish", { outcome, durationMs: Date.now() - request.at, ...(status !== undefined ? { status } : {}) })
    appendFile({ kind: "request.finished", id: this.id, at: Date.now(), outcome, durationMs: Date.now() - request.at,
      ...(status !== undefined ? { status } : {}), ...(outcome !== "ok" ? { summary: diagnosticFailure(request) } : {}) })
  }
}

export function newDiagnosticTrace(): DiagnosticTrace | null {
  if (!active || !current || !diagnosticsEnabled()) return null
  const id = `${current.startedAt.toString(36)}-${(++sequence).toString(36)}`
  current.requests.push({ id, at: Date.now(), events: [{ at: Date.now(), stage: "socket.accepted" }], droppedEvents: 0 })
  appendFile({ kind: "request.started", id, at: Date.now() })
  if (current.requests.length > MAX_REQUESTS) {
    current.requests.shift()
    current.droppedRequests++
  }
  save()
  return new DiagnosticTrace(id)
}
