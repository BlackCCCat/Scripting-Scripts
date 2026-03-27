// File: utils/meta.tsx
import type { InputMethod, ProSchemeKey, ReleaseSource, SchemeEdition } from "./config"
import { PRO_KEYS } from "./config"
import { storage } from "./common"

export type SchemeMeta = {
  remoteIdOrSha: string
  remoteTagOrName: string
  usePrereleaseScheme?: boolean
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
  predict_name?: string
  update_time?: string
  tag?: string
  apply_time?: string
  sha256?: string
  cnb_id?: string
  release_source?: string
  input_method?: string
  prerelease_scheme?: string
}

type RecordKind = "scheme" | "dict" | "model" | "predict"

type RootMetaRecords = {
  scheme?: RecordData
  dict?: RecordData
  model?: RecordData
  predict?: RecordData
}

type MetaRecordsMap = Record<string, RootMetaRecords>
type MetaBookmarkMap = Record<string, string>
type MetaStoreData = {
  records: MetaRecordsMap
  bookmarks: MetaBookmarkMap
}

const STORAGE_KEY = "wanxiang_meta_store"
const LEGACY_STORAGE_KEYS = ["wanxiang_meta_store_v1"]

function normalizeRoot(root: string): string {
  return String(root ?? "").trim().replace(/\/+$/, "")
}

function pathKey(p: string): string {
  return normalizeRoot(p)
}

function pathVariants(root: string): string[] {
  const n = pathKey(root)
  if (!n) return []
  const set = new Set<string>([n])
  if (n.startsWith("/private/")) set.add(n.slice("/private".length))
  else if (n.startsWith("/")) set.add(`/private${n}`)
  return Array.from(set)
}

function bookmarkKey(name?: string): string {
  return String(name ?? "").trim()
}

function mergeMissingKinds(target: RootMetaRecords, source?: RootMetaRecords): RootMetaRecords {
  if (!source) return target
  if (!target.scheme && source.scheme) target.scheme = source.scheme
  if (!target.dict && source.dict) target.dict = source.dict
  if (!target.model && source.model) target.model = source.model
  if (!target.predict && source.predict) target.predict = source.predict
  return target
}

function normalizeStore(raw: any): MetaStoreData {
  if (raw && typeof raw === "object" && raw.records && typeof raw.records === "object") {
    const records = raw.records && typeof raw.records === "object" ? (raw.records as MetaRecordsMap) : {}
    const bookmarks = raw.bookmarks && typeof raw.bookmarks === "object" ? (raw.bookmarks as MetaBookmarkMap) : {}
    return { records, bookmarks }
  }
  if (raw && typeof raw === "object") {
    return { records: raw as MetaRecordsMap, bookmarks: {} }
  }
  return { records: {}, bookmarks: {} }
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
    if (!raw) return { records: {}, bookmarks: {} }
    const obj = JSON.parse(String(raw))
    const normalized = normalizeStore(obj)
    const current = st?.get?.(STORAGE_KEY) ?? st?.getString?.(STORAGE_KEY)
    if (!current) saveStore(normalized)
    return normalized
  } catch {
    return { records: {}, bookmarks: {} }
  }
}

function saveStore(data: MetaStoreData) {
  const st = storage()
  const raw = JSON.stringify(data ?? {})
  if (st?.set) st.set(STORAGE_KEY, raw)
  else if (st?.setString) st.setString(STORAGE_KEY, raw)
}

function findExactRecordKey(records: MetaRecordsMap, root: string): string {
  for (const variant of pathVariants(root)) {
    const key = pathKey(variant)
    if (key && records[key]) return key
  }
  return ""
}

function rebindBookmark(data: MetaStoreData, bookmarkName?: string, targetRoot?: string): boolean {
  const bkey = bookmarkKey(bookmarkName)
  const canonical = pathKey(String(targetRoot ?? ""))
  if (!bkey || !canonical) return false
  if (data.bookmarks[bkey] === canonical) return false
  data.bookmarks[bkey] = canonical
  return true
}

function cleanupBookmarks(data: MetaStoreData): boolean {
  let changed = false
  for (const name of Object.keys(data.bookmarks)) {
    const target = pathKey(data.bookmarks[name] ?? "")
    if (!target || !data.records[target]) {
      delete data.bookmarks[name]
      changed = true
    }
  }
  return changed
}

function readRecord(installRoot: string, kind: RecordKind, bookmarkName?: string): RecordData | undefined {
  const root = normalizeRoot(installRoot)
  const data = loadStore()

  if (root) {
    const exact = findExactRecordKey(data.records, root)
    if (exact && data.records[exact]?.[kind]) {
      if (rebindBookmark(data, bookmarkName, exact)) saveStore(data)
      return data.records[exact][kind]
    }
    return undefined
  }

  const bkey = bookmarkKey(bookmarkName)
  if (!bkey) return undefined
  const mapped = findExactRecordKey(data.records, data.bookmarks[bkey] ?? "")
  if (!mapped || !data.records[mapped]?.[kind]) return undefined
  if (rebindBookmark(data, bkey, mapped)) saveStore(data)
  return data.records[mapped][kind]
}

function writeRecord(installRoot: string, kind: RecordKind, rec: RecordData, bookmarkName?: string) {
  const root = normalizeRoot(installRoot)
  if (!root) return

  const data = loadStore()
  const canonical = findExactRecordKey(data.records, root) || pathKey(root)
  const bkey = bookmarkKey(bookmarkName)
  const mappedBookmark = bkey ? findExactRecordKey(data.records, data.bookmarks[bkey] ?? "") : ""

  let bucket: RootMetaRecords = { ...(data.records[canonical] ?? {}) }
  if (mappedBookmark && mappedBookmark !== canonical && data.records[mappedBookmark]) {
    bucket = mergeMissingKinds(bucket, data.records[mappedBookmark])
    delete data.records[mappedBookmark]
  }

  bucket[kind] = rec
  data.records[canonical] = bucket
  rebindBookmark(data, bkey, canonical)
  cleanupBookmarks(data)
  saveStore(data)
}

export function clearMetaForRoot(installRoot: string) {
  const root = normalizeRoot(installRoot)
  if (!root) return

  const data = loadStore()
  const keys = new Set<string>(pathVariants(root).map(pathKey).filter(Boolean))
  let changed = false

  for (const key of keys) {
    if (data.records[key]) {
      delete data.records[key]
      changed = true
    }
  }
  for (const name of Object.keys(data.bookmarks)) {
    const target = pathKey(data.bookmarks[name] ?? "")
    if (keys.has(target)) {
      delete data.bookmarks[name]
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
    usePrereleaseScheme: String(rec.prerelease_scheme ?? "").trim() === "1",
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
  usePrereleaseScheme?: boolean
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
    prerelease_scheme: rec.usePrereleaseScheme ? "1" : "0",
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
