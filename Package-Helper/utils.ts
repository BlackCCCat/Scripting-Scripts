import { Widget } from "scripting"

import type { Color } from "scripting"
import type { Config, ImportedRecord, PickupInfo } from "./types"

declare const Storage: {
  get(key: string): any
  set(key: string, value: any): boolean
  remove(key: string): void
}

export const CONFIG_KEY = "smsPickup_widget_config_v2"
export const INTENT_DATA_KEY = "smsPickup_intent_data_temp_v2"
const RECENTLY_PICKED_MS = 60 * 60 * 1000

export const DEFAULT_CONFIG: Config = {
  autoDetectSMS: true,
  keywords: ["菜鸟", "蜂巢", "丰巢", "取件", "取货"],
  widgetShowCount: 5,
  showDate: true,
  importedMessages: [],
  importedRecords: [],
  pickedItems: [],
  deletedCodes: [],
}

const BRACKET_RE = /【([^】\d]{2,10})】/
const LOCATION_RE = /(?:到达|至|放|在|取件地[:：]|地址[:：])\s*([^，,。!！\n\r\]】]{2,30}?(?:店|驿站|超市|服务部|前台|门卫|代收点|便利店|服务站|仓|柜|厅|室|中心|报亭|花园|小区|楼|园|广场))/i
const GENERIC_RE = /(菜鸟|蜂巢|丰巢|兔喜|兔喜生活|极兔|顺丰|京东|韵达|中通|圆通|申通|邮政|EMS|妈妈驿站|驿站|日日顺|德邦)/i
const CODE_RE = /(?:取件码|取货码|验证码|提货码|取件|取货|凭)[^\d]{0,8}((\s*(?:\d+-){0,2}\d{3,8}[\s,，\.]*)+)/gi

export function clampShowCount(value: number) {
  return Math.max(1, Math.min(50, value || DEFAULT_CONFIG.widgetShowCount))
}

export function normalizeKeywords(input: string[]) {
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean)
}

export function loadConfig(): Config {
  try {
    const raw = Storage.get(CONFIG_KEY) || {}
    const merged: Config = { ...DEFAULT_CONFIG, ...raw }

    if (!Array.isArray(merged.keywords)) {
      merged.keywords = String(merged.keywords || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    }

    if (!Array.isArray(merged.importedMessages)) {
      merged.importedMessages = []
    }

    if (!Array.isArray(merged.importedRecords)) {
      merged.importedRecords = merged.importedMessages.map((text: string) => ({
        text: String(text || ""),
        importedAt: null,
      }))
    }

    if (!Array.isArray(merged.pickedItems)) {
      merged.pickedItems = []
    }

    if (!Array.isArray(merged.deletedCodes)) {
      merged.deletedCodes = []
    }

    merged.widgetShowCount = clampShowCount(Number(merged.widgetShowCount) || DEFAULT_CONFIG.widgetShowCount)
    merged.keywords = normalizeKeywords(merged.keywords)
    merged.autoDetectSMS = merged.autoDetectSMS !== false
    merged.showDate = merged.showDate !== false

    return merged
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(next: Partial<Config>) {
  const merged = { ...loadConfig(), ...next }
  merged.keywords = normalizeKeywords(merged.keywords)
  merged.widgetShowCount = clampShowCount(merged.widgetShowCount)
  return Storage.set(CONFIG_KEY, merged)
}

export function resetConfig() {
  Storage.remove(CONFIG_KEY)
  Storage.remove(INTENT_DATA_KEY)
}

function parseMessageDate(text: string): string | null {
  const patterns = [
    /(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?\s+\d{1,2}:\d{2}(?::\d{2})?)/,
    /(\d{1,2}[-/.月]\d{1,2}(?:日)?\s+\d{1,2}:\d{2}(?::\d{2})?)/,
    /(今天\s*\d{1,2}:\d{2})/,
    /(昨天\s*\d{1,2}:\d{2})/,
  ]

  for (const re of patterns) {
    const m = text.match(re)
    if (!m || !m[1]) continue
    const raw = m[1].trim()
    const now = new Date()

    if (raw.startsWith("今天")) {
      const hm = raw.replace("今天", "").trim()
      const [h, min] = hm.split(":").map(Number)
      const d = new Date(now)
      d.setHours(h || 0, min || 0, 0, 0)
      return d.toISOString()
    }

    if (raw.startsWith("昨天")) {
      const hm = raw.replace("昨天", "").trim()
      const [h, min] = hm.split(":").map(Number)
      const d = new Date(now.getTime() - 24 * 3600 * 1000)
      d.setHours(h || 0, min || 0, 0, 0)
      return d.toISOString()
    }

    let normalized = raw
      .replace(/年/g, "-")
      .replace(/月/g, "-")
      .replace(/日/g, "")
      .replace(/\//g, "-")
      .replace(/\./g, "-")
      .trim()

    if (!/^20\d{2}-/.test(normalized)) {
      normalized = `${now.getFullYear()}-${normalized}`
    }

    const d = new Date(normalized)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  return null
}

export function extractPickupFromText(text: string): PickupInfo[] {
  if (!text) return []

  const results: PickupInfo[] = []
  const matcher = new RegExp(CODE_RE, "gi")
  let match: RegExpExecArray | null
  const detectedDate = parseMessageDate(text)

  while ((match = matcher.exec(text)) !== null) {
    const codeListString = match[1]
    if (!codeListString || !codeListString.trim()) continue

    let start = Math.max(0, match.index - 100)
    const lastBracket = text.lastIndexOf("【", match.index)
    const lastNewLine = text.lastIndexOf("\n", match.index)
    if (lastBracket > start) start = lastBracket
    if (lastNewLine > start) start = lastNewLine

    let end = Math.min(text.length, match.index + match[0].length + 100)
    const nextBracket = text.indexOf("【", match.index + match[0].length)
    const nextNewLine = text.indexOf("\n", match.index + match[0].length)
    if (nextBracket !== -1 && nextBracket < end) end = nextBracket
    if (nextNewLine !== -1 && nextNewLine < end) end = nextNewLine

    const context = text.slice(start, end)
    const bracketMatch = context.match(BRACKET_RE)
    const bracketName = bracketMatch ? bracketMatch[1] : null

    const locMatch = context.match(LOCATION_RE)
    let locationName = locMatch ? locMatch[1] : null
    if (locationName) locationName = locationName.replace(/^(在|位于|地址|:|：)/, "")

    const genericName = (context.match(GENERIC_RE) || [null])[0]
    const finalCourier = locationName || bracketName || genericName || null

    const snippetStart = lastBracket !== -1 ? lastBracket : Math.max(0, match.index - 40)
    let snippetEnd = text.length
    const nextCourierBracket = text.indexOf("【", match.index + match[0].length)
    if (nextCourierBracket !== -1) snippetEnd = Math.min(snippetEnd, nextCourierBracket)
    const isolatedSnippet = text.slice(snippetStart, snippetEnd).trim()

    const singleCodeRegex = /(\d+-){0,2}\d{3,8}/g
    let singleCodeMatch: RegExpExecArray | null

    while ((singleCodeMatch = singleCodeRegex.exec(codeListString)) !== null) {
      const code = singleCodeMatch[0]
      if (!code) continue
      results.push({
        courier: finalCourier,
        code,
        snippet: isolatedSnippet,
        date: detectedDate,
      })
    }
  }

  return results
}

function splitMessages(data: string): string[] {
  const normalized = data.replace(/(\r\n|\n|\r)/g, "\n").trim()
  if (!normalized) return []

  if (normalized.includes("---SMS-DIVIDER---")) {
    return normalized.split(/---SMS-DIVIDER---/g).map((s) => s.trim()).filter(Boolean)
  }

  const byBracket = normalized.split(/(?=\n?【[^】]{2,20}】)/g).map((s) => s.trim()).filter(Boolean)
  if (byBracket.length > 1) return byBracket

  const byParagraph = normalized.split(/\n{2,}/g).map((s) => s.trim()).filter(Boolean)
  if (byParagraph.length > 1) return byParagraph

  return [normalized]
}

export function handleAnyData(data: string) {
  if (!data.trim()) return 0

  const cfg = loadConfig()
  const existingCodes = new Set(getAllPickupInfo(cfg).map((item) => item.code))
  const deletedCodes = new Set(cfg.deletedCodes)
  let changed = 0

  for (const part of splitMessages(data)) {
    const extracted = extractPickupFromText(part)
    if (!extracted.length) continue

    const now = new Date().toISOString()
    const codes = extracted.map((item) => item.code)
    const hasRestorableCode = codes.some((code) => deletedCodes.has(code))
    const hasNewCode = codes.some((code) => !existingCodes.has(code) && !deletedCodes.has(code))

    if (!hasNewCode && !hasRestorableCode) continue

    const existingIndex = cfg.importedRecords.findIndex((item) => item.text === part)
    if (existingIndex === -1) {
      cfg.importedRecords.unshift({
        text: part,
        importedAt: now,
      })
    } else {
      const [existingRecord] = cfg.importedRecords.splice(existingIndex, 1)
      cfg.importedRecords.unshift({
        text: existingRecord?.text || part,
        importedAt: now,
      })
    }

    if (cfg.importedRecords.length > 100) cfg.importedRecords.splice(100)
    cfg.deletedCodes = cfg.deletedCodes.filter((code) => !codes.includes(code))
    cfg.importedMessages = cfg.importedRecords.map((item) => item.text)

    codes.forEach((code) => {
      deletedCodes.delete(code)
      existingCodes.add(code)
    })
    changed++
  }

  Storage.set(CONFIG_KEY, cfg)
  return changed
}

export function markPicked(code: string) {
  const cfg = loadConfig()
  const found = cfg.pickedItems.find((item) => item.code === code)
  if (found) {
    found.timestamp = Date.now()
  } else {
    cfg.pickedItems.push({ code, timestamp: Date.now() })
  }
  Storage.set(CONFIG_KEY, cfg)
}

export function clearPicked() {
  const cfg = loadConfig()
  cfg.pickedItems = []
  Storage.set(CONFIG_KEY, cfg)
}

export function unmarkPicked(code: string) {
  const cfg = loadConfig()
  cfg.pickedItems = cfg.pickedItems.filter((item) => item.code !== code)
  Storage.set(CONFIG_KEY, cfg)
}

export function deletePickup(code: string) {
  const cfg = loadConfig()
  if (!cfg.deletedCodes.includes(code)) {
    cfg.deletedCodes.push(code)
  }
  cfg.pickedItems = cfg.pickedItems.filter((item) => item.code !== code)
  Storage.set(CONFIG_KEY, cfg)
}

export function getAllPickupInfo(cfg: Config = loadConfig()): PickupInfo[] {
  const pickedMap = new Map(cfg.pickedItems.map((item) => [item.code, item.timestamp]))
  const deletedSet = new Set(cfg.deletedCodes)
  const dedup = new Map<string, PickupInfo>()
  const records: ImportedRecord[] = cfg.importedRecords.length > 0
    ? cfg.importedRecords
    : cfg.importedMessages.map((text) => ({ text, importedAt: null }))

  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    const extracted = extractPickupFromText(record.text)

    for (const item of extracted) {
      if (deletedSet.has(item.code)) continue
      if (dedup.has(item.code)) continue
      const pickedAt = pickedMap.get(item.code)
      const normalizedItem: PickupInfo = {
        ...item,
        importedAt: item.date ? item.date : record.importedAt,
      }

      if (pickedAt && Date.now() - pickedAt < RECENTLY_PICKED_MS) {
        dedup.set(item.code, { ...normalizedItem, picked: true })
      } else if (!pickedAt) {
        dedup.set(item.code, { ...normalizedItem, picked: false })
      }
    }
  }

  return Array.from(dedup.values()).sort((a, b) => {
    const at = a.importedAt ? new Date(a.importedAt).getTime() : 0
    const bt = b.importedAt ? new Date(b.importedAt).getTime() : 0
    return bt - at
  })
}

export function safeRefreshWidget() {
  try {
    ;(Widget as any).reloadAll?.()
  } catch {}
}

export function formatDateText(dateStr: string | null | undefined) {
  if (!dateStr) return "刚导入"
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return "刚导入"
  return d.toLocaleString()
}

export function formatRelativeTimeText(dateStr: string | null | undefined) {
  if (!dateStr) return "未知时间"
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return "未知时间"

  const diffMs = Date.now() - d.getTime()
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))

  if (diffMinutes < 1) return "刚导入"
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} 天前`

  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function statusText(item: PickupInfo) {
  if (item.picked) return "已完成"
  if (!item.date) return "待领取"
  const diff = (Date.now() - new Date(item.date).getTime()) / 3600000
  if (diff <= 12) return "刚到件"
  if (diff <= 36) return "待处理"
  return "请尽快领取"
}

export function statusColor(item: PickupInfo): Color {
  if (item.picked) return "#A1A1AA"
  if (!item.date) return "#6B7280"
  const diff = (Date.now() - new Date(item.date).getTime()) / 3600000
  if (diff <= 12) return "#34C759"
  if (diff <= 36) return "#FF9F0A"
  return "#FF3B30"
}

export function heroCountText(items: PickupInfo[]) {
  const active = items.filter((item) => !item.picked).length
  if (active === 0) return "当前没有待取件"
  if (active === 1) return "当前有 1 个待取件"
  return `当前有 ${active} 个待取件`
}
