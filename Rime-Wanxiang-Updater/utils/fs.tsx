// File: utils/fs.ts
import { Path } from "scripting"
import { Runtime } from "./runtime"

export type CopyOptions = {
  excludePatterns: string[]
  overwritePolicy: "overwrite" | "keepExisting"
}

function fmOrThrow() {
  const fm = Runtime.FileManager
  if (!fm) throw new Error("运行时未提供 FileManager")
  return fm
}

async function exists(p: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.exists === "function") return !!(await fm.exists(p))
  if (typeof fm.fileExists === "function") return !!(await fm.fileExists(p))
  return false
}

async function list(dir: string): Promise<string[]> {
  const fm = fmOrThrow()
  if (typeof fm.readDirectory === "function") {
    const raw = await fm.readDirectory(dir)
    if (!Array.isArray(raw)) return []
    const base = dir.endsWith("/") ? dir : dir + "/"
    return raw
      .map(String)
      .map((p) => (p.startsWith(base) ? p.slice(base.length) : p))
      .filter((p) => p && p !== "." && p !== "..")
  }
  if (typeof fm.readDirectorySync === "function") {
    const raw = fm.readDirectorySync(dir)
    if (!Array.isArray(raw)) return []
    const base = dir.endsWith("/") ? dir : dir + "/"
    return raw
      .map(String)
      .map((p) => (p.startsWith(base) ? p.slice(base.length) : p))
      .filter((p) => p && p !== "." && p !== "..")
  }
  if (typeof fm.listContents === "function") return await fm.listContents(dir)
  if (typeof fm.list === "function") return await fm.list(dir)
  if (typeof fm.contentsOfDirectory === "function") return await fm.contentsOfDirectory(dir)
  throw new Error("FileManager 缺少 readDirectory/listContents/list")
}

async function isDirectory(p: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.isDirectory === "function") return !!(await fm.isDirectory(p))
  if (typeof fm.isDir === "function") return !!(await fm.isDir(p))
  if (typeof fm.stat === "function") {
    try {
      const st = await fm.stat(p)
      if (st && typeof st.type === "string") return st.type === "directory"
    } catch {}
  }
  if (typeof fm.statSync === "function") {
    try {
      const st = fm.statSync(p)
      if (st && typeof st.type === "string") return st.type === "directory"
    } catch {}
  }
  return false
}

async function mkdir(dir: string) {
  const fm = fmOrThrow()
  if (typeof fm.createDirectory === "function") return await fm.createDirectory(dir)
  if (typeof fm.mkdir === "function") return await fm.mkdir(dir)
}

async function remove(p: string) {
  const fm = fmOrThrow()
  if (typeof fm.remove === "function") return await fm.remove(p)
  if (typeof fm.delete === "function") return await fm.delete(p)
  if (typeof fm.removeItem === "function") return await fm.removeItem(p)
}

async function copy(src: string, dst: string) {
  const fm = fmOrThrow()
  if (typeof fm.copyFile === "function") return await fm.copyFile(src, dst)
  if (typeof fm.copyFileSync === "function") {
    fm.copyFileSync(src, dst)
    return
  }
  if (typeof fm.copy === "function") return await fm.copy(src, dst)
  if (typeof fm.copyItem === "function") return await fm.copyItem(src, dst)
  throw new Error("FileManager 缺少 copyFile")
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
function compilePatterns(patterns: string[]): RegExp[] {
  const list: RegExp[] = []
  for (const raw of patterns) {
    const p = String(raw ?? "").trim()
    if (!p) continue
    try {
      list.push(new RegExp(p))
      continue
    } catch {}
    const re = new RegExp("^" + p.split("*").map(escapeRe).join(".*") + "$", "i")
    list.push(re)
  }
  return list
}

function matchAny(pathOrName: string, patterns: RegExp[]) {
  for (const re of patterns) {
    if (re.test(pathOrName)) return true
  }
  return false
}

export async function ensureDir(dir: string) {
  if (await exists(dir)) return
  try {
    await mkdir(dir)
  } catch {}
}

export async function copyDirWithPolicy(srcDir: string, dstDir: string, opts: CopyOptions) {
  const patterns = compilePatterns(opts.excludePatterns ?? [])
  const srcRoot = srcDir

  async function walk(curSrc: string, curDst: string) {
    await ensureDir(curDst)

    const children = await list(curSrc)
    for (const name of children) {
      const src = Path.join(curSrc, name)
      const dst = Path.join(curDst, name)
      const rel = src.startsWith(srcRoot) ? src.slice(srcRoot.length + 1) : name

      const excluded =
        matchAny(name, patterns) ||
        matchAny(rel, patterns) ||
        matchAny(src, patterns)
      if (excluded) {
        continue
      }

      if (await isDirectory(src)) {
        if (await exists(dst)) {
          const dstIsDir = await isDirectory(dst)
          if (!dstIsDir) {
            try { await remove(dst) } catch {}
          }
        }
        await walk(src, dst)
        continue
      }

      const dstExists = await exists(dst)
      if (dstExists && opts.overwritePolicy === "keepExisting") {
        continue
      }

      await ensureDir(Path.dirname(dst))
      if (dstExists) {
        try { await remove(dst) } catch {}
      }

      await copy(src, dst)
    }
  }

  await walk(srcDir, dstDir)
}

export async function unzipToDirWithOverwrite(
  zipPath: string,
  destDir: string,
  opts?: { excludePatterns?: string[]; flattenSingleDir?: boolean }
) {
  const fm = fmOrThrow()
  if (typeof fm.unzip !== "function") throw new Error("FileManager.unzip 不可用")

  const baseTmp = fm.temporaryDirectory ?? Path.dirname(zipPath)
  const tmpDir = Path.join(baseTmp, `tmp_unzip_${Date.now()}`)
  try {
    await removeDirSafe(tmpDir)
    await ensureDir(tmpDir)
    await fm.unzip(zipPath, tmpDir)
    const children = await list(tmpDir)
    const isIgnorable = (name: string) =>
      name === "__MACOSX" || name === ".DS_Store"
    const visible = children.filter((name) => name && !isIgnorable(name))

    const patterns = compilePatterns(opts?.excludePatterns ?? [])
    const shouldSkip = (name: string, rel: string, src: string) =>
      matchAny(name, patterns) || matchAny(rel, patterns) || matchAny(src, patterns)

    const dirs: string[] = []
    const files: string[] = []
    for (const name of visible) {
      const full = Path.join(tmpDir, name)
      if (await isDirectory(full)) dirs.push(name)
      else files.push(name)
    }

    if (opts?.flattenSingleDir && dirs.length === 1) {
      for (const name of files) {
        const src = Path.join(tmpDir, name)
        const dst = Path.join(destDir, name)
        if (shouldSkip(name, name, src)) continue
        await ensureDir(Path.dirname(dst))
        if (await exists(dst)) {
          try { await remove(dst) } catch {}
        }
        await copy(src, dst)
      }
      const srcRoot = Path.join(tmpDir, dirs[0])
      await copyDirWithPolicy(srcRoot, destDir, {
        excludePatterns: opts?.excludePatterns ?? [],
        overwritePolicy: "overwrite",
      })
    } else {
      let srcRoot = tmpDir
      if (visible.length === 1) {
        const only = Path.join(tmpDir, visible[0])
        if (await isDirectory(only)) srcRoot = only
      }
      await copyDirWithPolicy(srcRoot, destDir, {
        excludePatterns: opts?.excludePatterns ?? [],
        overwritePolicy: "overwrite",
      })
    }
  } finally {
    await removeDirSafe(tmpDir)
  }
}

export async function removeDirSafe(dir: string) {
  try {
    if (await exists(dir)) await remove(dir)
  } catch {}
}

export async function flattenSingleSubdir(
  parentDir: string,
  opts?: { excludePatterns?: string[]; namePattern?: RegExp }
): Promise<boolean> {
  if (!(await exists(parentDir))) return false
  const children = await list(parentDir)
  const isIgnorable = (name: string) =>
    name === "__MACOSX" || name === ".DS_Store"
  const visible = children.filter((name) => name && !isIgnorable(name))

  const dirs: string[] = []
  for (const name of visible) {
    const full = Path.join(parentDir, name)
    if (await isDirectory(full)) dirs.push(name)
  }

  if (dirs.length !== 1) return false
  if (opts?.namePattern && !opts.namePattern.test(dirs[0])) return false

  const srcRoot = Path.join(parentDir, dirs[0])
  await copyDirWithPolicy(srcRoot, parentDir, {
    excludePatterns: opts?.excludePatterns ?? [],
    overwritePolicy: "overwrite",
  })

  await removeDirSafe(srcRoot)
  return true
}

async function hasExcludedMatch(dir: string, patterns: RegExp[]): Promise<boolean> {
  const items = await list(dir)
  for (const name of items) {
    if (!name || name === "." || name === "..") continue
    const full = Path.join(dir, name)
    const rel = full.startsWith(dir) ? full.slice(dir.length + 1) : name
    if (matchAny(name, patterns) || matchAny(rel, patterns) || matchAny(full, patterns)) {
      return true
    }
    if (await isDirectory(full)) {
      if (await hasExcludedMatch(full, patterns)) return true
    }
  }
  return false
}

export async function mergeSubdirsByName(
  parentDir: string,
  opts?: { excludePatterns?: string[]; namePattern?: RegExp }
): Promise<number> {
  if (!(await exists(parentDir))) return 0
  const children = await list(parentDir)
  const isIgnorable = (name: string) =>
    name === "__MACOSX" || name === ".DS_Store"
  const patterns = compilePatterns(opts?.excludePatterns ?? [])

  let merged = 0
  for (const name of children) {
    if (!name || isIgnorable(name)) continue
    const full = Path.join(parentDir, name)
    if (!(await isDirectory(full))) continue
    if (opts?.namePattern && !opts.namePattern.test(name)) continue

    await copyDirWithPolicy(full, parentDir, {
      excludePatterns: opts?.excludePatterns ?? [],
      overwritePolicy: "overwrite",
    })

    const keepDir = patterns.length ? await hasExcludedMatch(full, patterns) : false
    if (!keepDir) {
      await removeDirSafe(full)
    }
    merged += 1
  }
  return merged
}
