import type { AppConfig } from "./config"
import type { AllUpdateResult } from "./update_tasks"
import { storage } from "./common"

export type CachedUpdateDecision = {
  scheme: boolean
  dict: boolean
  model: boolean
}

type SharedCheckCache = {
  key: string
  remote: AllUpdateResult
  decision: CachedUpdateDecision
  savedAt: string
}

const STORAGE_KEY = "wanxiang_check_cache"

function readValue(st: any, key: string): string {
  if (!st) return ""
  if (typeof st.get === "function") return String(st.get(key) ?? "")
  if (typeof st.getItem === "function") return String(st.getItem(key) ?? "")
  return ""
}

function writeValue(st: any, key: string, value: string) {
  if (!st) return
  if (typeof st.set === "function") st.set(key, value)
  else if (typeof st.setItem === "function") st.setItem(key, value)
}

export function getCheckCacheKey(cfg: AppConfig) {
  return [cfg.releaseSource, cfg.schemeEdition, cfg.proSchemeKey, cfg.hamsterRootPath, cfg.hamsterBookmarkName].join("|")
}

export function loadSharedCheckCache(): SharedCheckCache | null {
  try {
    const raw = readValue(storage(), STORAGE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== "object") return null
    if (typeof obj.key !== "string" || !obj.remote || !obj.decision) return null
    return obj as SharedCheckCache
  } catch {
    return null
  }
}

export function saveSharedCheckCache(cfg: AppConfig, remote: AllUpdateResult, decision: CachedUpdateDecision) {
  const payload: SharedCheckCache = {
    key: getCheckCacheKey(cfg),
    remote,
    decision,
    savedAt: new Date().toISOString(),
  }
  writeValue(storage(), STORAGE_KEY, JSON.stringify(payload))
}

export function clearSharedCheckCache() {
  writeValue(storage(), STORAGE_KEY, "")
}
