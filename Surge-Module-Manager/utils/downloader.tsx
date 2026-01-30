import { moduleFilePath, ensureStorage, type ModuleInfo } from "./storage"

function fetchOrThrow(): any {
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用，无法下载")
  return fetchFn
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

function injectUrl(content: string, url?: string): string {
  const u = String(url ?? "").trim()
  if (!u) return content
  const line = `#!url=${u}`
  if (/^\s*#!\s*url\s*=.*$/im.test(content)) {
    return content.replace(/^\s*#!\s*url\s*=.*$/im, line)
  }
  return `${line}\n${content}`
}

export async function downloadModule(info: ModuleInfo): Promise<{ ok: boolean; message?: string }> {
  await ensureStorage()

  const fetchFn = fetchOrThrow()
  const res = await fetchFn(info.link)
  const status = typeof res?.status === "number" ? res.status : 0
  if (status === 404) {
    return { ok: false, message: `模块不存在（404）: ${info.link}` }
  }
  if (status && status >= 400) {
    return { ok: false, message: `下载失败（${status}）: ${info.link}` }
  }

  let text = ""
  try {
    text = await res.text()
  } catch (e: any) {
    return { ok: false, message: `读取响应失败: ${String(e?.message ?? e)}` }
  }

  if (!text) {
    return { ok: false, message: `下载内容为空: ${info.link}` }
  }

  let content = injectNameFlag(text)
  content = injectUrl(content, info.link)
  content = injectCategory(content, info.category)

  const fm: any = (globalThis as any).FileManager
  if (!fm?.writeAsString) throw new Error("FileManager.writeAsString 不可用")
  const path = moduleFilePath(info.name)
  await fm.writeAsString(path, content)

  return { ok: true }
}
