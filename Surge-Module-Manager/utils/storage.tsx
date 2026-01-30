import { Path } from "scripting"
import { loadConfig } from "./config"

export type ModuleInfo = {
  name: string
  link: string
  category?: string
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

async function listModuleFiles(dir: string): Promise<string[]> {
  const fm = fmOrThrow()
  const list = await fm.readDirectory(dir)
  if (!Array.isArray(list)) return []
  const files: string[] = []
  for (const entry of list) {
    const raw = String(entry)
    if (!raw.toLowerCase().endsWith(".sgmodule")) continue
    files.push(raw.includes("/") ? raw : Path.join(dir, raw))
  }
  return files
}

export async function loadModules(): Promise<ModuleInfo[]> {
  await ensureStorage()
  const fm = fmOrThrow()
  const dir = getModulesDir()

  const modules: ModuleInfo[] = []
  const files = await listModuleFiles(dir)
  for (const path of files) {
    const name = extractNameFromPath(path)
    if (!name) continue
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      text = ""
    }
    const link = parseTag(text, "url") ?? ""
    const category = parseTag(text, "category") ?? parseTag(text, "cagegory") ?? undefined
    modules.push({ name, link, category })
  }
  return modules
}

export function moduleFilePath(moduleName: string): string {
  return Path.join(getModulesDir(), `${moduleName}.sgmodule`)
}

export async function removeModuleFile(moduleName: string): Promise<void> {
  const fm = fmOrThrow()
  const path = moduleFilePath(moduleName)
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

export async function renameModuleFile(oldName: string, newName: string): Promise<void> {
  const fm = fmOrThrow()
  const from = moduleFilePath(oldName)
  const to = moduleFilePath(newName)
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

export async function updateModuleMetadata(moduleName: string, info: { link?: string; category?: string }) {
  const fm = fmOrThrow()
  const path = moduleFilePath(moduleName)
  if (!(await exists(path))) return
  const raw = await fm.readAsString(path)
  let content = String(raw ?? "")
  content = upsertTag(content, "url", info.link)
  content = upsertTag(content, "category", info.category)
  await fm.writeAsString(path, content)
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
    files = await listModuleFiles(primaryDir)
  }
  if (!files.length && altDir && (await exists(altDir))) {
    files = await listModuleFiles(altDir)
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
    files = await listModuleFiles(primaryDir)
  }
  if (!files.length && altDir && (await exists(altDir))) {
    files = await listModuleFiles(altDir)
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
    files = await listModuleFiles(primaryDir)
  }
  if (!files.length && altDir && (await exists(altDir))) {
    files = await listModuleFiles(altDir)
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
