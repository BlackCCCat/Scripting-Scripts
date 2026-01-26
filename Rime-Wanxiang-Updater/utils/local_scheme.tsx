// File: utils/local_scheme.ts
import { Path } from "scripting"

/**
 * Scripting 的类型声明可能不导出 FileManager/Data，但运行时通常挂在 globalThis。
 * 用 any + 多方法探测，最大化兼容不同版本的 FileManager “读取文件”接口。
 */
function FM(): any {
  return (globalThis as any).FileManager
}

function isPromiseLike(v: any): v is Promise<any> {
  return !!v && typeof v === "object" && typeof v.then === "function"
}

async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
  const r = fn.apply(thisArg, args)
  return isPromiseLike(r) ? await r : r
}

function decodeToString(v: any): string | undefined {
  if (typeof v === "string") return v

  // 兼容 Data：常见为 toRawString / toString
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

  // 兼容 bytes/buffer
  try {
    const TD: any = (globalThis as any).TextDecoder
    if (!TD) return undefined
    if (v instanceof Uint8Array) return new TD("utf-8").decode(v)
    if (v instanceof ArrayBuffer) return new TD("utf-8").decode(new Uint8Array(v))
    if (v?.buffer instanceof ArrayBuffer) return new TD("utf-8").decode(new Uint8Array(v.buffer))
    if (v?.bytes instanceof Uint8Array) return new TD("utf-8").decode(v.bytes)
  } catch {}

  return undefined
}

async function existsLoose(path: string): Promise<boolean> {
  const fm = FM()
  if (!fm) return false

  const candidates = ["exists", "fileExists", "existsSync"]
  for (const name of candidates) {
    const fn = fm[name]
    if (typeof fn !== "function") continue
    try {
      const r = await callMaybeAsync(fn, fm, [path])
      if (typeof r === "boolean") return r
    } catch {}
  }

  // 没有 exists 时：尝试读取，能读到就算存在
  const t = await readTextLoose(path)
  return !!t
}

async function isDirectoryLoose(path: string): Promise<boolean> {
  const fm = FM()
  if (!fm) return false
  const candidates = ["isDirectory", "isDir", "isDirectoryPath"]
  for (const name of candidates) {
    const fn = fm[name]
    if (typeof fn !== "function") continue
    try {
      const r = await callMaybeAsync(fn, fm, [path])
      if (typeof r === "boolean") return r
    } catch {}
  }
  return false
}

async function listContentsLoose(dir: string): Promise<string[]> {
  const fm = FM()
  if (!fm) return []
  const candidates = ["listContents", "contentsOfDirectory", "list", "children"]
  for (const name of candidates) {
    const fn = fm[name]
    if (typeof fn !== "function") continue
    try {
      const r = await callMaybeAsync(fn, fm, [dir])
      if (Array.isArray(r)) return r.map(String)
    } catch {}
  }
  return []
}

/**
 * 读取文本文件：根据文档常见 API 组合 readString/readText/readFile/read
 * 并兼容返回 string / Data / bytes
 */
async function readTextLoose(path: string): Promise<string | undefined> {
  const fm = FM()
  if (!fm) return undefined

  const candidates = ["readString", "readText", "readFile", "read"]
  for (const name of candidates) {
    const fn = fm[name]
    if (typeof fn !== "function") continue
    try {
      const r = await callMaybeAsync(fn, fm, [path])
      const s = decodeToString(r)
      if (s && s.length > 0) return s
    } catch {}
  }
  return undefined
}

function parseWanxiangVersion(luaText: string): string | undefined {
  // wanxiang.version = "v14.4.3" 或 'v14.4.3'
  const m =
    luaText.match(/wanxiang\.version\s*=\s*["']([^"']+)["']/) ??
    luaText.match(/wanxiang\s*\.\s*version\s*=\s*["']([^"']+)["']/)
  return m?.[1]?.trim() || undefined
}

/**
 * ✅ 你的需求：运行脚本时直接读取已选择路径下 lua/wanxiang.lua 的 wanxiang.version
 * 但用户选择的“路径”不一定就是 rime 根目录，所以：
 * 1) 先尝试 baseDir/lua/wanxiang.lua
 * 2) 再尝试几组常见子路径
 * 3) 仍找不到：在 baseDir 内有限深度(4)递归查找 `lua/wanxiang.lua`
 */
export async function readLocalWanxiangVersionFromDir(baseDir: string): Promise<string | undefined> {
  if (!baseDir) return undefined

  const directCandidates = [
    Path.join(baseDir, "lua", "wanxiang.lua"),
    Path.join(baseDir, "rime", "lua", "wanxiang.lua"),
    Path.join(baseDir, "Rime", "lua", "wanxiang.lua"),
    Path.join(baseDir, "hamster", "lua", "wanxiang.lua"),
    Path.join(baseDir, "Hamster", "lua", "wanxiang.lua"),
  ]

  for (const p of directCandidates) {
    if (await existsLoose(p)) {
      const text = await readTextLoose(p)
      if (!text) continue
      const v = parseWanxiangVersion(text)
      if (v) return v
    }
  }

  // 递归查找：优先找到目录名 lua，然后拼 wanxiang.lua
  const maxDepth = 4
  async function dfs(dir: string, depth: number): Promise<string | undefined> {
    if (depth > maxDepth) return undefined
    const items = await listContentsLoose(dir)
    for (const name of items) {
      if (!name || name === "." || name === "..") continue
      if (name.startsWith(".")) continue
      const full = Path.join(dir, name)
      const isDir = await isDirectoryLoose(full)
      if (isDir) {
        if (name.toLowerCase() === "lua") {
          const target = Path.join(full, "wanxiang.lua")
          if (await existsLoose(target)) return target
        }
        const found = await dfs(full, depth + 1)
        if (found) return found
      }
    }
    return undefined
  }

  const foundPath = await dfs(baseDir, 0)
  if (!foundPath) return undefined

  const text = await readTextLoose(foundPath)
  if (!text) return undefined
  return parseWanxiangVersion(text)
}
