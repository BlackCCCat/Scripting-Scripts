// File: utils/meta.tsx
import type { InputMethod, ProSchemeKey, ReleaseSource, SchemeEdition } from "./config"
import { Runtime } from "./runtime"
import { RIME_SUFFIXES_BASE } from "./hamster"

export type SchemeMeta = {
  remoteIdOrSha: string
  remoteTagOrName: string
  schemeEdition?: SchemeEdition
  proSchemeKey?: ProSchemeKey
  selectedScheme?: string
  releaseSource?: ReleaseSource
  inputMethod?: InputMethod
  updatedAt: string
}

export type DictMeta = {
  remoteIdOrSha: string
  releaseSource?: ReleaseSource
  inputMethod?: InputMethod
  updatedAt: string
}

export type ModelMeta = {
  remoteIdOrSha: string
  releaseSource?: ReleaseSource
  inputMethod?: InputMethod
  updatedAt: string
}

export type MetaBundle = {
  scheme?: SchemeMeta
  dict?: DictMeta
  model?: ModelMeta
}

type RecordData = {
  scheme_file?: string
  scheme_type?: string
  scheme_edition?: string
  pro_scheme_key?: string
  selected_scheme?: string
  dict_file?: string
  model_name?: string
  update_time?: string
  tag?: string
  apply_time?: string
  sha256?: string
  cnb_id?: string
  release_source?: string
  input_method?: string
}

type RecordKind = "scheme" | "dict" | "model"

type RootMetaRecords = {
  scheme?: RecordData
  dict?: RecordData
  model?: RecordData
}

type MetaRecordsMap = Record<string, RootMetaRecords>
type MetaAliasMap = Record<string, string>
type MetaBookmarkMap = Record<string, string>
type MetaStoreData = {
  records: MetaRecordsMap
  aliases: MetaAliasMap
  bookmarks: MetaBookmarkMap
}

const STORAGE_KEY = "wanxiang_meta_store"
const LEGACY_STORAGE_KEYS = ["wanxiang_meta_store_v1"]
const PRO_KEYS: ProSchemeKey[] = ["moqi", "flypy", "zrm", "tiger", "wubi", "hanxin", "shouyou"]
// 静态后缀列表（动态 RimeUserData 子目录名由 relatedRoots 自动推导）
const RIME_SUFFIXES = [...RIME_SUFFIXES_BASE, "/RimeUserData"]

function normalizeRoot(root: string): string {
  return String(root ?? "").trim().replace(/\/+$/, "")
}

function pathVariants(root: string): string[] {
  const n = normalizeRoot(root)
  if (!n) return []
  const set = new Set<string>([n])
  if (n.startsWith("/private/")) set.add(n.slice("/private".length))
  else if (n.startsWith("/")) set.add(`/private${n}`)
  return Array.from(set)
}

function relatedRoots(root: string): string[] {
  const base = pathVariants(root)
  const out = new Set<string>(base)

  // 静态后缀 + 从路径中动态推导的后缀
  const allSuffixes = [...RIME_SUFFIXES]

  // 从输入路径中动态推导 RimeUserData 子目录名
  // 例如路径 /root/RimeUserData/myscheme → 推导出后缀 /RimeUserData/myscheme
  for (const p of base) {
    const rimeUserDataIdx = p.indexOf("/RimeUserData/")
    if (rimeUserDataIdx >= 0) {
      const afterRimeUserData = p.slice(rimeUserDataIdx)
      // afterRimeUserData 形如 /RimeUserData/myscheme 或 /RimeUserData/myscheme/sub
      // 取到子目录名级别
      const parts = afterRimeUserData.split("/").filter(Boolean) // ["RimeUserData", "myscheme", ...]
      if (parts.length >= 2) {
        const dynamicSuffix = `/${parts[0]}/${parts[1]}`
        if (!allSuffixes.includes(dynamicSuffix)) {
          allSuffixes.push(dynamicSuffix)
        }
      }
    }
  }

  for (const p of base) {
    for (const s of allSuffixes) {
      out.add(normalizeRoot(`${p}${s}`))
      if (p.endsWith(s)) {
        out.add(normalizeRoot(p.slice(0, -s.length)))
      }
    }
  }
  return Array.from(out).filter(Boolean)
}

function storage(): any {
  return (globalThis as any).Storage ?? Runtime.Storage
}

function pathKey(p: string): string {
  return normalizeRoot(p)
}

function bookmarkKey(name?: string): string {
  return String(name ?? "").trim()
}

function isRelatedRoot(a: string, b: string): boolean {
  const x = pathKey(a)
  const y = pathKey(b)
  if (!x || !y) return false
  if (x === y) return true
  const relX = new Set(relatedRoots(x).map(pathKey))
  if (relX.has(y)) return true
  const relY = new Set(relatedRoots(y).map(pathKey))
  return relY.has(x)
}

function mergeMissingKinds(target: RootMetaRecords, source?: RootMetaRecords): RootMetaRecords {
  if (!source) return target
  if (!target.scheme && source.scheme) target.scheme = source.scheme
  if (!target.dict && source.dict) target.dict = source.dict
  if (!target.model && source.model) target.model = source.model
  return target
}

function normalizeStore(raw: any): MetaStoreData {
  if (raw && typeof raw === "object" && raw.records && typeof raw.records === "object") {
    const records = raw.records && typeof raw.records === "object" ? (raw.records as MetaRecordsMap) : {}
    const aliases = raw.aliases && typeof raw.aliases === "object" ? (raw.aliases as MetaAliasMap) : {}
    const bookmarks = raw.bookmarks && typeof raw.bookmarks === "object" ? (raw.bookmarks as MetaBookmarkMap) : {}
    return { records, aliases, bookmarks }
  }
  // 兼容旧结构：直接是 { [root]: records }
  if (raw && typeof raw === "object") {
    return { records: raw as MetaRecordsMap, aliases: {}, bookmarks: {} }
  }
  return { records: {}, aliases: {}, bookmarks: {} }
}

function loadStore(): MetaStoreData {
  const st = storage()
  try {
    let raw = st?.get?.(STORAGE_KEY) ?? st?.getString?.(STORAGE_KEY)
    if (!raw) {
      for (const key of LEGACY_STORAGE_KEYS) {
        raw = st?.get?.(key) ?? st?.getString?.(key)
        if (raw) break
      }
    }
    if (!raw) return { records: {}, aliases: {}, bookmarks: {} }
    const obj = JSON.parse(String(raw))
    const normalized = normalizeStore(obj)
    const current = st?.get?.(STORAGE_KEY) ?? st?.getString?.(STORAGE_KEY)
    if (!current) saveStore(normalized)
    return normalized
  } catch {
    return { records: {}, aliases: {}, bookmarks: {} }
  }
}

function saveStore(data: MetaStoreData) {
  const st = storage()
  const raw = JSON.stringify(data ?? {})
  if (st?.set) st.set(STORAGE_KEY, raw)
  else if (st?.setString) st.setString(STORAGE_KEY, raw)
}

function readRecord(installRoot: string, kind: RecordKind, bookmarkName?: string): RecordData | undefined {
  const root = normalizeRoot(installRoot)
  const data = loadStore()
  const bkey = bookmarkKey(bookmarkName)
  const bindBookmark = (targetRoot: string) => {
    if (!bkey) return
    const canonical = pathKey(targetRoot)
    if (!canonical) return
    if (data.bookmarks[bkey] === canonical) return
    data.bookmarks[bkey] = canonical
    saveStore(data)
  }
  if (bkey) {
    const mapped = pathKey(data.bookmarks[bkey] ?? "")
    if (mapped) {
      const byBookmark = data.records[mapped]?.[kind]
      if (byBookmark) return byBookmark
    }
  }
  if (!root) {
    // 路径为空但有书签名时，尝试通过书签映射反查记录
    if (bkey) {
      for (const rk of Object.keys(data.records)) {
        if (data.records[rk]?.[kind]) {
          bindBookmark(rk)
          return data.records[rk][kind]
        }
      }
    }
    return undefined
  }
  const resolveAlias = (k: string): string => {
    const key = pathKey(k)
    return data.aliases[key] ? pathKey(data.aliases[key]) : key
  }
  for (const key of relatedRoots(root)) {
    const rkey = pathKey(key)
    const recDirect = data.records[rkey]?.[kind]
    if (recDirect) {
      bindBookmark(rkey)
      return recDirect
    }
    const aliased = resolveAlias(rkey)
    const rec = data.records[aliased]?.[kind]
    if (rec) {
      bindBookmark(aliased)
      return rec
    }
  }
  // 兜底：扫描已有 key，避免旧数据路径形态不一致时漏读
  for (const k of Object.keys(data.records)) {
    const key = pathKey(k)
    for (const cand of relatedRoots(root)) {
      const c = pathKey(cand)
      if (key === c || key.endsWith(c) || c.endsWith(key)) {
        const rec = data.records[key]?.[kind]
        if (rec) {
          bindBookmark(key)
          return rec
        }
      }
    }
  }
  // 最终兜底：通过书签名映射查找（权限重新授予后路径可能完全变化）
  if (bkey) {
    const mapped = pathKey(data.bookmarks[bkey] ?? "")
    if (mapped && data.records[mapped]?.[kind]) {
      return data.records[mapped][kind]
    }
  }
  return undefined
}

function writeRecord(installRoot: string, kind: RecordKind, rec: RecordData, bookmarkName?: string) {
  const root = normalizeRoot(installRoot)
  if (!root) return
  const data = loadStore()
  const bkey = bookmarkKey(bookmarkName)
  const canonicalFromPath = pathKey(root)
  const mappedBookmark = bkey ? pathKey(data.bookmarks[bkey] ?? "") : ""

  let canonical = canonicalFromPath
  if (mappedBookmark) {
    if (isRelatedRoot(mappedBookmark, canonicalFromPath)) {
      canonical = mappedBookmark
    } else {
      // 同一书签切到新路径时：不提前删除旧记录，
      // 让下方 candidateKeys 循环统一合并后再清理，
      // 避免丢失其他 kind（如 scheme/model）的数据。
      canonical = canonicalFromPath
    }
  } else {
    // 无书签名时，优先复用同路径家族已有记录
    for (const r of relatedRoots(canonicalFromPath)) {
      const rk = pathKey(r)
      if (rk && data.records[rk]) {
        canonical = rk
        break
      }
      const aliased = pathKey(data.aliases[rk] ?? "")
      if (aliased && data.records[aliased]) {
        canonical = aliased
        break
      }
    }
  }

  let bucket: RootMetaRecords = { ...(data.records[canonical] ?? {}) }

  // 合并同一路径家族中的碎片记录，避免仅更新方案/词库后丢失模型信息
  const candidateKeys = new Set<string>()
  for (const r of relatedRoots(canonicalFromPath)) {
    const rk = pathKey(r)
    if (rk) candidateKeys.add(rk)
    const aliased = pathKey(data.aliases[rk] ?? "")
    if (aliased) candidateKeys.add(aliased)
  }
  if (mappedBookmark) candidateKeys.add(mappedBookmark)
  for (const key of candidateKeys) {
    if (!key || key === canonical) continue
    if (data.records[key]) {
      bucket = mergeMissingKinds(bucket, data.records[key])
      delete data.records[key]
    }
  }

  bucket[kind] = rec
  data.records[canonical] = bucket

  // 清理失效 alias
  for (const aliasKey of Object.keys(data.aliases)) {
    const target = pathKey(data.aliases[aliasKey])
    if (!target || !data.records[target]) {
      delete data.aliases[aliasKey]
    }
  }

  // 为同一路径的变体建立别名，便于通过“书签路径/实际rime路径”互相命中
  for (const key of relatedRoots(canonical)) {
    data.aliases[pathKey(key)] = canonical
  }
  data.aliases[canonicalFromPath] = canonical
  if (bkey) data.bookmarks[bkey] = canonical
  saveStore(data)
}

export function clearMetaForRoot(installRoot: string) {
  const root = normalizeRoot(installRoot)
  if (!root) return
  const data = loadStore()
  const canonicalSet = new Set<string>()
  for (const key of relatedRoots(root)) {
    const k = pathKey(key)
    const target = data.aliases[k] ? pathKey(data.aliases[k]) : k
    canonicalSet.add(target)
  }
  let changed = false
  for (const key of canonicalSet) {
    if (data.records[key]) {
      delete data.records[key]
      changed = true
    }
  }
  for (const key of Object.keys(data.aliases)) {
    const target = pathKey(data.aliases[key])
    if (canonicalSet.has(target)) {
      delete data.aliases[key]
      changed = true
    }
  }
  for (const key of Object.keys(data.bookmarks)) {
    const target = pathKey(data.bookmarks[key])
    if (canonicalSet.has(target)) {
      delete data.bookmarks[key]
      changed = true
    }
  }
  if (!changed) return
  saveStore(data)
}

function pickRemoteId(rec: RecordData, fallback?: string): string | undefined {
  return rec.sha256 || rec.cnb_id || fallback
}

function normalizeReleaseSource(v?: string): ReleaseSource | undefined {
  const x = String(v ?? "").trim().toLowerCase()
  if (x === "cnb" || x === "github") return x
  return undefined
}

function inferReleaseSource(rec?: RecordData): ReleaseSource | undefined {
  if (!rec) return undefined
  const fromField = normalizeReleaseSource(rec.release_source)
  if (fromField) return fromField
  if (rec.sha256) return "github"
  if (rec.cnb_id) return "cnb"
  return undefined
}

function normalizeInputMethod(v?: string): InputMethod | undefined {
  const x = String(v ?? "").trim().toLowerCase()
  if (x === "hamster" || x === "hamster3") return x
  if (x === "cang") return "hamster"
  if (x === "yushu" || x === "yuanshu") return "hamster3"
  return undefined
}

function normalizeSchemeEdition(v?: string): SchemeEdition | undefined {
  const x = String(v ?? "").trim().toLowerCase()
  if (x === "base" || x === "pro") return x
  return undefined
}

function normalizeProSchemeKey(v?: string): ProSchemeKey | undefined {
  const x = String(v ?? "").trim().toLowerCase()
  return (PRO_KEYS as string[]).includes(x) ? (x as ProSchemeKey) : undefined
}

function inferSchemeFromFile(fileName?: string): { schemeEdition?: SchemeEdition; proSchemeKey?: ProSchemeKey } {
  const x = String(fileName ?? "").toLowerCase()
  if (!x) return {}
  if (x.includes("base")) return { schemeEdition: "base" }
  for (const key of PRO_KEYS) {
    if (x.includes(key)) return { schemeEdition: "pro", proSchemeKey: key }
  }
  if (x.includes("pro")) return { schemeEdition: "pro" }
  return {}
}

function formatSelectedScheme(schemeEdition?: SchemeEdition, proSchemeKey?: ProSchemeKey): string | undefined {
  if (schemeEdition === "base") return "base"
  if (schemeEdition === "pro") return proSchemeKey ? `pro (${proSchemeKey})` : "pro"
  return undefined
}

function toSchemeMeta(rec?: RecordData): SchemeMeta | undefined {
  if (!rec) return undefined
  const remoteTagOrName = rec.tag || rec.scheme_file
  const remoteIdOrSha = pickRemoteId(rec, remoteTagOrName)
  if (!remoteTagOrName || !remoteIdOrSha) return undefined
  const inferred = inferSchemeFromFile(rec.scheme_file)
  const schemeEdition =
    normalizeSchemeEdition(rec.scheme_edition) ??
    normalizeSchemeEdition(rec.scheme_type) ??
    inferred.schemeEdition
  const proSchemeKey =
    schemeEdition === "pro" ? normalizeProSchemeKey(rec.pro_scheme_key) ?? inferred.proSchemeKey : undefined
  const selectedScheme = String(rec.selected_scheme ?? "").trim() || formatSelectedScheme(schemeEdition, proSchemeKey)
  return {
    remoteIdOrSha,
    remoteTagOrName,
    schemeEdition,
    proSchemeKey,
    selectedScheme,
    releaseSource: inferReleaseSource(rec),
    inputMethod: normalizeInputMethod(rec.input_method),
    updatedAt: rec.update_time || rec.apply_time || new Date().toISOString(),
  }
}

function toDictMeta(rec?: RecordData): DictMeta | undefined {
  if (!rec) return undefined
  const remoteIdOrSha = pickRemoteId(rec, rec.dict_file)
  if (!remoteIdOrSha) return undefined
  return {
    remoteIdOrSha,
    releaseSource: inferReleaseSource(rec),
    inputMethod: normalizeInputMethod(rec.input_method),
    updatedAt: rec.update_time || rec.apply_time || new Date().toISOString(),
  }
}

function toModelMeta(rec?: RecordData): ModelMeta | undefined {
  if (!rec) return undefined
  const remoteIdOrSha = pickRemoteId(rec, rec.model_name)
  if (!remoteIdOrSha) return undefined
  return {
    remoteIdOrSha,
    releaseSource: inferReleaseSource(rec),
    inputMethod: normalizeInputMethod(rec.input_method),
    updatedAt: rec.update_time || rec.apply_time || new Date().toISOString(),
  }
}

function splitRemoteId(source: ReleaseSource | undefined, remoteIdOrSha?: string) {
  if (!remoteIdOrSha) return { sha256: "", cnb_id: "" }
  if (source === "github") return { sha256: remoteIdOrSha, cnb_id: "" }
  if (source === "cnb") return { sha256: "", cnb_id: remoteIdOrSha }
  return { sha256: remoteIdOrSha, cnb_id: "" }
}

let CACHE: MetaBundle = {}

export async function loadMetaAsync(installRoot: string, bookmarkName?: string): Promise<MetaBundle> {
  const root = normalizeRoot(installRoot)
  if (!root && !bookmarkKey(bookmarkName)) {
    CACHE = {}
    return CACHE
  }
  const schemeRec = readRecord(root, "scheme", bookmarkName)
  const dictRec = readRecord(root, "dict", bookmarkName)
  const modelRec = readRecord(root, "model", bookmarkName)
  CACHE = {
    scheme: toSchemeMeta(schemeRec),
    dict: toDictMeta(dictRec),
    model: toModelMeta(modelRec),
  }
  return CACHE
}

export async function setSchemeMeta(rec: {
  installRoot: string
  bookmarkName?: string
  fileName: string
  schemeEdition: SchemeEdition
  proSchemeKey?: ProSchemeKey
  inputMethod?: InputMethod
  tag?: string
  updatedAt?: string
  remoteIdOrSha?: string
  source?: ReleaseSource
}) {
  const ids = splitRemoteId(rec.source, rec.remoteIdOrSha)
  const proSchemeKey = rec.schemeEdition === "pro" ? rec.proSchemeKey : undefined
  const data: RecordData = {
    scheme_file: rec.fileName,
    scheme_type: rec.schemeEdition,
    scheme_edition: rec.schemeEdition,
    pro_scheme_key: proSchemeKey ?? "",
    selected_scheme: formatSelectedScheme(rec.schemeEdition, proSchemeKey) ?? "",
    update_time: rec.updatedAt ?? new Date().toISOString(),
    tag: rec.tag ?? "",
    apply_time: new Date().toISOString(),
    sha256: ids.sha256,
    cnb_id: ids.cnb_id,
    release_source: rec.source ?? "",
    input_method: rec.inputMethod ?? "",
  }
  writeRecord(rec.installRoot, "scheme", data, rec.bookmarkName)
  await loadMetaAsync(rec.installRoot, rec.bookmarkName)
}

export async function setDictMeta(rec: {
  installRoot: string
  bookmarkName?: string
  fileName: string
  inputMethod?: InputMethod
  tag?: string
  updatedAt?: string
  remoteIdOrSha?: string
  source?: ReleaseSource
}) {
  const ids = splitRemoteId(rec.source, rec.remoteIdOrSha)
  const data: RecordData = {
    dict_file: rec.fileName,
    update_time: rec.updatedAt ?? new Date().toISOString(),
    tag: rec.tag ?? "",
    apply_time: new Date().toISOString(),
    sha256: ids.sha256,
    cnb_id: ids.cnb_id,
    release_source: rec.source ?? "",
    input_method: rec.inputMethod ?? "",
  }
  writeRecord(rec.installRoot, "dict", data, rec.bookmarkName)
  await loadMetaAsync(rec.installRoot, rec.bookmarkName)
}

export async function setModelMeta(rec: {
  installRoot: string
  bookmarkName?: string
  fileName: string
  inputMethod?: InputMethod
  tag?: string
  updatedAt?: string
  remoteIdOrSha?: string
  source?: ReleaseSource
}) {
  const ids = splitRemoteId(rec.source, rec.remoteIdOrSha)
  const data: RecordData = {
    model_name: rec.fileName,
    update_time: rec.updatedAt ?? new Date().toISOString(),
    tag: rec.tag ?? "",
    apply_time: new Date().toISOString(),
    sha256: ids.sha256,
    cnb_id: ids.cnb_id,
    release_source: rec.source ?? "",
    input_method: rec.inputMethod ?? "",
  }
  writeRecord(rec.installRoot, "model", data, rec.bookmarkName)
  await loadMetaAsync(rec.installRoot, rec.bookmarkName)
}
