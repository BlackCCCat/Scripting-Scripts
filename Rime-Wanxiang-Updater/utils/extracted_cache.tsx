// File: utils/extracted_cache.tsx
import { callMaybeAsync, FM, storage, normalizePath, basename, dirname, compilePatterns, matchAny } from "./common"

export type TrackKind = "scheme" | "dict"

type TrackedRecord = {
  files: string[]
  updatedAt: string
}

type RootTracked = {
  scheme?: TrackedRecord
  dict?: TrackedRecord
}

type StoreData = Record<string, RootTracked>

const STORAGE_KEY = "wanxiang_extracted_files"
const LEGACY_STORAGE_KEYS = ["wanxiang_extracted_files_v1"]

function shouldSkip(path: string, root: string, patterns: RegExp[]): boolean {
  if (!patterns.length) return false
  const full = String(path ?? "")
  const rootNorm = normalizePath(root)
  const name = basename(full)
  const rel = rootNorm && full.startsWith(rootNorm + "/") ? full.slice(rootNorm.length + 1) : full
  return matchAny(name, patterns) || matchAny(rel, patterns) || matchAny(full, patterns)
}

function loadStore(): StoreData {
  const st = storage()
  try {
    let raw = st?.get?.(STORAGE_KEY) ?? st?.getString?.(STORAGE_KEY)
    if (!raw) {
      for (const key of LEGACY_STORAGE_KEYS) {
        raw = st?.get?.(key) ?? st?.getString?.(key)
        if (raw) break
      }
    }
    if (!raw) return {}
    const obj = JSON.parse(String(raw))
    const data = obj && typeof obj === "object" ? (obj as StoreData) : {}
    const current = st?.get?.(STORAGE_KEY) ?? st?.getString?.(STORAGE_KEY)
    if (!current) saveStore(data)
    return data
  } catch {
    return {}
  }
}

function saveStore(store: StoreData) {
  const st = storage()
  const raw = JSON.stringify(store)
  if (st?.set) st.set(STORAGE_KEY, raw)
  else if (st?.setString) st.setString(STORAGE_KEY, raw)
}

function dedupeFiles(files: string[]): string[] {
  return Array.from(new Set((files ?? []).map((x) => normalizePath(x)).filter(Boolean)))
}

export function setExtractedFiles(installRoot: string, kind: TrackKind, files: string[]) {
  const root = normalizePath(installRoot)
  if (!root) return
  const data = loadStore()
  const bucket = data[root] ?? {}
  bucket[kind] = {
    files: dedupeFiles(files),
    updatedAt: new Date().toISOString(),
  }
  data[root] = bucket
  saveStore(data)
}

export function clearExtractedFilesForRoot(installRoot: string) {
  const root = normalizePath(installRoot)
  if (!root) return
  const data = loadStore()
  if (!data[root]) return
  delete data[root]
  saveStore(data)
}

async function existsPath(fm: any, p: string): Promise<boolean> {
  const fn = fm?.exists ?? fm?.fileExists ?? fm?.existsSync
  if (typeof fn !== "function") return false
  const r = await callMaybeAsync(fn, fm, [p])
  return !!r
}

async function removePath(fm: any, p: string): Promise<boolean> {
  try {
    if (typeof fm?.removeSync === "function") {
      fm.removeSync(p)
      return true
    }
    if (typeof fm?.remove === "function") {
      await fm.remove(p)
      return true
    }
    if (typeof fm?.delete === "function") {
      await fm.delete(p)
      return true
    }
  } catch { }
  return false
}

async function listDirectoryEntries(fm: any, dir: string): Promise<string[] | undefined> {
  try {
    if (typeof fm?.readDirectory === "function") {
      const raw = await callMaybeAsync(fm.readDirectory, fm, [dir])
      if (!Array.isArray(raw)) return []
      const base = dir.endsWith("/") ? dir : dir + "/"
      return raw
        .map(String)
        .map((p) => (p.startsWith(base) ? p.slice(base.length) : p))
        .filter((p) => p && p !== "." && p !== "..")
    }
    if (typeof fm?.readDirectorySync === "function") {
      const raw = fm.readDirectorySync(dir)
      if (!Array.isArray(raw)) return []
      const base = dir.endsWith("/") ? dir : dir + "/"
      return raw
        .map(String)
        .map((p) => (p.startsWith(base) ? p.slice(base.length) : p))
        .filter((p) => p && p !== "." && p !== "..")
    }
  } catch {
    return undefined
  }
  return undefined
}

async function cleanupParents(path: string, stopRoot: string): Promise<void> {
  const fm = FM()
  if (!fm) return
  const root = normalizePath(stopRoot)
  let cur = dirname(path)
  while (cur && root && cur.startsWith(root + "/")) {
    const entries = await listDirectoryEntries(fm, cur)
    // 保守处理：无法判断目录内容时不做目录删除，避免误删排除文件
    if (!entries || entries.length > 0) break
    const ok = await removePath(fm, cur)
    if (!ok) break
    cur = dirname(cur)
  }
}

export async function removeExtractedFiles(args: {
  installRoot: string
  kind: TrackKind
  compareRoot?: string
  excludePatterns?: string[]
}): Promise<number> {
  const root = normalizePath(args.installRoot)
  if (!root) return 0
  const fm = FM()
  if (!fm) return 0

  const data = loadStore()
  const tracked = dedupeFiles(data[root]?.[args.kind]?.files ?? [])
  if (!tracked.length) return 0

  const compareRoot = normalizePath(args.compareRoot || root)
  const patterns = compilePatterns(args.excludePatterns ?? [])
  const kept: string[] = []
  let removed = 0

  for (const file of tracked) {
    if (shouldSkip(file, compareRoot, patterns)) {
      kept.push(file)
      continue
    }
    const exists = await existsPath(fm, file)
    if (!exists) continue
    const ok = await removePath(fm, file)
    if (ok) {
      removed += 1
      await cleanupParents(file, compareRoot)
    } else {
      kept.push(file)
    }
  }

  const bucket = data[root] ?? {}
  if (kept.length) {
    bucket[args.kind] = {
      files: kept,
      updatedAt: new Date().toISOString(),
    }
    data[root] = bucket
  } else {
    delete bucket[args.kind]
    if (bucket.scheme || bucket.dict) data[root] = bucket
    else delete data[root]
  }
  saveStore(data)
  return removed
}
