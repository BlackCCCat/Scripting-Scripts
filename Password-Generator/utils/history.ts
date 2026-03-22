import type { PasswordOptions } from "./password"

export type PasswordHistoryItem = {
  id: string
  copiedAt: number
  password: string
  options: PasswordOptions
}

const STORAGE_KEY = "password_generator_history_v1"
const LIMIT = 30

function readStorage(key: string): string | null {
  const st: any = (globalThis as any).Storage
  if (!st) return null
  if (typeof st.get === "function") return st.get(key)
  if (typeof st.getString === "function") return st.getString(key)
  return null
}

function writeStorage(key: string, value: string) {
  const st: any = (globalThis as any).Storage
  if (!st) return
  if (typeof st.set === "function") st.set(key, value)
  else if (typeof st.setString === "function") st.setString(key, value)
}

export function loadPasswordHistory(): PasswordHistoryItem[] {
  const raw = readStorage(STORAGE_KEY)
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter((item) => item && typeof item === "object") as PasswordHistoryItem[]
  } catch {
    return []
  }
}

function savePasswordHistory(items: PasswordHistoryItem[]) {
  writeStorage(STORAGE_KEY, JSON.stringify(items.slice(0, LIMIT)))
}

export function addPasswordHistory(item: PasswordHistoryItem): PasswordHistoryItem[] {
  const current = loadPasswordHistory()
  const deduped = current.filter((entry) => entry.password !== item.password)
  const next = [item, ...deduped].slice(0, LIMIT)
  savePasswordHistory(next)
  return next
}

export function clearPasswordHistory() {
  savePasswordHistory([])
}

export function removePasswordHistoryByIds(ids: string[]): PasswordHistoryItem[] {
  const removeSet = new Set(ids)
  const next = loadPasswordHistory().filter((item) => !removeSet.has(item.id))
  savePasswordHistory(next)
  return next
}

export function formatDateTime(timestamp: number) {
  const d = new Date(timestamp)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const min = String(d.getMinutes()).padStart(2, "0")
  const sec = String(d.getSeconds()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`
}
