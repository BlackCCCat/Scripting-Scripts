export type RegexHistoryItem = {
  id: string
  createdAt: number
  pattern: string
  text: string
}

const KEY = "regex_tester_history_v1"
const LIMIT = 30

function readStorage(key: string): string | null {
  const st: any = (globalThis as any).Storage
  if (!st) return null
  if (typeof st.get === "function") return st.get(key)
  if (typeof st.getString === "function") return st.getString(key)
  return null
}

function writeStorage(key: string, value: string): void {
  const st: any = (globalThis as any).Storage
  if (!st) return
  if (typeof st.set === "function") st.set(key, value)
  else if (typeof st.setString === "function") st.setString(key, value)
}

export function loadRegexHistory(): RegexHistoryItem[] {
  const raw = readStorage(KEY)
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter((v) => v && typeof v === "object") as RegexHistoryItem[]
  } catch {
    return []
  }
}

export function saveRegexHistory(items: RegexHistoryItem[]): void {
  writeStorage(KEY, JSON.stringify(items.slice(0, LIMIT)))
}

export function addRegexHistory(item: RegexHistoryItem): RegexHistoryItem[] {
  const current = loadRegexHistory()
  const next = [item, ...current].slice(0, LIMIT)
  saveRegexHistory(next)
  return next
}

export function removeRegexHistoryById(id: string): RegexHistoryItem[] {
  const current = loadRegexHistory()
  const next = current.filter((item) => item.id !== id)
  saveRegexHistory(next)
  return next
}

export function clearRegexHistory(): void {
  saveRegexHistory([])
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const min = String(d.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

