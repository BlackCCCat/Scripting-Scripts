import { storage, normalizePath } from "./common"

const CONFIG_KEY = "wanxiang_updater_config"
const META_KEY = "wanxiang_meta_store"
const EXTRACTED_KEY = "wanxiang_extracted_files"

const LEGACY_KEYS = [
  "wanxiang_updater_cfg_v2",
  "wanxiang_updater_cfg_v1",
  "wanxiang_meta_store_v1",
  "wanxiang_extracted_files_v1",
]

type AnyObj = Record<string, any>

function getRaw(st: any, key: string): string {
  const v = st?.get?.(key) ?? st?.getString?.(key)
  return typeof v === "string" ? v : ""
}

function setRaw(st: any, key: string, value: string) {
  if (st?.set) st.set(key, value)
  else if (st?.setString) st.setString(key, value)
}

function removeKey(st: any, key: string) {
  try {
    if (st?.remove) st.remove(key)
  } catch { }
}

function parseJson(raw: string): any {
  try {
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

function firstExistingRaw(st: any, keys: string[]): string {
  for (const key of keys) {
    const raw = getRaw(st, key)
    if (raw) return raw
  }
  return ""
}

function mergeConfig(st: any) {
  const current = getRaw(st, CONFIG_KEY)
  if (current) return
  const legacy = firstExistingRaw(st, ["wanxiang_updater_cfg_v2", "wanxiang_updater_cfg_v1"])
  if (legacy) setRaw(st, CONFIG_KEY, legacy)
}

function mergeExtracted(st: any) {
  const current = getRaw(st, EXTRACTED_KEY)
  if (current) return
  const legacy = getRaw(st, "wanxiang_extracted_files_v1")
  if (legacy) setRaw(st, EXTRACTED_KEY, legacy)
}

function pickNewer(a: any, b: any): any {
  if (!a) return b
  if (!b) return a
  const ta = Date.parse(String(a?.apply_time ?? a?.update_time ?? ""))
  const tb = Date.parse(String(b?.apply_time ?? b?.update_time ?? ""))
  if (Number.isFinite(tb) && Number.isFinite(ta)) return tb >= ta ? b : a
  return b
}

function normalizeMetaData(raw: any): { records: AnyObj; bookmarks: AnyObj } {
  if (raw && typeof raw === "object" && raw.records && typeof raw.records === "object") {
    return {
      records: raw.records as AnyObj,
      bookmarks: raw.bookmarks && typeof raw.bookmarks === "object" ? (raw.bookmarks as AnyObj) : {},
    }
  }
  if (raw && typeof raw === "object") {
    return { records: raw as AnyObj, bookmarks: {} }
  }
  return { records: {}, bookmarks: {} }
}

function comparablePath(path: string): string {
  const normalized = normalizePath(path)
  return normalized.startsWith("/private/") ? normalized.slice("/private".length) : normalized
}

function chooseCanonicalPath(paths: string[]): string {
  return paths
    .slice()
    .sort((a, b) => {
      const aPrivate = a.startsWith("/private/") ? 0 : 1
      const bPrivate = b.startsWith("/private/") ? 0 : 1
      if (aPrivate !== bPrivate) return aPrivate - bPrivate
      if (a.length !== b.length) return a.length - b.length
      return a.localeCompare(b)
    })[0]
}

function cleanupMetaStore(raw: string): string {
  const parsed = normalizeMetaData(parseJson(raw))

  const grouped = new Map<string, string[]>()
  const normalizedRecords: AnyObj = {}
  for (const [k, v] of Object.entries(parsed.records)) {
    const key = normalizePath(k)
    if (!key || !v || typeof v !== "object") continue
    const bucket: AnyObj = {}
    if ((v as AnyObj).scheme) bucket.scheme = (v as AnyObj).scheme
    if ((v as AnyObj).dict) bucket.dict = (v as AnyObj).dict
    if ((v as AnyObj).model) bucket.model = (v as AnyObj).model
    if (!bucket.scheme && !bucket.dict && !bucket.model) continue
    normalizedRecords[key] = bucket
    const cmp = comparablePath(key)
    const list = grouped.get(cmp) ?? []
    list.push(key)
    grouped.set(cmp, list)
  }

  const records: AnyObj = {}
  const remap = new Map<string, string>()
  for (const list of grouped.values()) {
    const canonical = chooseCanonicalPath(list)
    const merged: AnyObj = {}
    for (const key of list) {
      const bucket = normalizedRecords[key] ?? {}
      merged.scheme = pickNewer(merged.scheme, bucket.scheme)
      merged.dict = pickNewer(merged.dict, bucket.dict)
      merged.model = pickNewer(merged.model, bucket.model)
      remap.set(key, canonical)
    }
    if (merged.scheme || merged.dict || merged.model) {
      records[canonical] = merged
    }
  }

  const bookmarks: AnyObj = {}
  for (const [name, target] of Object.entries(parsed.bookmarks)) {
    const bk = String(name ?? "").trim()
    const normalizedTarget = normalizePath(String(target ?? ""))
    if (!bk || !normalizedTarget) continue
    const mapped = remap.get(normalizedTarget)
    if (mapped && records[mapped]) {
      bookmarks[bk] = mapped
      continue
    }
    const cmp = comparablePath(normalizedTarget)
    const candidates = grouped.get(cmp) ?? []
    if (!candidates.length) continue
    const canonical = chooseCanonicalPath(candidates)
    if (records[canonical]) bookmarks[bk] = canonical
  }

  return JSON.stringify({ records, bookmarks })
}

function mergeMeta(st: any) {
  const currentRaw = getRaw(st, META_KEY)
  const legacyRaw = getRaw(st, "wanxiang_meta_store_v1")
  const source = currentRaw || legacyRaw
  if (!source) return
  const cleaned = cleanupMetaStore(source)
  if (cleaned !== currentRaw) {
    setRaw(st, META_KEY, cleaned)
  }
}

export function runStorageMigration() {
  const st = storage()
  if (!st) return

  mergeConfig(st)
  mergeExtracted(st)
  mergeMeta(st)

  for (const key of LEGACY_KEYS) {
    removeKey(st, key)
  }
}
