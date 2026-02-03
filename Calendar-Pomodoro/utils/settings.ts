import { Path } from "scripting"
import { BASE_DIR_NAME } from "../constants"

export type AppSettings = {
  showMarkdown: boolean
  selectedCalendarSourceIds: string[]
}

const SETTINGS_FILE_NAME = "settings.json"

const DEFAULT_SETTINGS: AppSettings = {
  showMarkdown: true,
  selectedCalendarSourceIds: [],
}

function fmOrThrow(): any {
  const fm = (globalThis as any).FileManager
  if (!fm) throw new Error("FileManager 不可用")
  return fm
}

function pickRootDir(): string {
  const fm = fmOrThrow()
  if (fm.isiCloudEnabled && fm.iCloudDocumentsDirectory) return fm.iCloudDocumentsDirectory
  return fm.documentsDirectory || fm.appGroupDocumentsDirectory || fm.scriptsDirectory || ""
}

function getBaseDir(): string {
  return Path.join(pickRootDir(), BASE_DIR_NAME)
}

function getSettingsPath(): string {
  return Path.join(getBaseDir(), SETTINGS_FILE_NAME)
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

async function ensureStorage(): Promise<void> {
  await ensureDir(getBaseDir())
}

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
