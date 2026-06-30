import { Path } from "scripting"

import { loadConfig, saveConfig, type AppConfig } from "./config"
import {
  detectLinkPrefix,
  getModulesDirResolved,
  loadModules,
  moduleFilePath,
  updateModuleMetadata,
  type ModuleInfo,
} from "./storage"

const SYNC_DIR_NAME = "SurgeModulesManager"
const METADATA_FILE_NAME = "metadata.json"
const METADATA_VERSION = 1

type MetadataModule = {
  name: string
  surgeName?: string
  link: string
  linkPrefix?: string
  category?: string
  relativeDir?: string
  isLocal?: boolean
}

type MetadataFile = {
  version: number
  updatedAt: string
  modules: MetadataModule[]
  settings?: {
    categories?: string[]
    linkPatternsText?: string
  }
}

export type MetadataExportResult = {
  path: string
  count: number
}

export type MetadataImportResult = {
  path: string
  scanned: number
  created: number
  updated: number
  skipped: number
  categoriesAdded: number
  config: AppConfig
}

function fmOrThrow(): any {
  const fm = (globalThis as any).FileManager
  if (!fm) throw new Error("FileManager 不可用")
  return fm
}

async function exists(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.exists === "function") return !!(await fm.exists(path))
  if (typeof fm.existsSync === "function") return !!fm.existsSync(path)
  return false
}

async function ensureDir(path: string): Promise<void> {
  const fm = fmOrThrow()
  if (await exists(path)) return
  if (typeof fm.createDirectory === "function") {
    await fm.createDirectory(path, true)
    return
  }
  if (typeof fm.createDirectorySync === "function") {
    fm.createDirectorySync(path, true)
    return
  }
  throw new Error("FileManager.createDirectory 不可用")
}

function dirname(path: string): string {
  const idx = String(path ?? "").lastIndexOf("/")
  return idx > 0 ? path.slice(0, idx) : ""
}

function relativeDirOf(module: ModuleInfo, baseDir: string): string {
  const filePath = String(module.filePath ?? "")
  if (!filePath) return ""
  const parent = dirname(filePath)
  if (!baseDir || parent === baseDir) return ""
  return parent.replace(baseDir, "").replace(/^\/+/, "")
}

function normalizeRelativeDir(dir?: string): string {
  return String(dir ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
}

function normalizeCategories(list: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of list ?? []) {
    const value = String(raw ?? "").trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function moduleKey(name: string, relativeDir?: string): string {
  return `${normalizeRelativeDir(relativeDir)}\u0000${String(name ?? "").trim()}`
}

export function iCloudMetadataAvailable(): boolean {
  const fm = (globalThis as any).FileManager
  return !!(fm?.isiCloudEnabled && fm?.iCloudDocumentsDirectory)
}

export async function iCloudMetadataPath(): Promise<string> {
  const fm = fmOrThrow()
  if (!fm.isiCloudEnabled || !fm.iCloudDocumentsDirectory) {
    throw new Error("iCloud 不可用，请先确认已登录 iCloud 并允许 Scripting 使用 iCloud")
  }
  const dir = Path.join(fm.iCloudDocumentsDirectory, SYNC_DIR_NAME)
  await ensureDir(dir)
  return Path.join(dir, METADATA_FILE_NAME)
}

async function buildMetadata(): Promise<MetadataFile> {
  const cfg = loadConfig()
  const baseDir = await getModulesDirResolved()
  const modules = await loadModules()
  const items: MetadataModule[] = []

  for (const module of modules) {
    if (!module.link) continue
    items.push({
      name: module.name,
      surgeName: module.surgeName,
      link: module.link,
      linkPrefix: await detectLinkPrefix(module),
      category: module.category,
      relativeDir: relativeDirOf(module, baseDir),
      isLocal: !!module.isLocal,
    })
  }

  return {
    version: METADATA_VERSION,
    updatedAt: new Date().toISOString(),
    modules: items,
    settings: {
      categories: cfg.categories ?? [],
      linkPatternsText: cfg.linkPatternsText,
    },
  }
}

export async function exportMetadataToICloud(): Promise<MetadataExportResult> {
  const fm = fmOrThrow()
  if (!fm?.writeAsString) throw new Error("FileManager.writeAsString 不可用")
  const path = await iCloudMetadataPath()
  const metadata = await buildMetadata()
  await fm.writeAsString(path, JSON.stringify(metadata, null, 2))
  return { path, count: metadata.modules.length }
}

export async function exportMetadataWithDocumentPicker(): Promise<MetadataExportResult> {
  const picker = (globalThis as any).DocumentPicker
  const Data = (globalThis as any).Data
  if (!picker?.exportFiles) throw new Error("DocumentPicker.exportFiles 不可用")
  if (!Data?.fromString) throw new Error("Data.fromString 不可用")

  const metadata = await buildMetadata()
  const data = Data.fromString(JSON.stringify(metadata, null, 2))
  if (!data) throw new Error("元数据编码失败")

  const paths = await picker.exportFiles({
    files: [
      {
        data,
        name: METADATA_FILE_NAME,
      },
    ],
  })
  const path = Array.isArray(paths) ? String(paths[0] ?? "") : ""
  if (!path) throw new Error("未选择导出位置")
  return { path, count: metadata.modules.length }
}

export async function removeICloudMetadataFile(): Promise<boolean> {
  if (!iCloudMetadataAvailable()) return false
  const fm = fmOrThrow()
  const path = Path.join(fm.iCloudDocumentsDirectory, SYNC_DIR_NAME, METADATA_FILE_NAME)
  if (!(await exists(path))) return false
  if (typeof fm.remove === "function") {
    await fm.remove(path)
    return true
  }
  if (typeof fm.removeSync === "function") {
    fm.removeSync(path)
    return true
  }
  throw new Error("FileManager.remove 不可用")
}

function parseMetadata(raw: string): MetadataFile {
  const parsed = JSON.parse(String(raw ?? ""))
  if (!parsed || typeof parsed !== "object") throw new Error("元数据格式无效")
  const modules = Array.isArray(parsed.modules) ? parsed.modules : []
  return {
    version: Number(parsed.version ?? 0),
    updatedAt: String(parsed.updatedAt ?? ""),
    modules: modules
      .map((item: any) => ({
        name: String(item?.name ?? "").trim(),
        surgeName: String(item?.surgeName ?? "").trim() || undefined,
        link: String(item?.link ?? "").trim(),
        linkPrefix: String(item?.linkPrefix ?? "") || undefined,
        category: String(item?.category ?? "").trim() || undefined,
        relativeDir: normalizeRelativeDir(item?.relativeDir),
        isLocal: !!item?.isLocal,
      }))
      .filter((item: MetadataModule) => item.name && item.link),
    settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : undefined,
  }
}

function placeholderContent(item: MetadataModule): string {
  const lines: string[] = []
  const prefix = item.linkPrefix || loadConfig().linkPatternsText.split(/\r?\n/g).find((s) => s.trim()) || "#!url="
  lines.push(`${prefix}${item.link}`)
  if (item.category) lines.push(`#!category=${item.category}`)
  if (item.surgeName) lines.push(`#!name=${item.surgeName}`)
  lines.push("# Generated by Surge 模块管理 metadata import.")
  return lines.join("\n")
}

async function savePlaceholderModule(item: MetadataModule, targetDir: string): Promise<void> {
  const fm = fmOrThrow()
  if (!fm?.writeAsString) throw new Error("FileManager.writeAsString 不可用")
  await ensureDir(targetDir)
  await fm.writeAsString(moduleFilePath(item.name, targetDir), placeholderContent(item))
}

export async function importMetadataFromFile(
  path: string,
  currentCfg: AppConfig = loadConfig()
): Promise<MetadataImportResult> {
  const fm = fmOrThrow()
  if (!fm?.readAsString) throw new Error("FileManager.readAsString 不可用")

  const filePath = String(path ?? "").trim()
  if (!filePath) throw new Error("未选择元数据文件")
  if (!(await exists(filePath))) throw new Error("元数据文件不存在或无访问权限")

  const raw = await fm.readAsString(filePath)
  const metadata = parseMetadata(raw)
  const baseDir = await getModulesDirResolved()
  const currentModules = await loadModules()
  const byPath = new Map<string, ModuleInfo>()
  const byLink = new Map<string, ModuleInfo>()

  for (const module of currentModules) {
    byPath.set(moduleKey(module.name, relativeDirOf(module, baseDir)), module)
    if (module.link) byLink.set(module.link, module)
  }

  let created = 0
  let updated = 0
  let skipped = 0

  for (const item of metadata.modules) {
    const relativeDir = normalizeRelativeDir(item.relativeDir)
    const targetDir = relativeDir ? Path.join(baseDir, relativeDir) : baseDir
    const existing = byPath.get(moduleKey(item.name, relativeDir))
    if (existing) {
      await updateModuleMetadata(existing, {
        link: item.link,
        category: item.category,
        local: false,
      })
      updated += 1
      continue
    }

    if (byLink.has(item.link)) {
      skipped += 1
      continue
    }

    await savePlaceholderModule(item, targetDir)
    created += 1
  }

  const importedCategories = normalizeCategories([
    ...(metadata.settings?.categories ?? []),
    ...metadata.modules.map((item) => item.category ?? ""),
  ])
  const existingCategories = new Set(currentCfg.categories ?? [])
  const categoriesToAdd = importedCategories.filter((item) => !existingCategories.has(item))
  const nextCfg: AppConfig = {
    ...currentCfg,
    categories: normalizeCategories([...(currentCfg.categories ?? []), ...categoriesToAdd]),
    linkPatternsText: String(metadata.settings?.linkPatternsText ?? currentCfg.linkPatternsText),
  }
  saveConfig(nextCfg)

  return {
    path: filePath,
    scanned: metadata.modules.length,
    created,
    updated,
    skipped,
    categoriesAdded: categoriesToAdd.length,
    config: nextCfg,
  }
}

export async function importMetadataFromICloud(currentCfg: AppConfig = loadConfig()): Promise<MetadataImportResult> {
  const path = await iCloudMetadataPath()
  return importMetadataFromFile(path, currentCfg)
}

export async function autoExportMetadataToICloud(cfg: AppConfig = loadConfig()): Promise<void> {
  if (!cfg.iCloudMetadataSync) return
  try {
    await exportMetadataToICloud()
  } catch (e) {
    console.warn("[Surge模块管理] iCloud metadata auto export failed", e)
  }
}
