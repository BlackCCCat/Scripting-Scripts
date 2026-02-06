import { Path } from "scripting"
import { loadConfig } from "./config"

export type ModuleInfo = {
  name: string
  link: string
  category?: string
  filePath?: string
  saveDir?: string
  isLocal?: boolean
  content?: string
}

const BASE_DIR_NAME = "SurgeModulesManager"
const MODULES_DIR_NAME = "Modules"

function fmOrThrow(): any {
  const fm = (globalThis as any).FileManager
  if (!fm) throw new Error("FileManager 不可用")
  return fm
}

function pickRootDir(): string {
  const fm = fmOrThrow()
  if (fm.isiCloudEnabled && fm.iCloudDocumentsDirectory) {
    return fm.iCloudDocumentsDirectory
  }
  return fm.documentsDirectory || fm.appGroupDocumentsDirectory || fm.scriptsDirectory || ""
}

export function getBaseDir(): string {
  const cfg = loadConfig()
  if (cfg.baseDir) return cfg.baseDir
  return Path.join(pickRootDir(), BASE_DIR_NAME)
}

export function getModulesDir(): string {
  const cfg = loadConfig()
  if (cfg.baseDir) return cfg.baseDir
  return Path.join(getBaseDir(), MODULES_DIR_NAME)
}

async function exists(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.exists === "function") return !!(await fm.exists(path))
  if (typeof fm.existsSync === "function") return !!fm.existsSync(path)
  return false
}

async function ensureDir(dir: string): Promise<void> {
  const fm = fmOrThrow()
  if (await exists(dir)) return
  if (typeof fm.createDirectory === "function") {
    await fm.createDirectory(dir, true)
    return
  }
  if (typeof fm.createDirectorySync === "function") {
    fm.createDirectorySync(dir, true)
    return
  }
  throw new Error("FileManager.createDirectory 不可用")
}

export async function ensureStorage(): Promise<void> {
  await ensureDir(getBaseDir())
  const cfg = loadConfig()
  if (!cfg.baseDir) {
    await ensureDir(getModulesDir())
  }
}

function extractNameFromPath(p: string): string {
  const base = String(p).split("/").pop() ?? String(p)
  return base.replace(/\.sgmodule$/i, "")
}

function parseTag(content: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*#!\\s*${key}\\s*=\\s*(.*)$`, "im")
  const m = content.match(re)
  return m?.[1]?.trim()
}

function getLinkPrefixes(): string[] {
  const cfg = loadConfig()
  const raw = String(cfg.linkPatternsText ?? "").split(/\r?\n/g)
  return raw.filter((s) => s.trim().length > 0)
}

function parseLinkFromContent(content: string, prefixes: string[]): string {
  const lines = String(content ?? "").split(/\r?\n/g)
  for (const lineRaw of lines) {
    const line = lineRaw.trimStart()
    for (const prefix of prefixes) {
      if (line.startsWith(prefix)) {
        return line.slice(prefix.length).trim()
      }
    }
  }
  return ""
}

export function detectLinkPrefixFromContent(content: string, prefixes: string[]): string | undefined {
  const lines = String(content ?? "").split(/\r?\n/g)
  for (const lineRaw of lines) {
    const line = lineRaw.trimStart()
    const hit = prefixes.find((p) => line.startsWith(p))
    if (hit) return hit
  }
  return undefined
}

async function isDirectory(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.isDirectory === "function") return !!(await fm.isDirectory(path))
  if (typeof fm.isDir === "function") return !!(await fm.isDir(path))
  return false
}

async function listModuleFilesRecursive(dir: string): Promise<string[]> {
  const fm = fmOrThrow()
  const list = await fm.readDirectory(dir)
  if (!Array.isArray(list)) return []
  const files: string[] = []
  for (const entry of list) {
    const raw = String(entry)
    const full = raw.includes("/") ? raw : Path.join(dir, raw)
    if (await isDirectory(full)) {
      const sub = await listModuleFilesRecursive(full)
      files.push(...sub)
      continue
    }
    if (!full.toLowerCase().endsWith(".sgmodule")) continue
    files.push(full)
  }
  return files
}

export async function loadModules(): Promise<ModuleInfo[]> {
  await ensureStorage()
  const fm = fmOrThrow()
  const dir = getModulesDir()

  const modules: ModuleInfo[] = []
  const files = await listModuleFilesRecursive(dir)
  for (const path of files) {
    const name = extractNameFromPath(path)
    if (!name) continue
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      text = ""
    }
    const link = parseLinkFromContent(text, getLinkPrefixes())
    const localTag = parseTag(text, "local")
    const isLocal =
      localTag != null &&
      String(localTag).trim() !== "" &&
      !["0", "false", "no"].includes(String(localTag).trim().toLowerCase())
    if (!link && !isLocal) continue
    const category = parseTag(text, "category") ?? parseTag(text, "cagegory") ?? undefined
    modules.push({ name, link, category, filePath: path, isLocal })
  }
  return modules
}

export function moduleFilePath(moduleName: string, dir?: string): string {
  const base = dir ?? getModulesDir()
  return Path.join(base, `${moduleName}.sgmodule`)
}

function resolveModulePath(target: ModuleInfo | string): string {
  if (typeof target === "string") return moduleFilePath(target)
  return target.filePath ?? moduleFilePath(target.name)
}

export async function detectLinkPrefix(target: ModuleInfo | string): Promise<string | undefined> {
  const fm = fmOrThrow()
  const path = resolveModulePath(target)
  if (!(await exists(path))) return undefined
  const raw = await fm.readAsString(path)
  return detectLinkPrefixFromContent(String(raw ?? ""), getLinkPrefixes())
}

export async function removeModuleFile(target: ModuleInfo | string): Promise<void> {
  const fm = fmOrThrow()
  const path = resolveModulePath(target)
  if (!(await exists(path))) return
  if (typeof fm.remove === "function") {
    await fm.remove(path)
    return
  }
  if (typeof fm.removeSync === "function") {
    fm.removeSync(path)
    return
  }
  throw new Error("FileManager.remove 不可用")
}

export async function renameModuleFile(oldTarget: ModuleInfo | string, newName: string): Promise<void> {
  const fm = fmOrThrow()
  const from = resolveModulePath(oldTarget)
  const to = Path.join(Path.dirname(from), `${newName}.sgmodule`)
  if (!(await exists(from))) return
  if (typeof fm.rename === "function") {
    await fm.rename(from, to)
    return
  }
  if (typeof fm.renameSync === "function") {
    fm.renameSync(from, to)
    return
  }
  throw new Error("FileManager.rename 不可用")
}

function upsertTag(content: string, key: string, value?: string): string {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) {
    return content.replace(new RegExp(`^\\s*#!\\s*${key}\\s*=.*\\n?`, "im"), "")
  }
  const line = `#!${key}=${trimmed}`
  const re = new RegExp(`^\\s*#!\\s*${key}\\s*=.*$`, "im")
  if (re.test(content)) return content.replace(re, line)
  return `${line}\n${content}`
}

function upsertLink(content: string, prefixes: string[], value?: string): string {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return content
  const lines = String(content ?? "").split(/\r?\n/g)
  let matchedPrefix: string | undefined
  const filtered = lines.filter((line) => {
    const t = line.trimStart()
    const hit = prefixes.find((p) => t.startsWith(p))
    if (hit && !matchedPrefix) matchedPrefix = hit
    return !hit
  })
  const prefix = matchedPrefix ?? prefixes[0] ?? "#url="
  return `${prefix}${trimmed}\n${filtered.join("\n")}`
}

export async function updateModuleMetadata(
  target: ModuleInfo | string,
  info: { link?: string; category?: string; local?: boolean }
) {
  const fm = fmOrThrow()
  const path = resolveModulePath(target)
  if (!(await exists(path))) return
  const raw = await fm.readAsString(path)
  let content = String(raw ?? "")
  content = upsertLink(content, getLinkPrefixes(), info.link)
  content = upsertTag(content, "category", info.category)
  if (info.local !== undefined) {
    content = upsertTag(content, "local", info.local ? "true" : "")
  }
  await fm.writeAsString(path, content)
}

export async function saveLocalModule(info: ModuleInfo, rawContent: string): Promise<void> {
  await ensureStorage()
  const fm = fmOrThrow()
  if (!fm?.writeAsString) throw new Error("FileManager.writeAsString 不可用")
  const path = moduleFilePath(info.name, info.saveDir)
  let content = String(rawContent ?? "")
  content = upsertTag(content, "local", "true")
  content = upsertTag(content, "category", info.category)
  await fm.writeAsString(path, content)
}

export async function listDirectSubDirs(baseDir?: string): Promise<string[]> {
  const fm = fmOrThrow()
  const root = baseDir ?? getModulesDir()
  const list = await fm.readDirectory(root)
  if (!Array.isArray(list)) return []
  const dirs: string[] = []
  for (const entry of list) {
    const raw = String(entry)
    const full = raw.includes("/") ? raw : Path.join(root, raw)
    const name = raw.includes("/") ? raw.split("/").pop() ?? raw : raw
    if (!name || name.startsWith(".")) continue
    if (name === "__pycache__" || name === "__pypackages__") continue
    if (await isDirectory(full)) dirs.push(full)
  }
  return dirs
}

export async function loadCategoriesFromModules(baseDir?: string): Promise<{
  categories: string[]
  scanned: number
  added: number
}> {
  const fm = fmOrThrow()
  const primaryDir = baseDir ?? getModulesDir()
  const altDir = baseDir ? Path.join(baseDir, MODULES_DIR_NAME) : undefined
  let files: string[] = []
  if (await exists(primaryDir)) {
    files = await listModuleFilesRecursive(primaryDir)
  }
  if (!files.length && altDir && (await exists(altDir))) {
    files = await listModuleFilesRecursive(altDir)
  }
  const set = new Set<string>()
  for (const path of files) {
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      text = ""
    }
    const cat = parseTag(text, "category") ?? parseTag(text, "cagegory")
    if (cat) set.add(cat)
  }
  const categories = Array.from(set)
  return { categories, scanned: files.length, added: categories.length }
}

export async function renameCategoryInModules(oldName: string, newName: string, baseDir?: string): Promise<void> {
  const fm = fmOrThrow()
  const primaryDir = baseDir ?? getModulesDir()
  const altDir = baseDir ? Path.join(baseDir, MODULES_DIR_NAME) : undefined
  let files: string[] = []
  if (await exists(primaryDir)) {
    files = await listModuleFilesRecursive(primaryDir)
  }
  if (!files.length && altDir && (await exists(altDir))) {
    files = await listModuleFilesRecursive(altDir)
  }
  for (const path of files) {
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      continue
    }
    const cat = parseTag(text, "category")
    if (!cat || cat !== oldName) continue
    let content = upsertTag(text, "category", newName)
    await fm.writeAsString(path, content)
  }
}

export async function countModulesByCategory(baseDir?: string): Promise<Record<string, number>> {
  const fm = fmOrThrow()
  const primaryDir = baseDir ?? getModulesDir()
  const altDir = baseDir ? Path.join(baseDir, MODULES_DIR_NAME) : undefined
  let files: string[] = []
  if (await exists(primaryDir)) {
    files = await listModuleFilesRecursive(primaryDir)
  }
  if (!files.length && altDir && (await exists(altDir))) {
    files = await listModuleFilesRecursive(altDir)
  }
  const counts: Record<string, number> = {}
  for (const path of files) {
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      text = ""
    }
    const cat = parseTag(text, "category") ?? parseTag(text, "cagegory") ?? ""
    if (!cat) continue
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  return counts
}

export function uniqueCategories(list: ModuleInfo[]): string[] {
  const set = new Set<string>()
  for (const item of list) {
    const c = String(item.category ?? "").trim()
    if (c) set.add(c)
  }
  return Array.from(set)
}

export function sortModules(list: ModuleInfo[]): ModuleInfo[] {
  return [...list].sort((a, b) => {
    const ca = String(a.category ?? "")
    const cb = String(b.category ?? "")
    if (ca !== cb) return ca.localeCompare(cb)
    return a.name.localeCompare(b.name)
  })
}
