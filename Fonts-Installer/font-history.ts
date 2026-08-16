import type { FontInfo } from "./font"

export type FontHistorySource = "installer" | "fontPicker"

export type FontHistoryEntry = {
  postScriptName: string
  fullName: string
  familyName: string
  styleName: string
  source: FontHistorySource
  supportsChinese: boolean | null
  recordedAt: number
}

const HISTORY_STORAGE_KEY = "font-install-history:v1"
const MAX_HISTORY_ENTRIES = 100

function normalizeEntry(value: unknown): FontHistoryEntry | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as Partial<FontHistoryEntry>
  const postScriptName = typeof candidate.postScriptName === "string"
    ? candidate.postScriptName.trim()
    : ""
  if (!postScriptName) return null

  const source: FontHistorySource = candidate.source === "installer" ? "installer" : "fontPicker"
  return {
    postScriptName,
    fullName: typeof candidate.fullName === "string" && candidate.fullName.trim()
      ? candidate.fullName.trim()
      : postScriptName,
    familyName: typeof candidate.familyName === "string" ? candidate.familyName.trim() : "",
    styleName: typeof candidate.styleName === "string" ? candidate.styleName.trim() : "",
    source,
    supportsChinese: typeof candidate.supportsChinese === "boolean" ? candidate.supportsChinese : null,
    recordedAt: typeof candidate.recordedAt === "number" && Number.isFinite(candidate.recordedAt)
      ? candidate.recordedAt
      : 0,
  }
}

export function loadFontHistory(): FontHistoryEntry[] {
  const stored = Storage.get<unknown>(HISTORY_STORAGE_KEY)
  if (!Array.isArray(stored)) return []
  return stored
    .map(normalizeEntry)
    .filter((entry): entry is FontHistoryEntry => entry != null)
    .sort((left, right) => right.recordedAt - left.recordedAt)
    .slice(0, MAX_HISTORY_ENTRIES)
}

function saveFontHistory(entries: FontHistoryEntry[]): FontHistoryEntry[] {
  const next = entries
    .sort((left, right) => right.recordedAt - left.recordedAt)
    .slice(0, MAX_HISTORY_ENTRIES)
  if (!Storage.set(HISTORY_STORAGE_KEY, next)) {
    throw new Error("无法保存字体历史记录。")
  }
  return next
}

function upsertFontHistory(entry: FontHistoryEntry): FontHistoryEntry[] {
  const current = loadFontHistory()
  const existing = current.find(item => item.postScriptName === entry.postScriptName)
  const merged: FontHistoryEntry = {
    ...existing,
    ...entry,
    fullName: entry.source === "fontPicker" && existing ? existing.fullName : entry.fullName,
    familyName: entry.familyName || existing?.familyName || "",
    styleName: entry.styleName || existing?.styleName || "",
    source: existing?.source === "installer" ? "installer" : entry.source,
    supportsChinese: entry.supportsChinese ?? existing?.supportsChinese ?? null,
  }
  return saveFontHistory([
    merged,
    ...current.filter(item => item.postScriptName !== entry.postScriptName),
  ])
}

export function recordInstalledFont(info: FontInfo): FontHistoryEntry[] {
  return upsertFontHistory({
    postScriptName: info.postScriptName,
    fullName: info.fullName,
    familyName: info.familyName,
    styleName: info.styleName,
    source: "installer",
    supportsChinese: info.supportsChinese,
    recordedAt: Date.now(),
  })
}

export function recordPickedFont(postScriptName: string): FontHistoryEntry[] {
  const fontName = postScriptName.trim()
  if (!fontName) return loadFontHistory()
  return upsertFontHistory({
    postScriptName: fontName,
    fullName: fontName,
    familyName: "",
    styleName: "",
    source: "fontPicker",
    supportsChinese: null,
    recordedAt: Date.now(),
  })
}
