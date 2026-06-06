import type { PickupInfo } from "./types"

declare const Storage: {
  get<T>(key: string): T | null
  set<T>(key: string, value: T): boolean
}

export const WIDGET_DATA_KEY = "smsPickup_widget_data_cache_v1"
export const WIDGET_ACTIONS_KEY = "smsPickup_widget_actions_v1"
const CONFIG_KEY = "smsPickup_widget_config_v2"

export type WidgetAction =
  | { type: "toggle"; code: string; createdAt: number }
  | { type: "markAll"; createdAt: number }

export type WidgetDataCache = {
  items: PickupInfo[]
  showCount: number
  updatedAt: number
}

function fallbackShowCount() {
  const cfg = Storage.get<{ widgetShowCount?: number }>(CONFIG_KEY) || {}
  return Math.max(1, Math.min(8, Number(cfg.widgetShowCount) || 5))
}

export function loadWidgetData(): WidgetDataCache {
  const cache = Storage.get<WidgetDataCache>(WIDGET_DATA_KEY)
  if (cache && Array.isArray(cache.items)) {
    return {
      items: cache.items,
      showCount: Math.max(1, Math.min(8, Number(cache.showCount) || fallbackShowCount())),
      updatedAt: Number(cache.updatedAt) || 0,
    }
  }

  return {
    items: [],
    showCount: fallbackShowCount(),
    updatedAt: 0,
  }
}

export function saveWidgetData(items: PickupInfo[], showCount: number) {
  return Storage.set(WIDGET_DATA_KEY, {
    items,
    showCount: Math.max(1, Math.min(8, showCount || fallbackShowCount())),
    updatedAt: Date.now(),
  })
}

export function applyWidgetToggleToCache(code: string) {
  const cache = loadWidgetData()
  saveWidgetData(cache.items.filter((item) => item.code !== code), cache.showCount)
}

export function clearWidgetCacheItems() {
  const cache = loadWidgetData()
  saveWidgetData([], cache.showCount)
}

export function appendWidgetAction(action: WidgetAction) {
  const actions = Storage.get<WidgetAction[]>(WIDGET_ACTIONS_KEY) || []
  actions.push(action)
  Storage.set(WIDGET_ACTIONS_KEY, actions.slice(-50))
}

export function takeWidgetActions() {
  const actions = Storage.get<WidgetAction[]>(WIDGET_ACTIONS_KEY) || []
  Storage.set(WIDGET_ACTIONS_KEY, [])
  return actions
}
