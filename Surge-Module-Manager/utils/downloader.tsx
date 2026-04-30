import { Path } from "scripting"
import { moduleFilePath, ensureStorage, type ModuleInfo, getModulesDirResolved } from "./storage"
import { loadConfig } from "./config"
import { downloadWithProgress } from "./stream_downloader"

export type DownloadModuleOptions = {
  mode?: "stream" | "direct"
}

function injectNameFlag(content: string): string {
  if (content.includes("🔗")) return content
  return content.replace(/#!\s*name\s*=/i, "#!name=🔗")
}

function injectCategory(content: string, category?: string): string {
  const cat = String(category ?? "").trim()
  if (!cat) return content
  const line = `#!category=${cat}`
  if (/^\s*#!\s*category\s*=.*$/im.test(content)) {
    return content.replace(/^\s*#!\s*category\s*=.*$/im, line)
  }
  return `${line}\n${content}`
}

function injectUrl(content: string, url?: string, preferredPrefix?: string): string {
  const u = String(url ?? "").trim()
  if (!u) return content
  const cfg = loadConfig()
  const prefixes = String(cfg.linkPatternsText ?? "")
    .split(/\r?\n/g)
    .filter((s) => s.trim().length > 0)
  const first = preferredPrefix && prefixes.includes(preferredPrefix) ? preferredPrefix : prefixes[0] ?? "#url="
  const lines = String(content ?? "").split(/\r?\n/g)
  const filtered = lines.filter((line) => {
    const t = line.trimStart()
    return !prefixes.some((p) => t.startsWith(p))
  })
  return `${first}${u}\n${filtered.join("\n")}`
}

async function fetchModuleText(url: string): Promise<string> {
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用")

  const res = await fetchFn(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Accept: "text/plain,text/*,*/*",
    },
  })
  if (!res?.ok) {
    throw new Error(`HTTP ${res?.status ?? "unknown"} ${res?.statusText ?? ""}`.trim())
  }
  if (typeof res.text !== "function") throw new Error("Response.text 不可用")
  return String(await res.text())
}

async function writeFinalModule(
  fm: any,
  info: ModuleInfo & { linkPrefix?: string },
  targetDir: string,
  rawText: string
): Promise<void> {
  if (!rawText) throw new Error(`下载内容为空: ${info.link}`)

  let content = injectNameFlag(rawText)
  content = injectUrl(content, info.link, info.linkPrefix)
  content = injectCategory(content, info.category)

  const path = moduleFilePath(info.name, targetDir)
  await fm.writeAsString(path, content)
}

async function downloadModuleDirect(
  fm: any,
  info: ModuleInfo & { linkPrefix?: string },
  targetDir: string
): Promise<void> {
  const text = await fetchModuleText(info.link)
  await writeFinalModule(fm, info, targetDir, text)
}

async function downloadModuleStream(
  fm: any,
  info: ModuleInfo & { linkPrefix?: string },
  targetDir: string
): Promise<void> {
  const tmpDir = fm.temporaryDirectory ?? Path.join(Path.dirname(moduleFilePath(info.name, targetDir)), ".tmp")
  const tmpPath = Path.join(tmpDir, `${info.name}_${Date.now()}.tmp`)

  try {
    await downloadWithProgress(info.link, tmpPath)
  } catch (e: any) {
    throw new Error(`下载失败: ${String(e?.message ?? e)}`)
  }

  let text = ""
  try {
    text = await fm.readAsString(tmpPath)
  } catch (e: any) {
    throw new Error(`读取文件失败: ${String(e?.message ?? e)}`)
  }

  try {
    await writeFinalModule(fm, info, targetDir, text)
  } finally {
    try {
      if (typeof fm.remove === "function") await fm.remove(tmpPath)
      else if (typeof fm.removeSync === "function") fm.removeSync(tmpPath)
    } catch {}
  }
}

export async function downloadModule(
  info: ModuleInfo & { linkPrefix?: string },
  options: DownloadModuleOptions = {}
): Promise<{ ok: boolean; message?: string }> {
  await ensureStorage()

  const fm: any = (globalThis as any).FileManager
  if (!fm?.writeAsString) {
    return { ok: false, message: "FileManager.writeAsString 不可用" }
  }
  if (options.mode !== "direct" && !fm?.readAsString) {
    return { ok: false, message: "FileManager.readAsString 不可用" }
  }

  const targetDir = info.saveDir ?? (await getModulesDirResolved())
  try {
    if (options.mode === "direct") {
      await downloadModuleDirect(fm, info, targetDir)
    } else {
      await downloadModuleStream(fm, info, targetDir)
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, message: String(e?.message ?? e) }
  }
}
