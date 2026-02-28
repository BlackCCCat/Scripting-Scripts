import { storage, normalizePath } from "./common"
import { RIME_SUFFIXES_BASE } from "./hamster"

const CONFIG_KEY = "wanxiang_updater_config"
const META_KEY = "wanxiang_meta_store"
const EXTRACTED_KEY = "wanxiang_extracted_files"

const LEGACY_KEYS = [
  "wanxiang_updater_cfg_v2",
  "wanxiang_updater_cfg_v1",
  "wanxiang_meta_store_v1",
  "wanxiang_extracted_files_v1",
]

const RIME_SUFFIXES = [...RIME_SUFFIXES_BASE, "/RimeUserData"]

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



function pathVariants(root: string): string[] {
  const n = normalizePath(root)
  if (!n) return []
  const out = new Set<string>([n])
  if (n.startsWith("/private/")) out.add(n.slice("/private".length))
  else if (n.startsWith("/")) out.add(`/private${n}`)
  return Array.from(out)
}

function relatedRoots(root: string): string[] {
  const out = new Set<string>()
  const base = pathVariants(root)
  const allSuffixes = [...RIME_SUFFIXES]
  // 动态推导 RimeUserData 子目录名
  for (const p of base) {
    const idx = p.indexOf("/RimeUserData/")
    if (idx >= 0) {
      const parts = p.slice(idx).split("/").filter(Boolean)
      if (parts.length >= 2) {
        const ds = `/${parts[0]}/${parts[1]}`
        if (!allSuffixes.includes(ds)) allSuffixes.push(ds)
      }
    }
  }
  for (const p of base) {
    out.add(p)
    for (const s of allSuffixes) {
      out.add(normalizePath(`${p}${s}`))
      if (p.endsWith(s)) out.add(normalizePath(p.slice(0, -s.length)))
    }
  }
  return Array.from(out).filter(Boolean)
}

function isRelatedRoot(a: string, b: string): boolean {
  const x = normalizePath(a)
  const y = normalizePath(b)
  if (!x || !y) return false
  if (x === y) return true
  const s1 = new Set(relatedRoots(x))
  if (s1.has(y)) return true
  const s2 = new Set(relatedRoots(y))
  return s2.has(x)
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

function normalizeMetaData(raw: any): { records: AnyObj; aliases: AnyObj; bookmarks: AnyObj } {
  if (raw && typeof raw === "object" && raw.records && typeof raw.records === "object") {
    return {
      records: raw.records as AnyObj,
      aliases: raw.aliases && typeof raw.aliases === "object" ? (raw.aliases as AnyObj) : {},
      bookmarks: raw.bookmarks && typeof raw.bookmarks === "object" ? (raw.bookmarks as AnyObj) : {},
    }
  }
  if (raw && typeof raw === "object") {
    return { records: raw as AnyObj, aliases: {}, bookmarks: {} }
  }
  return { records: {}, aliases: {}, bookmarks: {} }
}

function cleanupMetaStore(raw: string): string {
  const parsed = normalizeMetaData(parseJson(raw))

  const records: AnyObj = {}
  for (const [k, v] of Object.entries(parsed.records)) {
    const key = normalizePath(k)
    if (!key || !v || typeof v !== "object") continue
    const bucket: AnyObj = {}
    if ((v as AnyObj).scheme) bucket.scheme = (v as AnyObj).scheme
    if ((v as AnyObj).dict) bucket.dict = (v as AnyObj).dict
    if ((v as AnyObj).model) bucket.model = (v as AnyObj).model
    if (bucket.scheme || bucket.dict || bucket.model) records[key] = bucket
  }

  const keys = Object.keys(records)
  const visited = new Set<string>()
  const newRecords: AnyObj = {}
  const newAliases: AnyObj = {}
  const newBookmarks: AnyObj = {}

  const bookmarks = Object.entries(parsed.bookmarks).reduce((acc, [name, target]) => {
    const bk = String(name ?? "").trim()
    const tv = normalizePath(String(target ?? ""))
    if (bk && tv) acc[bk] = tv
    return acc
  }, {} as AnyObj)

  for (const start of keys) {
    if (visited.has(start)) continue
    const cluster: string[] = []
    for (const k of keys) {
      if (!visited.has(k) && isRelatedRoot(start, k)) {
        visited.add(k)
        cluster.push(k)
      }
    }
    if (!cluster.length) continue

    const bookmarkTarget = Object.values(bookmarks)
      .map((v) => normalizePath(String(v)))
      .find((target) => cluster.includes(target))
    const canonical =
      bookmarkTarget ??
      cluster
        .slice()
        .sort((a, b) => {
          const aPrivate = a.startsWith("/private/") ? 1 : 0
          const bPrivate = b.startsWith("/private/") ? 1 : 0
          if (aPrivate !== bPrivate) return aPrivate - bPrivate
          if (a.length !== b.length) return a.length - b.length
          return a.localeCompare(b)
        })[0]

    const merged: AnyObj = {}
    for (const key of cluster) {
      const bucket = records[key] ?? {}
      merged.scheme = pickNewer(merged.scheme, bucket.scheme)
      merged.dict = pickNewer(merged.dict, bucket.dict)
      merged.model = pickNewer(merged.model, bucket.model)
    }
    if (merged.scheme || merged.dict || merged.model) {
      newRecords[canonical] = merged
    }

    for (const key of cluster) {
      if (key !== canonical) newAliases[key] = canonical
    }
    for (const rel of relatedRoots(canonical)) {
      if (rel !== canonical) newAliases[rel] = canonical
    }

    for (const [name, target] of Object.entries(bookmarks)) {
      if (cluster.includes(target)) newBookmarks[name] = canonical
    }
  }

  for (const [name, target] of Object.entries(bookmarks)) {
    if (newBookmarks[name]) continue
    const t = normalizePath(String(target))
    if (!t) continue
    if (newRecords[t]) {
      newBookmarks[name] = t
      continue
    }
    const matched = Object.keys(newRecords).find((k) => isRelatedRoot(k, t))
    if (matched) newBookmarks[name] = matched
  }

  return JSON.stringify({
    records: newRecords,
    aliases: newAliases,
    bookmarks: newBookmarks,
  })
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

