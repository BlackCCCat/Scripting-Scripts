import { timeOrderedId } from "./upstream"

type ChatInput = { messages: unknown[]; [key: string]: unknown }
export type ChatSession = { routeKey: string; cacheSource: string }

const bindings = new Map<string, { uid: string; touchedAt: number }>()
const conversationIds = new Map<string, { id: string; touchedAt: number }>()
const SESSION_TTL = 30 * 60_000
const MAX_BINDINGS = 512

const textField = (value: unknown) => typeof value === "string" ? value.trim() : ""
const objectField = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

function contentSignature(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map(part => {
    const value = objectField(part)
    const type = textField(value.type)
    return !type || type === "text" ? String(value.text ?? "") : `\n[${type}]\n`
  }).join("").trim()
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}

function uuid(bytes: Uint8Array): string {
  const value = hex(bytes)
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`
}

export async function chatSession(request: ChatInput): Promise<ChatSession> {
  const meta = objectField(request.metadata)
  const declaredId = textField(meta.conversation_id) || textField(meta.conversationId) ||
    textField(request.conversation_id) || textField(request.conversationId)
  const explicit = declaredId || textField(request.prompt_cache_key)
  let system = "", firstUser = ""
  for (const raw of request.messages) {
    const message = objectField(raw)
    const role = textField(message.role)
    if (!system && (role === "system" || role === "developer")) system = contentSignature(message.content)
    if (!firstUser && role === "user") firstUser = contentSignature(message.content)
    if (system && firstUser) break
  }
  const namespace = textField(meta.user_id) || textField(request.user_id)
  const derived = firstUser ? `d:${hex((await digest(`${system}\0${firstUser}`)).subarray(0, 16))}` : ""
  const named = explicit ? `e:${hex((await digest(`${namespace}\0${explicit}`)).subarray(0, 16))}` : ""
  return {
    routeKey: named || (namespace ? "" : derived),
    cacheSource: named || derived,
  }
}

export function boundAccount(key: string): string {
  const entry = bindings.get(key)
  if (!entry) return ""
  if (Date.now() - entry.touchedAt > SESSION_TTL) { bindings.delete(key); return "" }
  entry.touchedAt = Date.now()
  return entry.uid
}

export function bindAccount(key: string, uid: string): void {
  if (!key) return
  if (bindings.size >= MAX_BINDINGS) {
    for (const [oldKey, entry] of bindings) if (Date.now() - entry.touchedAt > SESSION_TTL) bindings.delete(oldKey)
    if (bindings.size >= MAX_BINDINGS) bindings.delete(bindings.keys().next().value!)
  }
  bindings.set(key, { uid, touchedAt: Date.now() })
}

export function unbindAccount(key: string, uid: string): void {
  if (bindings.get(key)?.uid === uid) bindings.delete(key)
}

export async function generatedCacheKey(uid: string, source: string): Promise<string> {
  const bytes = (await digest(`${uid}\0${source}\0cache`)).slice(0, 16)
  bytes[6] = bytes[6] & 15 | 64
  bytes[8] = bytes[8] & 63 | 128
  return uuid(bytes)
}

export function generatedConversationId(uid: string, source: string): string {
  const key = `${uid}\0${source}`
  const now = Date.now()
  const existing = conversationIds.get(key)
  if (existing && now - existing.touchedAt < SESSION_TTL) {
    existing.touchedAt = now
    return existing.id
  }
  if (conversationIds.size >= MAX_BINDINGS) {
    for (const [oldKey, entry] of conversationIds) if (now - entry.touchedAt >= SESSION_TTL) conversationIds.delete(oldKey)
    if (conversationIds.size >= MAX_BINDINGS) conversationIds.delete(conversationIds.keys().next().value!)
  }
  const id = timeOrderedId()
  conversationIds.set(key, { id, touchedAt: now })
  return id
}
