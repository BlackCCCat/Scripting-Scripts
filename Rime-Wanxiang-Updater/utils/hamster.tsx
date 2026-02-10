// File: utils/hamster.ts
import { Runtime } from "./runtime"
import type { AppConfig } from "./config"

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
  if (!fm?.bookmarkedPath) return raw
  try {
    if (name) {
      const resolvedByName = await callMaybeAsync(fm.bookmarkedPath, fm, [name])
      if (resolvedByName) return String(resolvedByName)
    }
  } catch {}
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
  } catch {}
  return raw
}

// 这里按你之前的逻辑：从 hamsterRootPath 推断实际 rime 目录
export async function detectRimeDir(cfg: AppConfig): Promise<{ engine: "仓输入法" | "元书输入法"; rimeDir: string }> {
  const fm = Runtime.FileManager
  const rawRoot = cfg.hamsterRootPath?.trim()
  const bookmarkName = cfg.hamsterBookmarkName?.trim()
  const root = await resolveBookmarkPath(rawRoot, bookmarkName)
  if (!root) return { engine: "仓输入法", rimeDir: "" }
  if (!fm?.exists) return { engine: "仓输入法", rimeDir: root }

  const yushu = `${root}/RimeUserData/wanxiang`
  if (await fm.exists(yushu)) return { engine: "元书输入法", rimeDir: yushu }

  const cang1 = `${root}/RIME/Rime`
  if (await fm.exists(cang1)) return { engine: "仓输入法", rimeDir: cang1 }

  const cang2 = `${root}/Rime`
  if (await fm.exists(cang2)) return { engine: "仓输入法", rimeDir: cang2 }

  return { engine: "仓输入法", rimeDir: root }
}
