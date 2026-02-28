// File: utils/hamster.ts
import { Path } from "scripting"
import { Runtime } from "./runtime"
import type { AppConfig } from "./config"

// Base RIME suffixes (without RimeUserData children, those are detected dynamically)
export const RIME_SUFFIXES_BASE = ["/RIME/Rime", "/Rime"]

/**
 * Scan RimeUserData directory for all subdirectories.
 * Returns full paths like ["/root/RimeUserData/wanxiang", "/root/RimeUserData/other"]
 */
async function scanRimeUserDataSubdirs(root: string): Promise<string[]> {
  const fm = Runtime.FileManager
  if (!fm) return []
  const rimeUserData = `${root}/RimeUserData`
  try {
    const exists = fm.exists ? await fm.exists(rimeUserData) : false
    if (!exists) return []
    let children: string[] = []
    if (typeof fm.readDirectory === "function") {
      const raw = await fm.readDirectory(rimeUserData)
      if (Array.isArray(raw)) {
        const base = rimeUserData.endsWith("/") ? rimeUserData : rimeUserData + "/"
        children = raw.map(String).map((p) => (p.startsWith(base) ? p.slice(base.length) : p)).filter((p) => p && p !== "." && p !== "..")
      }
    } else if (typeof fm.readDirectorySync === "function") {
      const raw = fm.readDirectorySync(rimeUserData)
      if (Array.isArray(raw)) {
        const base = rimeUserData.endsWith("/") ? rimeUserData : rimeUserData + "/"
        children = raw.map(String).map((p) => (p.startsWith(base) ? p.slice(base.length) : p)).filter((p) => p && p !== "." && p !== "..")
      }
    } else if (typeof fm.listContents === "function") {
      children = await fm.listContents(rimeUserData)
    }
    const results: string[] = []
    for (const name of children) {
      if (name === ".DS_Store" || name === "__MACOSX") continue
      const full = `${rimeUserData}/${name}`
      let isDir = false
      if (typeof fm.isDirectory === "function") isDir = !!(await fm.isDirectory(full))
      else if (typeof fm.isDir === "function") isDir = !!(await fm.isDir(full))
      if (isDir) results.push(full)
    }
    return results
  } catch {
    return []
  }
}

/**
 * Collect all candidate rime paths from a root directory.
 * Used by HomeView/SettingsView for meta lookup.
 */
export async function collectRimeCandidates(root: string): Promise<string[]> {
  const normPath = (s: string) => String(s ?? "").trim().replace(/\/+$/, "")
  const out: string[] = []
  const push = (p?: string) => {
    const x = normPath(String(p ?? ""))
    if (x) out.push(x)
  }
  push(root)
  for (const suffix of RIME_SUFFIXES_BASE) {
    push(root + suffix)
  }
  // Dynamic: scan RimeUserData subdirs
  const subdirs = await scanRimeUserDataSubdirs(root)
  for (const sd of subdirs) {
    push(sd)
  }
  // Fallback: also include /RimeUserData itself
  push(`${root}/RimeUserData`)
  return Array.from(new Set(out))
}

/**
 * Get all RIME_SUFFIXES including dynamically detected RimeUserData children.
 * Used by meta.tsx for path variant resolution.
 */
export async function getRimeSuffixes(root: string): Promise<string[]> {
  const suffixes = [...RIME_SUFFIXES_BASE]
  const subdirs = await scanRimeUserDataSubdirs(root)
  for (const sd of subdirs) {
    const relative = sd.startsWith(root) ? sd.slice(root.length) : ""
    if (relative) suffixes.push(relative)
  }
  return suffixes
}

function isPromiseLike(v: any): v is Promise<any> {
  return !!v && typeof v === "object" && typeof v.then === "function"
}

async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
  try {
    const r = fn.apply(thisArg, args)
    return isPromiseLike(r) ? await r : r
  } catch {
    return undefined
  }
}

async function resolveBookmarkPath(rawPath: string, bookmarkName?: string): Promise<string> {
  const fm = Runtime.FileManager
  const raw = String(rawPath ?? "").trim()
  const name = String(bookmarkName ?? "").trim()
  if (!raw && !name) return ""
  if (!fm?.bookmarkedPath) return raw
  try {
    if (name) {
      let nameExists = true
      if (fm?.bookmarkExists) {
        const existed = await callMaybeAsync(fm.bookmarkExists, fm, [name])
        nameExists = !!existed
      }
      if (nameExists) {
        const resolvedByName = await callMaybeAsync(fm.bookmarkedPath, fm, [name])
        if (resolvedByName) return String(resolvedByName)
      }
    }
  } catch { }
  if (!fm?.getAllFileBookmarks) return raw
  try {
    const list = await callMaybeAsync(fm.getAllFileBookmarks, fm, [])
    const arr = Array.isArray(list) ? list : []
    const norm = (s: string) => s.replace(/\/+$/, "")
    const target = norm(raw)
    const match = arr.find((b: any) => {
      const p = norm(String(b?.path ?? ""))
      const n = String(b?.name ?? "")
      return (name && n === name) || (target && p && p === target)
    })
    if (match?.name) {
      const resolved = await callMaybeAsync(fm.bookmarkedPath, fm, [match.name])
      if (resolved) return String(resolved)
      if (match?.path) return String(match.path)
    }
  } catch { }
  // 配置了书签名但无法解引用时，不再回退旧路径（避免用到失效授权路径）
  if (name) return ""
  return raw
}

// 从 hamsterRootPath 推断实际 rime 目录
export async function detectRimeDir(cfg: AppConfig): Promise<{ engine: "仓输入法" | "元书输入法"; rimeDir: string }> {
  const fm = Runtime.FileManager
  const rawRoot = cfg.hamsterRootPath?.trim()
  const bookmarkName = cfg.hamsterBookmarkName?.trim()
  const root = await resolveBookmarkPath(rawRoot, bookmarkName)
  if (!root) return { engine: "仓输入法", rimeDir: "" }
  if (!fm?.exists) return { engine: "仓输入法", rimeDir: root }

  // 元书输入法：动态扫描 RimeUserData 下的所有子目录
  const subdirs = await scanRimeUserDataSubdirs(root)
  if (subdirs.length > 0) {
    // 优先使用 wanxiang 子目录（如果存在）
    const wanxiang = subdirs.find((d) => d.endsWith("/wanxiang"))
    return { engine: "元书输入法", rimeDir: wanxiang ?? subdirs[0] }
  }
  // 检查 RimeUserData 目录本身是否存在（没有子目录的情况）
  const rimeUserData = `${root}/RimeUserData`
  if (await fm.exists(rimeUserData)) {
    return { engine: "元书输入法", rimeDir: rimeUserData }
  }

  // 仓输入法
  const cang1 = `${root}/RIME/Rime`
  if (await fm.exists(cang1)) return { engine: "仓输入法", rimeDir: cang1 }

  const cang2 = `${root}/Rime`
  if (await fm.exists(cang2)) return { engine: "仓输入法", rimeDir: cang2 }

  return { engine: "仓输入法", rimeDir: root }
}

async function pathExists(path: string): Promise<boolean | undefined> {
  const fm = Runtime.FileManager
  if (!fm) return undefined
  if (typeof fm.exists === "function") return !!(await callMaybeAsync(fm.exists, fm, [path]))
  if (typeof fm.fileExists === "function") return !!(await callMaybeAsync(fm.fileExists, fm, [path]))
  if (typeof fm.existsSync === "function") return !!fm.existsSync(path)
  return undefined
}

async function mkdir(path: string): Promise<boolean> {
  const fm = Runtime.FileManager
  if (!fm) return false
  if (typeof fm.createDirectorySync === "function") {
    try {
      fm.createDirectorySync(path, true)
      const ok = await pathExists(path)
      if (ok !== false) return true
    } catch { }
  }
  if (typeof fm.createDirectory === "function") {
    await callMaybeAsync(fm.createDirectory, fm, [path, true])
    const ok = await pathExists(path)
    if (ok !== false) return true
  }
  if (typeof fm.mkdirSync === "function") {
    try {
      fm.mkdirSync(path, true)
      const ok = await pathExists(path)
      if (ok !== false) return true
    } catch { }
  }
  if (typeof fm.mkdir === "function") {
    await callMaybeAsync(fm.mkdir, fm, [path, true])
    const ok = await pathExists(path)
    if (ok !== false) return true
  }
  return false
}

async function removePath(path: string): Promise<boolean> {
  const fm = Runtime.FileManager
  if (!fm) return false
  if (typeof fm.removeSync === "function") {
    try {
      fm.removeSync(path)
      const ok = await pathExists(path)
      if (ok !== true) return true
    } catch { }
  }
  if (typeof fm.remove === "function") {
    await callMaybeAsync(fm.remove, fm, [path])
    const ok = await pathExists(path)
    if (ok !== true) return true
  }
  if (typeof fm.delete === "function") {
    await callMaybeAsync(fm.delete, fm, [path])
    const ok = await pathExists(path)
    if (ok !== true) return true
  }
  return false
}

export async function resolveInstallRoot(cfg: AppConfig): Promise<string> {
  const { rimeDir } = await detectRimeDir(cfg)
  return rimeDir || ""
}

export async function verifyInstallPathAccess(cfg: AppConfig): Promise<{ ok: boolean; installRoot: string; reason?: string }> {
  const installRoot = await resolveInstallRoot(cfg)
  if (!installRoot) {
    return { ok: false, installRoot: "", reason: "未选择路径或书签不可用" }
  }
  const exists = await pathExists(installRoot)
  if (exists === false) {
    return { ok: false, installRoot, reason: "所选路径不存在或无读取权限" }
  }

  const marker = `${installRoot}/.wanxiang_perm_check_${Date.now()}`
  const created = await mkdir(marker)
  if (!created) {
    return { ok: false, installRoot, reason: "无法写入所选路径（书签权限不足）" }
  }
  const removed = await removePath(marker)
  if (!removed) {
    return { ok: false, installRoot, reason: "无法删除测试目录（书签权限不足）" }
  }
  return { ok: true, installRoot }
}

export async function assertInstallPathAccess(cfg: AppConfig): Promise<string> {
  const result = await verifyInstallPathAccess(cfg)
  if (!result.ok) {
    throw new Error("书签路径不可用，请在设置中添加或重新添加书签文件夹。")
  }
  return result.installRoot
}
