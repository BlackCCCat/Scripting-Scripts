// Scripting 路径工具（拼接目录/文件路径）
import { Path } from "scripting"
// 存储相关常量
import { BASE_DIR_NAME } from "../constants"

// 全局设置结构
export type AppSettings = {
  showMarkdown: boolean
  selectedCalendarSourceIds: string[]
}

// 设置文件名
const SETTINGS_FILE_NAME = "settings.json"

// 默认设置
const DEFAULT_SETTINGS: AppSettings = {
  showMarkdown: true,
  selectedCalendarSourceIds: [],
}

// 获取 FileManager，环境不支持时抛错
function fmOrThrow(): any {
  const fm = (globalThis as any).FileManager
  if (!fm) throw new Error("FileManager 不可用")
  return fm
}

// 选择存储根目录（优先 iCloud，其次本地）
function pickRootDir(): string {
  const fm = fmOrThrow()
  if (fm.isiCloudEnabled && fm.iCloudDocumentsDirectory) return fm.iCloudDocumentsDirectory
  return fm.documentsDirectory || fm.appGroupDocumentsDirectory || fm.scriptsDirectory || ""
}

// 组合脚本私有数据目录
function getBaseDir(): string {
  return Path.join(pickRootDir(), BASE_DIR_NAME)
}

// 设置文件路径
function getSettingsPath(): string {
  return Path.join(getBaseDir(), SETTINGS_FILE_NAME)
}

// 判断路径是否存在（兼容异步/同步 API）
async function exists(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.exists === "function") return !!(await fm.exists(path))
  if (typeof fm.existsSync === "function") return !!fm.existsSync(path)
  return false
}

// 确保目录存在
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

// 确保存储目录已就绪
async function ensureStorage(): Promise<void> {
  await ensureDir(getBaseDir())
}

// 读取设置，若读取失败则返回默认值
export async function loadSettings(): Promise<AppSettings> {
  await ensureStorage()
  const fm = fmOrThrow()
  const path = getSettingsPath()
  if (!(await exists(path))) return { ...DEFAULT_SETTINGS }
  try {
    const raw = await fm.readAsString(path)
    const data = JSON.parse(String(raw ?? ""))
    const selectedCalendarSourceIds = Array.isArray(data?.selectedCalendarSourceIds)
      ? data.selectedCalendarSourceIds.filter((item: any) => typeof item === "string")
      : DEFAULT_SETTINGS.selectedCalendarSourceIds
    return {
      showMarkdown: typeof data?.showMarkdown === "boolean" ? data.showMarkdown : DEFAULT_SETTINGS.showMarkdown,
      selectedCalendarSourceIds,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

// 保存设置到本地
export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureStorage()
  const fm = fmOrThrow()
  const path = getSettingsPath()
  const text = JSON.stringify(settings, null, 2)
  if (typeof fm.writeAsString === "function") {
    await fm.writeAsString(path, text)
    return
  }
  if (typeof fm.writeAsStringSync === "function") {
    fm.writeAsStringSync(path, text)
    return
  }
  throw new Error("FileManager.writeAsString 不可用")
}
