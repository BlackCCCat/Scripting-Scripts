import { Widget } from "scripting"

import type { Color } from "scripting"
import type { Config, PickupInfo } from "./types"
import {
  BUSINESS_DB_PATH,
  clearPickedInStore,
  clearPreviewResultsInStore,
  deleteHomePickupInStore,
  deletePreviewPickupInStore,
  getBusinessDataStatsFromStore,
  getHomePickupsFromStore,
  getPendingHomeCodesFromStore,
  getPreviewPickupsFromStore,
  importAnyDataToStore,
  markPickedInStore,
  resetBusinessDataStore,
  unmarkPickedInStore,
} from "./dataStore"

declare const Storage: {
  get(key: string): any
  set(key: string, value: any): boolean
  remove(key: string): void
}

export const CONFIG_KEY = "smsPickup_widget_config_v2"
export const INTENT_DATA_KEY = "smsPickup_intent_data_temp_v2"
export const CLEANUP_DAY_OPTIONS = [3, 7, 14, 30] as const

export const DEFAULT_CONFIG: Config = {
  autoDetectSMS: true,
  keywords: ["菜鸟", "蜂巢", "丰巢", "取件", "取货"],
  widgetShowCount: 5,
  showDate: true,
  autoCleanupPicked: false,
  autoCleanupPreview: false,
  cleanupDays: 7,
  importedMessages: [],
  importedRecords: [],
  pickedItems: [],
  homeDeletedCodes: [],
  previewDeletedCodes: [],
}

export { extractPickupFromText } from "./parser"

export function clampShowCount(value: number) {
  return Math.max(1, Math.min(8, value || DEFAULT_CONFIG.widgetShowCount))
}

export function normalizeKeywords(input: string[]) {
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean)
}

function normalizeCleanupDays(value: number) {
  return CLEANUP_DAY_OPTIONS.includes(value as any)
    ? value
    : DEFAULT_CONFIG.cleanupDays
}

export function loadConfig(): Config {
  try {
    const raw = Storage.get(CONFIG_KEY) || {}
    const merged: Config = { ...DEFAULT_CONFIG, ...raw }
    const legacyDeletedCodes = Array.isArray(raw.deletedCodes) ? raw.deletedCodes : []
    let changed = false

    if (!Array.isArray(merged.keywords)) {
      merged.keywords = String(merged.keywords || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
      changed = true
    }

    if (!Array.isArray(merged.importedMessages)) {
      merged.importedMessages = []
      changed = true
    }

    if (!Array.isArray(merged.importedRecords)) {
      merged.importedRecords = merged.importedMessages.map((text: string) => ({
        text: String(text || ""),
        importedAt: null,
      }))
      changed = true
    }

    if (!Array.isArray(merged.pickedItems)) {
      merged.pickedItems = []
      changed = true
    }

    if (!Array.isArray(merged.homeDeletedCodes)) {
      merged.homeDeletedCodes = [...legacyDeletedCodes]
      changed = true
    }

    if (!Array.isArray(merged.previewDeletedCodes)) {
      merged.previewDeletedCodes = [...legacyDeletedCodes]
      changed = true
    }

    merged.widgetShowCount = clampShowCount(Number(merged.widgetShowCount) || DEFAULT_CONFIG.widgetShowCount)
    merged.keywords = normalizeKeywords(merged.keywords)
    merged.autoDetectSMS = merged.autoDetectSMS !== false
    merged.showDate = merged.showDate !== false
    merged.autoCleanupPicked = raw.autoCleanupPicked === true || raw.autoCleanupProcessed === true
    merged.autoCleanupPreview = raw.autoCleanupPreview === true
    merged.cleanupDays = normalizeCleanupDays(Number(raw.cleanupDays ?? raw.cleanupAfterDays))
    if (changed) {
      Storage.set(CONFIG_KEY, merged)
    }

    return merged
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(next: Partial<Config>) {
  const merged = { ...loadConfig(), ...next }
  merged.keywords = normalizeKeywords(merged.keywords)
  merged.widgetShowCount = clampShowCount(merged.widgetShowCount)
  merged.autoCleanupPicked = merged.autoCleanupPicked === true
  merged.autoCleanupPreview = merged.autoCleanupPreview === true
  merged.cleanupDays = normalizeCleanupDays(Number(merged.cleanupDays))
  return Storage.set(CONFIG_KEY, merged)
}

export async function resetConfig() {
  await resetBusinessDataStore()
  Storage.remove(CONFIG_KEY)
  Storage.remove(INTENT_DATA_KEY)
}
export async function handleAnyData(data: string) {
  return importAnyDataToStore(data)
}

export async function markPicked(code: string) {
  await markPickedInStore(code)
}

export async function clearPicked() {
  await clearPickedInStore()
}

export async function unmarkPicked(code: string) {
  await unmarkPickedInStore(code)
}

export function deletePickup(code: string) {
  return deleteHomePickup(code)
}

export async function deleteHomePickup(code: string) {
  await deleteHomePickupInStore(code)
}

export async function deletePreviewPickup(code: string) {
  await deletePreviewPickupInStore(code)
}

export async function clearPreviewResults() {
  await clearPreviewResultsInStore()
}

export async function getHomePickupInfo(_cfg: Config = loadConfig()): Promise<PickupInfo[]> {
  return getHomePickupsFromStore()
}

export async function getPreviewPickupInfo(_cfg: Config = loadConfig()): Promise<PickupInfo[]> {
  return getPreviewPickupsFromStore()
}

export async function getAllPickupInfo(cfg: Config = loadConfig()): Promise<PickupInfo[]> {
  return getHomePickupInfo(cfg)
}

export async function getPendingHomeCodes() {
  return getPendingHomeCodesFromStore()
}

export async function getBusinessDataStats() {
  return getBusinessDataStatsFromStore()
}

export { BUSINESS_DB_PATH }

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
