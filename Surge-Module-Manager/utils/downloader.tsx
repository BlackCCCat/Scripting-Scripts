import { Path } from "scripting"
import { moduleFilePath, ensureStorage, type ModuleInfo } from "./storage"
import { loadConfig } from "./config"
import { downloadWithProgress } from "./stream_downloader"

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

function injectUrl(content: string, url?: string): string {
  const u = String(url ?? "").trim()
  if (!u) return content
  const cfg = loadConfig()
  const prefixes = String(cfg.linkPatternsText ?? "")
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean)
  const first = prefixes[0] ?? "#url="
  const lines = String(content ?? "").split(/\r?\n/g)
  const filtered = lines.filter((line) => {
    const t = line.trimStart()
    return !prefixes.some((p) => t.startsWith(p))
  })
  return `${first}${u}\n${filtered.join("\n")}`
}

export async function downloadModule(info: ModuleInfo): Promise<{ ok: boolean; message?: string }> {
  await ensureStorage()

  const fm: any = (globalThis as any).FileManager
  if (!fm?.readAsString || !fm?.writeAsString) {
    throw new Error("FileManager 读写方法不可用")
  }

  const tmpDir = fm.temporaryDirectory ?? Path.join(Path.dirname(moduleFilePath(info.name)), ".tmp")
  const tmpPath = Path.join(tmpDir, `${info.name}_${Date.now()}.tmp`)

  try {
    await downloadWithProgress(info.link, tmpPath)
  } catch (e: any) {
    return { ok: false, message: `下载失败: ${String(e?.message ?? e)}` }
  }

  let text = ""
  try {
    text = await fm.readAsString(tmpPath)
  } catch (e: any) {
    return { ok: false, message: `读取文件失败: ${String(e?.message ?? e)}` }
  }

  if (!text) {
    return { ok: false, message: `下载内容为空: ${info.link}` }
  }

  let content = injectNameFlag(text)
  content = injectUrl(content, info.link)
  content = injectCategory(content, info.category)

  const path = moduleFilePath(info.name)
  await fm.writeAsString(path, content)

  try {
    if (typeof fm.remove === "function") await fm.remove(tmpPath)
    else if (typeof fm.removeSync === "function") fm.removeSync(tmpPath)
  } catch {}

  return { ok: true }
}
