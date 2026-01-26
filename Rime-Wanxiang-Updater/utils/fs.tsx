// File: utils/fs.ts
import { Path } from "scripting"
import { Runtime } from "./runtime"

export type CopyOptions = {
  excludePatterns: string[]
  overwritePolicy: "overwrite" | "keepExisting"
  onFile?: (info: { src: string; dst: string; skipped: boolean }) => void
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
        opts.onFile?.({ src, dst, skipped: true })
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
        opts.onFile?.({ src, dst, skipped: true })
        continue
      }

      await ensureDir(Path.dirname(dst))
      if (dstExists) {
        try { await remove(dst) } catch {}
      }

      await copy(src, dst)
      opts.onFile?.({ src, dst, skipped: false })
    }
  }

  await walk(srcDir, dstDir)
}

export async function unzipToDirWithOverwrite(
  zipPath: string,
  destDir: string,
  opts?: { excludePatterns?: string[] }
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
    let srcRoot = tmpDir
    if (children.length === 1) {
      const only = Path.join(tmpDir, children[0])
      if (await isDirectory(only)) srcRoot = only
    }
    await copyDirWithPolicy(srcRoot, destDir, {
      excludePatterns: opts?.excludePatterns ?? [],
      overwritePolicy: "overwrite",
    })
  } finally {
    await removeDirSafe(tmpDir)
  }
}

export async function removeDirSafe(dir: string) {
  try {
    if (await exists(dir)) await remove(dir)
  } catch {}
}
