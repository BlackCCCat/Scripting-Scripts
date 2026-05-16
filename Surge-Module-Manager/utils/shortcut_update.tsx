import type { ShortcutParameter } from "scripting"

import { loadConfig } from "./config"
import {
  detectLinkPrefix,
  ensureStorage,
  getModulesDirResolved,
  loadModules,
  sortModules,
  type ModuleInfo,
} from "./storage"
import { downloadModule } from "./downloader"

type ShortcutOptions = {
  category?: string
  dir?: string
  name?: string
  names?: string[]
}

export type ShortcutUpdateInput = {
  shortcutParameter?: ShortcutParameter
  textsParameter?: string[]
}

export type ShortcutUpdateResult = {
  text: string
  logs: string[]
}

type Logger = (message: string) => void

function clampConcurrency(value: number, total: number): number {
  if (total <= 0) return 1
  const fixed = Math.max(1, Math.min(10, Math.round(value || 3)))
  return Math.min(fixed, total)
}

function inferSaveDir(m: ModuleInfo): string | undefined {
  const path = String(m.filePath ?? "")
  const idx = path.lastIndexOf("/")
  return idx > 0 ? path.slice(0, idx) : undefined
}

function getTopDir(m: ModuleInfo, baseDir: string): string {
  const path = String(m.filePath ?? "")
  if (!path) return ""
  const rel = baseDir ? path.replace(baseDir, "").replace(/^\/+/, "") : path
  return rel.includes("/") ? rel.split("/")[0] : ""
}

function parseObjectOptions(obj: Record<string, any>): ShortcutOptions {
  return {
    category: String(obj.category ?? "").trim() || undefined,
    dir: String(obj.dir ?? obj.folder ?? "").trim() || undefined,
    name: String(obj.name ?? "").trim() || undefined,
    names: Array.isArray(obj.names)
      ? obj.names.map((v) => String(v ?? "").trim()).filter(Boolean)
      : undefined,
  }
}

function parseTextOptions(rawText: string): ShortcutOptions {
  const raw = String(rawText ?? "").trim()
  if (!raw || raw.toLowerCase() === "all" || raw === "全部") return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parseObjectOptions(parsed as Record<string, any>)
    }
  } catch {}
  return { category: raw }
}

function parseShortcutOptions(input: ShortcutUpdateInput, log: Logger): ShortcutOptions {
  const param = input.shortcutParameter
  log(`shortcutParameter: ${param ? param.type : "none"}`)
  if (input.textsParameter?.length) {
    log(`textsParameter: ${input.textsParameter.length}`)
  }

  if (param?.type === "json" && param.value && !Array.isArray(param.value)) {
    return parseObjectOptions(param.value as Record<string, any>)
  }

  if (param?.type === "text") {
    return parseTextOptions(param.value)
  }

  const firstText = input.textsParameter?.[0]
  if (firstText != null) {
    return parseTextOptions(firstText)
  }

  return {}
}

function applyShortcutFilters(list: ModuleInfo[], options: ShortcutOptions, baseDir: string): ModuleInfo[] {
  const names = new Set<string>([...(options.names ?? []), options.name ?? ""].filter(Boolean))
  return list.filter((m) => {
    if (options.category && m.category !== options.category) return false
    if (options.dir && getTopDir(m, baseDir) !== options.dir) return false
    if (names.size > 0 && !names.has(m.name) && !names.has(m.surgeName ?? "")) return false
    return true
  })
}

function formatOptions(options: ShortcutOptions): string {
  return JSON.stringify({
    category: options.category ?? "",
    dir: options.dir ?? "",
    name: options.name ?? "",
    names: options.names ?? [],
  })
}

export async function runShortcutUpdate(input: ShortcutUpdateInput = {}): Promise<ShortcutUpdateResult> {
  const logs: string[] = []
  const log = (message: string) => {
    const line = `[Surge模块管理][Intent] ${message}`
    logs.push(line)
    console.log(line)
  }

  try {
    log("start")
    const cfg = loadConfig()
    log(`config loaded: concurrency=${cfg.downloadConcurrency}, bookmark=${cfg.baseBookmarkName || "none"}`)

    const options = parseShortcutOptions(input, log)
    log(`filters: ${formatOptions(options)}`)

    await ensureStorage()
    log("storage ensured")

    const baseDir = await getModulesDirResolved()
    log(`baseDir: ${baseDir || "empty"}`)

    const allModules = sortModules(await loadModules())
    log(`modules scanned: ${allModules.length}`)

    const filteredModules = applyShortcutFilters(allModules, options, baseDir)
    const targetModules = filteredModules.filter((m) => !!m.link)
    log(`modules matched: ${filteredModules.length}, downloadable: ${targetModules.length}`)

    if (!targetModules.length) {
      return {
        text: `没有找到可更新的远程模块\n\n${logs.join("\n")}`,
        logs,
      }
    }

    let okCount = 0
    let nextIndex = 0
    const errors: string[] = []
    const total = targetModules.length
    const concurrency = clampConcurrency(cfg.downloadConcurrency, total)
    log(`download start: total=${total}, concurrency=${concurrency}`)

    async function worker(workerIndex: number) {
      for (;;) {
        const index = nextIndex
        nextIndex += 1
        if (index >= total) return

        const moduleInfo = targetModules[index]
        log(`worker ${workerIndex}: updating ${moduleInfo.name}`)
        try {
          const linkPrefix = await detectLinkPrefix(moduleInfo)
          log(`worker ${workerIndex}: ${moduleInfo.name} prefix=${linkPrefix ?? "none"}`)
          const res = await downloadModule(
            {
              ...moduleInfo,
              saveDir: inferSaveDir(moduleInfo),
              linkPrefix,
            },
            { mode: "direct" }
          )
          if (res.ok) {
            okCount += 1
            log(`worker ${workerIndex}: ${moduleInfo.name} ok`)
          } else {
            const msg = `${moduleInfo.name}: ${res.message ?? "下载失败"}`
            errors.push(msg)
            log(`worker ${workerIndex}: ${msg}`)
          }
        } catch (e: any) {
          const msg = `${moduleInfo.name}: ${String(e?.stack ?? e?.message ?? e)}`
          errors.push(msg)
          log(`worker ${workerIndex}: ${msg}`)
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1)))
    log(`download finished: ok=${okCount}, total=${total}, errors=${errors.length}`)

    const lines = [
      `Surge 模块更新完成：成功 ${okCount}/${total}`,
      `并发数：${concurrency}`,
    ]
    if (errors.length) {
      lines.push("失败模块：")
      lines.push(...errors.slice(0, 20))
      if (errors.length > 20) lines.push(`其余 ${errors.length - 20} 个失败已省略`)
    }
    lines.push("", "调试日志：", ...logs)

    return { text: lines.join("\n"), logs }
  } catch (e: any) {
    const message = String(e?.stack ?? e?.message ?? e)
    log(`fatal: ${message}`)
    return {
      text: `Surge 模块更新失败：${message}\n\n调试日志：\n${logs.join("\n")}`,
      logs,
    }
  }
}
