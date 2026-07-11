import { Path } from "scripting"
import { BASE_DIR_NAME } from "../constants"

export type TaskDurationCache = Record<string, number>

const TASK_DURATIONS_FILE_NAME = "task-durations.json"

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

function getTaskDurationsPath(): string {
  return Path.join(getBaseDir(), TASK_DURATIONS_FILE_NAME)
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

export async function loadTaskDurationsCache(): Promise<TaskDurationCache> {
  await ensureStorage()
  const fm = fmOrThrow()
  const path = getTaskDurationsPath()
  if (!(await exists(path))) return {}
  try {
    const raw = await fm.readAsString(path)
    const data = JSON.parse(String(raw ?? ""))
    if (!data || typeof data !== "object" || Array.isArray(data)) return {}
    const result: TaskDurationCache = {}
    for (const [taskId, duration] of Object.entries(data)) {
      const value = Number(duration)
      if (taskId && Number.isFinite(value) && value > 0) {
        result[taskId] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

export async function saveTaskDurationsCache(cache: TaskDurationCache): Promise<void> {
  await ensureStorage()
  const fm = fmOrThrow()
  const path = getTaskDurationsPath()
  const text = JSON.stringify(cache, null, 2)
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
