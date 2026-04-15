import type { MatchMode } from "./regex"
import type { RegexTemplate } from "./templates"

export type RegexItem = {
  id: string
  name: string
  pattern: string
  matchMode: MatchMode
  sampleText: string
  replacementTemplate: string
  createdAt: number
  updatedAt: number
}

const KEY = "regex_tester_library_v1"

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

function now() {
  return Date.now()
}

function nextId() {
  return `${now()}_${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeItem(raw: any): RegexItem | null {
  if (!raw || typeof raw !== "object") return null
  return {
    id: String(raw.id ?? nextId()),
    name: String(raw.name ?? ""),
    pattern: String(raw.pattern ?? ""),
    matchMode: raw.matchMode === "full" ? "full" : "search",
    sampleText: String(raw.sampleText ?? ""),
    replacementTemplate: String(raw.replacementTemplate ?? ""),
    createdAt: Number(raw.createdAt ?? now()),
    updatedAt: Number(raw.updatedAt ?? now()),
  }
}

function saveAll(items: RegexItem[]) {
  writeStorage(KEY, JSON.stringify(items))
}

export function loadRegexLibrary(): RegexItem[] {
  const raw = readStorage(KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeItem).filter(Boolean) as RegexItem[]
  } catch {
    return []
  }
}

export function createEmptyRegexItem(): RegexItem {
  const ts = now()
  return {
    id: nextId(),
    name: "Untitled",
    pattern: "",
    matchMode: "search",
    sampleText: "",
    replacementTemplate: "",
    createdAt: ts,
    updatedAt: ts,
  }
}

export function createRegexItemFromTemplate(template: RegexTemplate): RegexItem {
  const ts = now()
  return {
    id: nextId(),
    name: template.title,
    pattern: template.pattern,
    matchMode: template.mode,
    sampleText: template.sampleText ?? "",
    replacementTemplate: template.replacementTemplate ?? "",
    createdAt: ts,
    updatedAt: ts,
  }
}

export function upsertRegexItem(item: RegexItem): RegexItem[] {
  const current = loadRegexLibrary()
  const nextItem = {
    ...item,
    updatedAt: now(),
    createdAt: item.createdAt || now(),
  }
  const index = current.findIndex((v) => v.id === nextItem.id)
  const next = [...current]
  if (index >= 0) next[index] = nextItem
  else next.unshift(nextItem)
  next.sort((a, b) => b.updatedAt - a.updatedAt)
  saveAll(next)
  return next
}

export function addRegexItems(items: RegexItem[]): RegexItem[] {
  const fresh = items.map((item) => ({
    ...item,
    updatedAt: now(),
    createdAt: item.createdAt || now(),
  }))
  if (!fresh.length) return loadRegexLibrary()
  const next = [...fresh, ...loadRegexLibrary()]
  next.sort((a, b) => b.updatedAt - a.updatedAt)
  saveAll(next)
  return next
}

export function removeRegexItemById(id: string): RegexItem[] {
  const next = loadRegexLibrary().filter((item) => item.id !== id)
  saveAll(next)
  return next
}
