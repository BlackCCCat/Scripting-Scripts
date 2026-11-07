import { accountRotationEnabled, accounts, fixedAccountUid, modelCatalog, modelLocks, recordRequest, setModelLock, type Credential } from "./store"
import { accountBase, chatHeaders, freshCredential, timeOrderedId } from "./upstream"
import { prepareReasoning } from "./reasoning"
import { bindAccount, boundAccount, chatSession, generatedCacheKey, generatedConversationId, unbindAccount, type ChatSession } from "./chatRouting"
import type { DiagnosticTrace } from "./diagnostics"

export type ChatRequest = { model: string; messages: unknown[]; stream?: boolean; [key: string]: unknown }
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }
type Usage = { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number; credit?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number; cache_read_input_tokens?: number; cached_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
export class ChatUpstreamError extends Error {
  constructor(message: string, readonly detail = message, readonly status = 200) { super(message) }
}

function modelLimit(detail: string): { until: number; reason: string; estimated: boolean } | null {
  const code = detail.match(/"code"\s*:\s*"?(6004|14003|6000)"?/i)?.[1]
  if (!code || code === "6000" && !detail.includes("切换其他模型")) return null
  const reason = (() => { try { const body = JSON.parse(detail); return String(body.msg || body.message || body.error?.message || detail) } catch { return detail } })()
  const time = detail.match(/(?:将在\s*|reset at\s*)(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)(?:\s*UTC\+8)?/i)?.[1]
  const parsed = time ? Date.parse(time.replace(" ", "T") + "+08:00") : NaN
  const estimated = !Number.isFinite(parsed) || parsed <= Date.now()
  return { until: estimated ? Date.now() + (code === "14003" ? 60_000 : 600_000) : parsed, reason, estimated }
}

export function aggregateSSE(frames: string, requestedModel: string): Record<string, unknown> {
  let id = "", model = requestedModel, created = Math.floor(Date.now() / 1000), content = "", reasoning = ""
  let finishReason = "stop", usage: Usage | undefined, sawChoice = false, sawDone = false, sawFinish = false
  const tools = new Map<number, ToolCall>()
  for (const line of frames.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue
    const payload = line.slice(5).trim()
    if (payload === "[DONE]") { sawDone = true; break }
    let event: any
    try { event = JSON.parse(payload) } catch { throw new ChatUpstreamError("上游事件流格式错误") }
    if (event.error || event.code && event.code !== 0) throw new ChatUpstreamError(String(event.error?.message || event.error || event.msg || "上游生成失败"), JSON.stringify(event))
    if (typeof event.id === "string" && !id) id = event.id
    if (typeof event.model === "string") model = event.model
    if (Number.isFinite(event.created)) created = event.created
    if (event.usage && typeof event.usage === "object") usage = event.usage
    const choice = event.choices?.[0]
    if (!choice) continue
    sawChoice = true
    if (typeof choice.finish_reason === "string" && choice.finish_reason) { finishReason = choice.finish_reason; sawFinish = true }
    const delta = choice.delta || choice.message
    if (!delta) continue
    if (typeof delta.content === "string") content += delta.content
    if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content
    for (const part of delta.tool_calls ?? []) {
      const index = Number.isInteger(part.index) ? part.index : 0
      const current = tools.get(index) ?? { id: part.id || `call_${index}`, type: "function", function: { name: "", arguments: "" } }
      if (part.id) current.id = part.id
      if (part.function?.name) current.function.name += part.function.name
      if (part.function?.arguments) current.function.arguments += part.function.arguments
      tools.set(index, current)
    }
  }
  if (!sawChoice || !sawDone && !sawFinish) throw new ChatUpstreamError("上游响应不完整")
  const message: Record<string, unknown> = { role: "assistant", content }
  if (reasoning) message.reasoning_content = reasoning
  if (tools.size) {
    const calls = [...tools.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
    message.tool_calls = calls
  }
  const result: Record<string, unknown> = {
    id: id || `chatcmpl-${Date.now()}`, object: "chat.completion", created, model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
  }
  if (usage) {
    if (usage.total_tokens == null && typeof usage.prompt_tokens === "number" && Number.isFinite(usage.prompt_tokens)
      && typeof usage.completion_tokens === "number" && Number.isFinite(usage.completion_tokens)) {
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens
    }
    result.usage = usage
  }
  return result
}

const coolUntil = new Map<string, number>()
const exhaustedUntil = new Map<string, { until: number; at: number }>()
const lastPicked = new Map<string, string>()

function diagnosticAccount(uid: string) {
  const pool = accounts()
  const index = pool.findIndex(item => item.uid === uid)
  const account = pool[index]
  const chars = Array.from(account?.nickname ?? "").filter(char => /[\p{L}\p{N}]/u.test(char))
  const masked = chars.length ? `${chars[0]}***${chars.length > 1 ? chars.at(-1) : ""}` : "未命名"
  return { account: index >= 0 ? `#${index + 1} ${masked}` : "已删除账号", site: account?.site === "cn" ? "国内" : "国际", uidSuffix: uid.length > 4 ? uid.slice(-4) : "****" }
}

function hardCredit(status: number, detail: string): boolean {
  if (status === 402 || /"code"\s*:\s*"?14018"?(?=\s*[,}])/i.test(detail)) return true
  return status !== 429 && /insufficient credits?|no credits?|credits? exhausted|out of credits?|quota (?:exceeded|exhausted)|payment required|积分不足|额度不足|余额不足|积分用完|额度用尽|没有积分/i.test(detail)
}

function markExhausted(uid: string) {
  const now = Date.now()
  const china = new Date(now + 8 * 3_600_000)
  let until = Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate(), 4) - 8 * 3_600_000
  if (until <= now) until += 86_400_000
  exhaustedUntil.set(uid, { until, at: now })
}

function candidates(model: string, onlyUid?: string, preferredUid = ""): string[] {
  const realm = model.startsWith("global:") ? "global" : model.startsWith("cn:") ? "cn" : ""
  const bareModel = model.replace(/^(cn|global):/, "")
  const now = Date.now()
  const locked = new Set(modelLocks().filter(item => item.model === bareModel).map(item => item.uid))
  const listed = modelCatalog().filter(item => item.id === bareModel && (!realm || item.realm === realm))
  const eligible = listed.length ? new Set(listed.flatMap(item => item.uids)) : null
  const pool = accounts().filter(item => (onlyUid || item.enabled !== false) &&
    (!realm || realm === "cn" && item.site === "cn" || realm === "global" && item.site !== "cn") &&
    (!eligible || eligible.has(item.uid)))
  if (!onlyUid && !accountRotationEnabled()) {
    const fixed = fixedAccountUid()
    const account = accounts().find(item => item.uid === fixed)
    if (!account) throw new Error("固定账号不存在，请在更多页面重新选择")
    if (account.enabled === false) throw new Error("固定账号已停用，请在账号页面启用")
    if (!pool.some(item => item.uid === fixed)) throw new Error("固定账号不支持该模型或账号区域")
    const exhausted = exhaustedUntil.get(fixed)
    if (exhausted && (exhausted.until <= now || (account.updatedAt ?? 0) > exhausted.at && (account.credits ?? 0) > 0)) exhaustedUntil.delete(fixed)
    if (account.credits === 0 || exhaustedUntil.has(fixed)) throw new Error("固定账号额度已用尽")
    if (locked.has(fixed)) throw new Error("固定账号的该模型正在限流")
    if ((coolUntil.get(fixed) ?? 0) >= now) throw new Error("固定账号暂时受到上游限流")
    return [fixed]
  }
  const start = pool.findIndex(item => item.uid === lastPicked.get(model)) + 1
  const available = [...pool.slice(start), ...pool.slice(0, start)].filter(item => {
    const exhausted = exhaustedUntil.get(item.uid)
    if (exhausted && (exhausted.until <= now || (item.updatedAt ?? 0) > exhausted.at && (item.credits ?? 0) > 0)) exhaustedUntil.delete(item.uid)
    return (!onlyUid || item.uid === onlyUid) && (onlyUid || item.credits !== 0 && !exhaustedUntil.has(item.uid))
      && (coolUntil.get(item.uid) ?? 0) < now && !locked.has(item.uid)
  }).map(item => item.uid)
  if (preferredUid && available.includes(preferredUid)) return [preferredUid, ...available.filter(uid => uid !== preferredUid)]
  return available
}

function validateChat(request: ChatRequest): string {
  if (!request || typeof request.model !== "string" || !request.model.trim() || !Array.isArray(request.messages) || !request.messages.length)
    throw new Error("需要 model 和非空 messages 数组")
  return request.model.replace(/^(cn|global):/, "")
}

async function requestChat(uid: string, request: ChatRequest, bareModel: string, session: ChatSession, agentType: "main" | "auxiliary", signal?: AbortSignal, trace?: DiagnosticTrace | null): Promise<Response> {
  trace?.mark("credential.check")
  const account: Credential = await freshCredential(uid)
  trace?.mark("credential.ready")
  const conversationId = session.cacheSource ? generatedConversationId(uid, session.cacheSource) : timeOrderedId()
  const body: Record<string, unknown> = { ...request, model: bareModel, stream: true, stream_options: request.stream_options ?? { include_usage: true } }
  if (body.max_completion_tokens != null && body.max_tokens == null) { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens }
  if (!(typeof body.prompt_cache_key === "string" && body.prompt_cache_key.trim()) && session.cacheSource)
    body.prompt_cache_key = await generatedCacheKey(uid, session.cacheSource)
  const outgoing = prepareReasoning(body)
  const requestBody = JSON.stringify(outgoing)
  trace?.mark("upstream.send", { requestBytes: new TextEncoder().encode(requestBody).length, thinking: (outgoing.thinking as { type?: string } | undefined)?.type === "enabled" })
  let response: Response
  try {
    response = await fetch(`${accountBase(uid)}/v2/chat/completions`, {
      method: "POST", timeout: 600, signal, headers: chatHeaders(account, conversationId, agentType), body: requestBody,
    })
  } catch (error) { trace?.fail("upstream.connect", error); throw error }
  trace?.mark("upstream.headers", { status: response.status })
  if (!response.ok) {
    let detail: string
    try { detail = await response.text() }
    catch (error) { trace?.fail("upstream.error_body", error); throw error }
    throw new ChatUpstreamError(`上游 HTTP ${response.status}：${detail.slice(0, 220)}`, detail, response.status)
  }
  return response
}

function recordSuccess(uid: string, bareModel: string, startedAt: number, result: Record<string, unknown>, trace?: DiagnosticTrace | null) {
  const usage = result.usage as Usage | undefined
  const hitValues = [usage?.prompt_tokens_details?.cached_tokens, usage?.prompt_cache_hit_tokens, usage?.cache_read_input_tokens, usage?.cached_tokens]
  const hit = hitValues.find(value => typeof value === "number" && value > 0) ?? hitValues.find(value => Number.isFinite(value))
  const miss = usage?.prompt_cache_miss_tokens ?? (hit != null && usage?.prompt_tokens != null ? Math.max(0, usage.prompt_tokens - hit) : undefined)
  if (usage) trace?.mark("upstream.usage", {
    totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens! : 0,
    promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens! : 0,
    completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens! : 0,
    cacheHitTokens: Number.isFinite(hit) ? hit! : 0,
  })
  recordRequest({ at: Date.now(), uid, model: bareModel, ok: true,
    tokens: Number.isFinite(usage?.total_tokens) ? usage!.total_tokens! : 0, durationMs: Date.now() - startedAt,
    ...(Number.isFinite(usage?.credit) ? { creditsSpent: usage!.credit! } : {}),
    ...(Number.isFinite(hit) && Number.isFinite(miss) ? { cacheHitTokens: hit!, cacheMissTokens: miss! } : {}),
  })
}

function retryAfterError(uid: string, bareModel: string, error: unknown): boolean {
  if (!(error instanceof ChatUpstreamError)) return false
  const lock = modelLimit(error.detail)
  if (lock) { setModelLock(uid, bareModel, lock.until, lock.reason, lock.estimated); return true }
  if (hardCredit(error.status, error.detail)) { markExhausted(uid); return true }
  if (error.status === 429 || error.status >= 500) { coolUntil.set(uid, Date.now() + 60_000); return true }
  return false
}

export async function completeChat(request: ChatRequest, onlyUid?: string, agentType: "main" | "auxiliary" = "main", trace?: DiagnosticTrace | null, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const bareModel = validateChat(request)
  const session = await chatSession(request)
  const routeKey = session.routeKey ? `${request.model.startsWith("global:") ? "global" : "cn"}:${session.routeKey}` : ""
  const preferredUid = !onlyUid && accountRotationEnabled() && routeKey ? boundAccount(routeKey) : ""
  const uids = candidates(request.model, onlyUid, preferredUid)
  trace?.mark("route.candidates", { count: uids.length, bound: !!preferredUid, rotation: accountRotationEnabled() })
  if (!uids.length) throw new Error("没有可用账号，请检查账号启用状态、额度和模型权限")
  let lastError: Error | null = null
  for (const uid of uids) {
    trace?.mark("route.selected", { ...diagnosticAccount(uid), attempt: uids.indexOf(uid) + 1 })
    if (!onlyUid && accountRotationEnabled() && uid !== preferredUid) lastPicked.set(request.model, uid)
    const startedAt = Date.now()
    try {
      const response = await requestChat(uid, request, bareModel, session, agentType, signal, trace)
      let text: string
      try { text = await response.text() }
      catch (error) { trace?.fail("upstream.read", error); throw error }
      trace?.mark("upstream.body", { bytes: new TextEncoder().encode(text).length })
      if (text.length > 12 * 1024 * 1024) throw new ChatUpstreamError("上游响应超过 12 MB")
      if (modelLimit(text) && !text.includes("data:")) throw new ChatUpstreamError("上游模型限流", text)
      const result = aggregateSSE(text, bareModel)
      const message = (result.choices as Array<{ message?: { content?: string; reasoning_content?: string } }>)[0]?.message
      trace?.mark("upstream.completed", { reasoningChars: message?.reasoning_content?.length ?? 0, answerChars: message?.content?.length ?? 0 })
      recordSuccess(uid, bareModel, startedAt, result, trace)
      if (routeKey && !onlyUid && accountRotationEnabled()) bindAccount(routeKey, uid)
      return result
    } catch (error) {
      trace?.fail("chat.attempt_failed", error)
      const retryable = retryAfterError(uid, bareModel, error)
      if (retryable && routeKey) unbindAccount(routeKey, uid)
      trace?.mark("route.failure", { retryable, willRetry: retryable && accountRotationEnabled() && uids.indexOf(uid) < uids.length - 1 })
      lastError = error instanceof ChatUpstreamError ? error : new ChatUpstreamError(error instanceof Error ? error.message : String(error))
      recordRequest({ at: Date.now(), uid, model: bareModel, ok: false, tokens: 0, durationMs: Date.now() - startedAt })
      // shortcut: 已发出的请求不换号重试，除明确的限流或服务端错误；需要跨号重试时先确认上游幂等语义。
      if (!retryable || !accountRotationEnabled()) break
    }
  }
  throw lastError ?? new Error("请求失败")
}

async function forwardEvents(response: Response, bareModel: string, includeUsage: boolean, onEvent: (event: unknown) => Promise<void>, signal: AbortSignal, trace?: DiagnosticTrace | null): Promise<Record<string, unknown>> {
  const reader = response.dataStream.getReader()
  const decoder = new TextDecoder("utf-8")
  let pending = "", frames = "", eventData: string[] = [], done = false, bytesRead = 0
  let eventCount = 0, reasoningChars = 0, answerChars = 0, lastProgressAt = Date.now(), lastProgressBytes = 0
  const startedAt = Date.now()
  let lastChunkAt = startedAt, firstReasoningAt = 0, firstAnswerAt = 0, writingClient = false
  let failureStage = "upstream.read"
  const waitingTimer = trace ? setInterval(() => {
    if (done || writingClient) return
    const now = Date.now()
    if (now - lastChunkAt < 10_000) return
    trace.mark("upstream.waiting", { phase: firstAnswerAt ? "回答" : firstReasoningAt ? "思考" : "等待首个事件",
      elapsedMs: now - startedAt, idleMs: now - lastChunkAt, events: eventCount, bytesRead, reasoningChars, answerChars })
  }, 15_000) : null
  const dispatch = async () => {
    if (!eventData.length) return
    const payload = eventData.join("\n").trim()
    eventData = []
    if (payload === "[DONE]") { done = true; return }
    let event: any
    try { event = JSON.parse(payload) } catch { failureStage = "upstream.parse"; throw new ChatUpstreamError("上游事件流格式错误") }
    if (event.error || event.code && event.code !== 0) {
      failureStage = "upstream.event_error"
      throw new ChatUpstreamError(String(event.error?.message || event.error || event.msg || "上游生成失败"), JSON.stringify(event))
    }
    eventCount++
    const delta = event.choices?.[0]?.delta ?? event.choices?.[0]?.message
    if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length) {
      reasoningChars += delta.reasoning_content.length
      if (!firstReasoningAt) {
        firstReasoningAt = Date.now()
        trace?.mark("upstream.thinking_started", { elapsedMs: Date.now() - startedAt, bytesRead })
      }
    }
    if (typeof delta?.content === "string" && delta.content.length) {
      answerChars += delta.content.length
      if (!firstAnswerAt) {
        firstAnswerAt = Date.now()
        trace?.mark("upstream.answer_started", { elapsedMs: firstAnswerAt - startedAt,
          ...(firstReasoningAt ? { thinkingDurationMs: firstAnswerAt - firstReasoningAt } : {}), reasoningChars, bytesRead })
      }
    }
    if (eventCount === 1) trace?.mark("upstream.first_event", { bytesRead })
    if (Date.now() - lastProgressAt >= 2_000 || bytesRead - lastProgressBytes >= 32 * 1024) {
      trace?.mark("upstream.progress", { phase: firstAnswerAt ? "回答" : firstReasoningAt ? "思考" : "等待生成", elapsedMs: Date.now() - startedAt,
        events: eventCount, bytesRead, reasoningChars, answerChars })
      lastProgressAt = Date.now(); lastProgressBytes = bytesRead
    }
    frames += `data: ${payload}\n\n`
    if (!Array.isArray(event.choices) || !event.choices.length) {
      if (includeUsage && event.usage) try { await onEvent(event) }
      catch (error) { failureStage = "downstream.event"; throw error }
      return
    }
    if (!includeUsage && event.usage) { event = { ...event }; delete event.usage }
    writingClient = true
    try { await onEvent(event) }
    catch (error) { failureStage = "downstream.event"; throw error }
    finally { writingClient = false }
  }
  const consume = async (text: string) => {
    pending += text
    while (true) {
      const end = pending.indexOf("\n")
      if (end < 0) break
      const line = pending.slice(0, end).replace(/\r$/, "")
      pending = pending.slice(end + 1)
      if (!line) await dispatch()
      else if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart())
    }
  }
  let stopWaiting: (() => void) | null = null
  const aborted = new Promise<null>(resolve => {
    stopWaiting = () => resolve(null)
    if (signal.aborted) resolve(null)
    else signal.addEventListener("abort", stopWaiting)
  })
  try {
    while (!done) {
      if (signal.aborted) throw new Error("客户端连接已关闭")
      const chunk = await Promise.race([reader.read(), aborted])
      if (!chunk) throw new Error("客户端连接已关闭")
      if (chunk.done) break
      lastChunkAt = Date.now()
      const bytes = chunk.value.toUint8Array()
      if (!bytes) { failureStage = "upstream.decode"; throw new ChatUpstreamError("上游响应解码失败") }
      bytesRead += bytes.length
      if (bytesRead > 12 * 1024 * 1024) throw new ChatUpstreamError("上游响应超过 12 MB")
      await consume(decoder.decode(bytes, { stream: true }))
    }
    await consume(decoder.decode())
    if (pending) await consume("\n")
    await dispatch()
    if (done) frames += "data: [DONE]\n\n"
    trace?.mark(done ? "upstream.done" : "upstream.missing_done", { events: eventCount, bytesRead, reasoningChars, answerChars,
      ...(firstReasoningAt ? { thinkingDurationMs: (firstAnswerAt || Date.now()) - firstReasoningAt } : {}) })
    failureStage = "upstream.aggregate"
    return aggregateSSE(frames, bareModel)
  } catch (error) {
    trace?.mark("upstream.interrupted", { events: eventCount, bytesRead, reasoningChars, answerChars,
      ...(firstReasoningAt ? { thinkingDurationMs: (firstAnswerAt || Date.now()) - firstReasoningAt } : {}) })
    trace?.fail(signal.aborted ? "client.aborted" : failureStage, error)
    throw error
  } finally {
    if (stopWaiting) signal.removeEventListener("abort", stopWaiting)
    if (waitingTimer) clearInterval(waitingTimer)
    // 不能调 reader.cancel()：它会立刻把流的 errorSignaled 置位，而原生 URLSession 的 completion
    // 回调随后仍会调用 controller.close()，那里抛 "Stream is errored"（任务已完成时原生 cancel
    // 是空操作，所以取消并不能阻止 completion 到达）。中断上游交给 AbortSignal，这里只释放读锁。
    try { reader.releaseLock() } catch (error) { trace?.fail("upstream.stream_release", error) }
  }
}

export async function streamChat(request: ChatRequest, onEvent: (event: unknown) => Promise<void>, signal: AbortSignal, trace?: DiagnosticTrace | null): Promise<void> {
  const bareModel = validateChat(request)
  const session = await chatSession(request)
  const routeKey = session.routeKey ? `${request.model.startsWith("global:") ? "global" : "cn"}:${session.routeKey}` : ""
  const preferredUid = accountRotationEnabled() && routeKey ? boundAccount(routeKey) : ""
  const uids = candidates(request.model, undefined, preferredUid)
  trace?.mark("route.candidates", { count: uids.length, bound: !!preferredUid, rotation: accountRotationEnabled() })
  if (!uids.length) throw new Error("没有可用账号，请检查账号启用状态、额度和模型权限")
  const includeUsage = (request.stream_options as { include_usage?: boolean } | undefined)?.include_usage === true
  let lastError: Error | null = null
  for (const uid of uids) {
    if (signal.aborted) throw new Error("客户端连接已关闭")
    trace?.mark("route.selected", { ...diagnosticAccount(uid), attempt: uids.indexOf(uid) + 1 })
    if (accountRotationEnabled() && uid !== preferredUid) lastPicked.set(request.model, uid)
    const startedAt = Date.now()
    let emitted = false
    try {
      const response = await requestChat(uid, request, bareModel, session, "main", signal, trace)
      const result = await forwardEvents(response, bareModel, includeUsage, async event => { await onEvent(event); emitted = true }, signal, trace)
      recordSuccess(uid, bareModel, startedAt, result, trace)
      if (routeKey && accountRotationEnabled()) bindAccount(routeKey, uid)
      return
    } catch (error) {
      trace?.fail("chat.attempt_failed", error)
      const retryable = retryAfterError(uid, bareModel, error)
      if (retryable && routeKey) unbindAccount(routeKey, uid)
      trace?.mark("route.failure", { retryable, emitted, aborted: signal.aborted, willRetry: !emitted && !signal.aborted && retryable && accountRotationEnabled() && uids.indexOf(uid) < uids.length - 1 })
      lastError = error instanceof Error ? error : new Error(String(error))
      recordRequest({ at: Date.now(), uid, model: bareModel, ok: false, tokens: 0, durationMs: Date.now() - startedAt })
      if (emitted || signal.aborted || !retryable || !accountRotationEnabled()) break
    }
  }
  throw lastError ?? new Error("请求失败")
}

