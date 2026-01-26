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

async function resolveBookmarkPath(rawPath: string): Promise<string> {
  const fm = Runtime.FileManager
  if (!rawPath) return ""
  if (!fm?.getAllFileBookmarks || !fm?.bookmarkedPath) return rawPath
  try {
    const list = await callMaybeAsync(fm.getAllFileBookmarks, fm, [])
    const arr = Array.isArray(list) ? list : []
    const norm = (s: string) => s.replace(/\/+$/, "")
    const target = norm(String(rawPath))
    const match = arr.find((b: any) => {
      const p = norm(String(b?.path ?? ""))
      const n = String(b?.name ?? "")
      return (p && p === target) || (n && n === rawPath)
    })
    if (match?.name) {
      const resolved = await callMaybeAsync(fm.bookmarkedPath, fm, [match.name])
      if (resolved) return String(resolved)
    }
  } catch {}
  return rawPath
}

// 这里按你之前的逻辑：从 hamsterRootPath 推断实际 rime 目录
export async function detectRimeDir(cfg: AppConfig): Promise<{ engine: "仓输入法" | "元书输入法"; rimeDir: string }> {
  const fm = Runtime.FileManager
  const rawRoot = cfg.hamsterRootPath?.trim()
  const root = rawRoot ? await resolveBookmarkPath(rawRoot) : ""
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
