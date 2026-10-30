import { accounts, modelCatalog, modelLocks, recordRequest, setModelLock, type Credential } from "./store"
import { accountBase, chatHeaders, freshCredential, timeOrderedId } from "./upstream"

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

function candidates(model: string, onlyUid?: string): string[] {
  const realm = model.startsWith("global:") ? "global" : model.startsWith("cn:") ? "cn" : ""
  const bareModel = model.replace(/^(cn|global):/, "")
  const now = Date.now()
  const locked = new Set(modelLocks().filter(item => item.model === bareModel).map(item => item.uid))
  const listed = modelCatalog().filter(item => item.id === bareModel && (!realm || item.realm === realm))
  const eligible = listed.length ? new Set(listed.flatMap(item => item.uids)) : null
  const pool = accounts().filter(item => (!realm || realm === "cn" && item.site === "cn" || realm === "global" && item.site !== "cn") && (!eligible || eligible.has(item.uid)))
  const start = pool.findIndex(item => item.uid === lastPicked.get(model)) + 1
  return [...pool.slice(start), ...pool.slice(0, start)].filter(item => {
    const exhausted = exhaustedUntil.get(item.uid)
    if (exhausted && (exhausted.until <= now || (item.updatedAt ?? 0) > exhausted.at && (item.credits ?? 0) > 0)) exhaustedUntil.delete(item.uid)
    return (!onlyUid || item.uid === onlyUid) && (onlyUid || item.credits !== 0 && !exhaustedUntil.has(item.uid))
      && (coolUntil.get(item.uid) ?? 0) < now && !locked.has(item.uid)
  }).map(item => item.uid)
}

export async function completeChat(request: ChatRequest, onlyUid?: string, agentType: "main" | "auxiliary" = "main"): Promise<Record<string, unknown>> {
  if (!request || typeof request.model !== "string" || !request.model.trim() || !Array.isArray(request.messages) || !request.messages.length) {
    throw new Error("需要 model 和非空 messages 数组")
  }
  const bareModel = request.model.replace(/^(cn|global):/, "")
  const uids = candidates(request.model, onlyUid)
  if (!uids.length) throw new Error("没有可用账号，请先登录并检查账号状态")
  let lastError: Error | null = null
  for (const uid of uids) {
    if (!onlyUid) lastPicked.set(request.model, uid)
    let retryable = false
    const startedAt = Date.now()
    try {
      const account: Credential = await freshCredential(uid)
      const conversationId = typeof request.conversation_id === "string" && request.conversation_id ? request.conversation_id : timeOrderedId()
      const body: Record<string, unknown> = { ...request, model: bareModel, stream: true, stream_options: request.stream_options ?? { include_usage: true } }
      if (body.max_completion_tokens != null && body.max_tokens == null) { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens }
      const headers = chatHeaders(account, conversationId, agentType)
      const response = await fetch(`${accountBase(uid)}/v2/chat/completions`, {
        method: "POST", timeout: 180, headers, body: JSON.stringify(body),
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new ChatUpstreamError(`上游 HTTP ${response.status}：${detail.slice(0, 220)}`, detail, response.status)
      }
      const text = await response.text()
      if (text.length > 12 * 1024 * 1024) throw new ChatUpstreamError("上游响应超过 12 MB")
      if (modelLimit(text) && !text.includes("data:")) throw new ChatUpstreamError("上游模型限流", text)
      const result = aggregateSSE(text, bareModel)
      const usage = result.usage as Usage | undefined
      const hitValues = [usage?.prompt_tokens_details?.cached_tokens, usage?.prompt_cache_hit_tokens, usage?.cache_read_input_tokens, usage?.cached_tokens]
      const hit = hitValues.find(value => typeof value === "number" && value > 0) ?? hitValues.find(value => Number.isFinite(value))
      const miss = usage?.prompt_cache_miss_tokens ?? (hit != null && usage?.prompt_tokens != null ? Math.max(0, usage.prompt_tokens - hit) : undefined)
      recordRequest({ at: Date.now(), uid, model: bareModel, ok: true,
        tokens: Number.isFinite(usage?.total_tokens) ? usage!.total_tokens! : 0, durationMs: Date.now() - startedAt,
        ...(Number.isFinite(usage?.credit) ? { creditsSpent: usage!.credit! } : {}),
        ...(Number.isFinite(hit) && Number.isFinite(miss) ? { cacheHitTokens: hit!, cacheMissTokens: miss! } : {}),
      })
      return result
    } catch (error) {
      if (error instanceof ChatUpstreamError) {
        const lock = modelLimit(error.detail)
        if (lock) { setModelLock(uid, bareModel, lock.until, lock.reason, lock.estimated); retryable = true }
        else if (hardCredit(error.status, error.detail)) { markExhausted(uid); retryable = true }
        else if (error.status === 429 || error.status >= 500) { coolUntil.set(uid, Date.now() + 60_000); retryable = true }
      }
      lastError = error instanceof ChatUpstreamError ? error : new ChatUpstreamError(error instanceof Error ? error.message : String(error))
      recordRequest({ at: Date.now(), uid, model: bareModel, ok: false, tokens: 0, durationMs: Date.now() - startedAt })
      // shortcut: 已发出的请求不换号重试，除明确的限流或服务端错误；需要跨号重试时先确认上游幂等语义。
      if (!retryable) break
    }
  }
  throw lastError ?? new Error("请求失败")
}

