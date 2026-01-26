// File: utils/meta.tsx
import { Path } from "scripting"
import type { ReleaseSource } from "./config"
import { ensureDir } from "./fs"

export type SchemeMeta = {
  /** 用于对比的远端标识：GitHub 用 sha256/tag/name；CNB 用 id */
  remoteIdOrSha: string
  /** HomeView 展示用 */
  remoteTagOrName: string
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
  dict_file?: string
  model_name?: string
  update_time?: string
  tag?: string
  apply_time?: string
  sha256?: string
  cnb_id?: string
}

type RecordKind = "scheme" | "dict" | "model"

function FM(): any {
  return (globalThis as any).FileManager
}

async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
  try {
    const r = fn.apply(thisArg, args)
    if (r && typeof r.then === "function") return await r
    return r
  } catch {
    return undefined
  }
}

function decodeToString(v: any): string | undefined {
  if (typeof v === "string") return v
  try {
    if (v && typeof v.toRawString === "function") {
      try {
        return v.toRawString("utf-8")
      } catch {
        return v.toRawString()
      }
    }
  } catch {}
  try {
    if (v && typeof v.toString === "function") return v.toString()
  } catch {}
  try {
    const TD: any = (globalThis as any).TextDecoder
    if (!TD) return undefined
    if (v instanceof Uint8Array) return new TD("utf-8").decode(v)
    if (v instanceof ArrayBuffer) return new TD("utf-8").decode(new Uint8Array(v))
    if (v?.buffer instanceof ArrayBuffer) return new TD("utf-8").decode(new Uint8Array(v.buffer))
  } catch {}
  return undefined
}

async function readText(path: string): Promise<string | undefined> {
  const Data = (globalThis as any).Data
  const FileEntity = (globalThis as any).FileEntity

  if (Data?.fromFile) {
    try {
      const data = Data.fromFile(path)
      const s =
        data?.toRawString?.("utf-8") ??
        data?.toDecodedString?.("utf8")
      if (s) return s
    } catch {}
  }

  if (FileEntity?.openForReading) {
    let file: any
    try {
      file = FileEntity.openForReading(path)
      const chunks: any[] = []
      const chunkSize = 64 * 1024
      for (;;) {
        const part = file.read(chunkSize)
        if (!part || !part.size) break
        chunks.push(part)
        if (part.size < chunkSize) break
      }
      if (chunks.length === 1) {
        const s =
          chunks[0]?.toRawString?.("utf-8") ??
          chunks[0]?.toDecodedString?.("utf8")
        if (s) return s
      }
      if (Data?.combine && chunks.length) {
        const all = Data.combine(chunks)
        const s =
          all?.toRawString?.("utf-8") ??
          all?.toDecodedString?.("utf8")
        if (s) return s
      }
    } catch {
      // ignore
    } finally {
      try { file?.close() } catch {}
    }
  }

  const fm = FM()
  if (!fm) return undefined
  const fn = fm.readString ?? fm.readText ?? fm.readFile ?? fm.read
  if (typeof fn !== "function") return undefined
  const v = await callMaybeAsync(fn, fm, [path])
  return decodeToString(v)
}

async function writeText(path: string, text: string): Promise<void> {
  const Data = (globalThis as any).Data
  const FileEntity = (globalThis as any).FileEntity
  if (Data?.fromRawString && FileEntity?.openNewForWriting) {
    const data = Data.fromRawString(String(text), "utf-8")
    const file = FileEntity.openNewForWriting(path)
    if (!file?.write || !file?.close) throw new Error("FileEntity 不可用")
    file.write(data)
    file.close()
    return
  }

  const fm = FM()
  if (!fm) throw new Error("FileManager 不可用")
  const fn = fm.writeString ?? fm.writeText ?? fm.writeFile ?? fm.write
  if (typeof fn !== "function") throw new Error("FileManager 缺少写入方法")
  await callMaybeAsync(fn, fm, [path, text])
}

function updateCacheDir(installRoot: string): string {
  return Path.join(installRoot, "UpdateCache")
}

function recordPath(installRoot: string, kind: RecordKind): string {
  return Path.join(updateCacheDir(installRoot), `${kind}_record.json`)
}

async function readRecord(installRoot: string, kind: RecordKind): Promise<RecordData | undefined> {
  if (!installRoot) return undefined
  const txt = await readText(recordPath(installRoot, kind))
  if (!txt) return undefined
  try {
    const obj = JSON.parse(String(txt))
    return obj && typeof obj === "object" ? (obj as RecordData) : undefined
  } catch {
    return undefined
  }
}

async function writeRecord(installRoot: string, kind: RecordKind, data: RecordData) {
  if (!installRoot) return
  const dir = updateCacheDir(installRoot)
  await ensureDir(dir)
  await writeText(recordPath(installRoot, kind), JSON.stringify(data ?? {}))
}

function pickRemoteId(rec: RecordData, fallback?: string): string | undefined {
  return rec.sha256 || rec.cnb_id || fallback
}

function toSchemeMeta(rec?: RecordData): SchemeMeta | undefined {
  if (!rec) return undefined
  const remoteTagOrName = rec.tag || rec.scheme_file
  const remoteIdOrSha = pickRemoteId(rec, remoteTagOrName)
  if (!remoteTagOrName || !remoteIdOrSha) return undefined
  return {
    remoteIdOrSha,
    remoteTagOrName,
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

// 内存缓存：给 loadMeta() 同步返回用
let CACHE: MetaBundle = {}

/**
 * 同步接口：返回内存缓存（启动时建议先调用 loadMetaAsync 刷新一次）
 */
export function loadMeta(): MetaBundle {
  return CACHE
}

/**
 * 异步接口：从 UpdateCache 读取并刷新缓存
 */
export async function loadMetaAsync(installRoot: string): Promise<MetaBundle> {
  if (!installRoot) {
    CACHE = {}
    return CACHE
  }
  const schemeRec = await readRecord(installRoot, "scheme")
  const dictRec = await readRecord(installRoot, "dict")
  const modelRec = await readRecord(installRoot, "model")

  const bundle: MetaBundle = {
    scheme: toSchemeMeta(schemeRec),
    dict: toDictMeta(dictRec),
    model: toModelMeta(modelRec),
  }
  CACHE = bundle
  return bundle
}

export async function setSchemeMeta(rec: {
  installRoot: string
  fileName: string
  tag?: string
  updatedAt?: string
  remoteIdOrSha?: string
  source?: ReleaseSource
}) {
  const ids = splitRemoteId(rec.source, rec.remoteIdOrSha)
  const data: RecordData = {
    scheme_file: rec.fileName,
    update_time: rec.updatedAt ?? new Date().toISOString(),
    tag: rec.tag ?? "",
    apply_time: new Date().toISOString(),
    sha256: ids.sha256,
    cnb_id: ids.cnb_id,
  }
  await writeRecord(rec.installRoot, "scheme", data)
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
  await writeRecord(rec.installRoot, "dict", data)
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
  await writeRecord(rec.installRoot, "model", data)
  await loadMetaAsync(rec.installRoot)
}
