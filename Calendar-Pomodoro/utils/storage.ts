// Scripting 路径工具（拼接目录/文件路径）
import { Path } from "scripting"
// 存储相关常量
import { BASE_DIR_NAME, TASKS_FILE_NAME } from "../constants"
// 任务类型
import type { Task } from "../types"

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

// 任务文件路径
function getTasksPath(): string {
  return Path.join(getBaseDir(), TASKS_FILE_NAME)
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

// 确保基础存储目录存在
async function ensureStorage(): Promise<void> {
  await ensureDir(getBaseDir())
}

// 读取任务列表（容错：字段缺失时填默认值）
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

// 保存任务列表到本地
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
