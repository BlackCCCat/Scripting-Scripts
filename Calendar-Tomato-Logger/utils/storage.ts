import { Path } from "scripting"
import { BASE_DIR_NAME, TASKS_FILE_NAME } from "../constants"
import type { Task } from "../types"

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

function getTasksPath(): string {
  return Path.join(getBaseDir(), TASKS_FILE_NAME)
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

export async function loadTasks(): Promise<Task[]> {
  await ensureStorage()
  const fm = fmOrThrow()
  const path = getTasksPath()
  if (!(await exists(path))) return []
  try {
    const raw = await fm.readAsString(path)
    const list = JSON.parse(String(raw ?? ""))
    if (!Array.isArray(list)) return []
    return list
      .map((item) => ({
        id: String(item?.id ?? ""),
        name: String(item?.name ?? ""),
        calendarId: String(item?.calendarId ?? ""),
        calendarTitle: String(item?.calendarTitle ?? ""),
        useCountdown: Boolean(item?.useCountdown ?? false),
        countdownSeconds: Number(item?.countdownSeconds ?? 0) || 0,
        useNotification: Boolean(item?.useNotification ?? false),
        notificationIntervalMinutes: Number(item?.notificationIntervalMinutes ?? 0) || 0,
        noteDraft: String(item?.noteDraft ?? ""),
      }))
      .filter((item) => item.id && item.name && item.calendarId)
  } catch {
    return []
  }
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  await ensureStorage()
  const fm = fmOrThrow()
  const path = getTasksPath()
  const text = JSON.stringify(tasks, null, 2)
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
