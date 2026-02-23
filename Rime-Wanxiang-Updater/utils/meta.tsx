// File: utils/meta.tsx
import type { ProSchemeKey, ReleaseSource, SchemeEdition } from "./config"
import { Runtime } from "./runtime"

export type SchemeMeta = {
  remoteIdOrSha: string
  remoteTagOrName: string
  schemeEdition?: SchemeEdition
  proSchemeKey?: ProSchemeKey
  selectedScheme?: string
  updatedAt: string
}

export type DictMeta = {
  remoteIdOrSha: string
  updatedAt: string
}

export type ModelMeta = {
  remoteIdOrSha: string
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
}

type RecordKind = "scheme" | "dict" | "model"

type RootMetaRecords = {
  scheme?: RecordData
  dict?: RecordData
  model?: RecordData
}

type MetaStoreData = Record<string, RootMetaRecords>

const STORAGE_KEY = "wanxiang_meta_store_v1"
const PRO_KEYS: ProSchemeKey[] = ["moqi", "flypy", "zrm", "tiger", "wubi", "hanxin", "shouyou"]

function normalizeRoot(root: string): string {
  return String(root ?? "").trim().replace(/\/+$/, "")
}

function storage(): any {
  return (globalThis as any).Storage ?? Runtime.Storage
}

function loadStore(): MetaStoreData {
  const st = storage()
  try {
    const raw = st?.get?.(STORAGE_KEY) ?? st?.getString?.(STORAGE_KEY)
    if (!raw) return {}
    const obj = JSON.parse(String(raw))
    return obj && typeof obj === "object" ? (obj as MetaStoreData) : {}
  } catch {
    return {}
  }
}

function saveStore(data: MetaStoreData) {
  const st = storage()
  const raw = JSON.stringify(data ?? {})
  if (st?.set) st.set(STORAGE_KEY, raw)
  else if (st?.setString) st.setString(STORAGE_KEY, raw)
}

function readRecord(installRoot: string, kind: RecordKind): RecordData | undefined {
  const root = normalizeRoot(installRoot)
  if (!root) return undefined
  const data = loadStore()
  return data[root]?.[kind]
}

function writeRecord(installRoot: string, kind: RecordKind, rec: RecordData) {
  const root = normalizeRoot(installRoot)
  if (!root) return
  const data = loadStore()
  const bucket = data[root] ?? {}
  bucket[kind] = rec
  data[root] = bucket
  saveStore(data)
}

export function clearMetaForRoot(installRoot: string) {
  const root = normalizeRoot(installRoot)
  if (!root) return
  const data = loadStore()
  if (!data[root]) return
  delete data[root]
  saveStore(data)
}

function pickRemoteId(rec: RecordData, fallback?: string): string | undefined {
  return rec.sha256 || rec.cnb_id || fallback
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
    updatedAt: rec.update_time || rec.apply_time || new Date().toISOString(),
  }
}

function toDictMeta(rec?: RecordData): DictMeta | undefined {
  if (!rec) return undefined
  const remoteIdOrSha = pickRemoteId(rec, rec.dict_file)
  if (!remoteIdOrSha) return undefined
  return {
    remoteIdOrSha,
    updatedAt: rec.update_time || rec.apply_time || new Date().toISOString(),
  }
}

function toModelMeta(rec?: RecordData): ModelMeta | undefined {
  if (!rec) return undefined
  const remoteIdOrSha = pickRemoteId(rec, rec.model_name)
  if (!remoteIdOrSha) return undefined
  return {
    remoteIdOrSha,
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

export async function loadMetaAsync(installRoot: string): Promise<MetaBundle> {
  const root = normalizeRoot(installRoot)
  if (!root) {
    CACHE = {}
    return CACHE
  }
  const schemeRec = readRecord(root, "scheme")
  const dictRec = readRecord(root, "dict")
  const modelRec = readRecord(root, "model")
  CACHE = {
    scheme: toSchemeMeta(schemeRec),
    dict: toDictMeta(dictRec),
    model: toModelMeta(modelRec),
  }
  return CACHE
}

export async function setSchemeMeta(rec: {
  installRoot: string
  fileName: string
  schemeEdition: SchemeEdition
  proSchemeKey?: ProSchemeKey
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
  }
  writeRecord(rec.installRoot, "scheme", data)
  await loadMetaAsync(rec.installRoot)
}

export async function setDictMeta(rec: {
  installRoot: string
  fileName: string
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
  }
  writeRecord(rec.installRoot, "dict", data)
  await loadMetaAsync(rec.installRoot)
}

export async function setModelMeta(rec: {
  installRoot: string
  fileName: string
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
  }
  writeRecord(rec.installRoot, "model", data)
  await loadMetaAsync(rec.installRoot)
}
