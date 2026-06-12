import { Path } from "scripting"
import { BASE_DIR_NAME } from "../constants"

// 计时会话持久化结构（用于恢复 UI 状态）
export type TimerSessionSegment = {
  startAt: number
  endAt: number
}

// 计时会话持久化结构（用于恢复 UI 状态）
export type TimerSession = {
  taskId: string
  sessionStartAt: number
  segmentStartAt?: number
  accumulatedMs: number
  segments?: TimerSessionSegment[]
  running: boolean
  paused: boolean
  activityId?: string
}

const SESSION_FILE_NAME = "session.json"

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

// 会话文件路径
function getSessionPath(): string {
  return Path.join(getBaseDir(), SESSION_FILE_NAME)
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

// 读取会话，失败时返回 null
export async function loadSession(): Promise<TimerSession | null> {
  await ensureStorage()
  const fm = fmOrThrow()
  const path = getSessionPath()
  if (!(await exists(path))) return null
  try {
    const raw = await fm.readAsString(path)
    const data = JSON.parse(String(raw ?? ""))
    if (!data?.taskId || !data?.sessionStartAt) return null
    return {
      taskId: String(data.taskId),
      sessionStartAt: Number(data.sessionStartAt) || 0,
      segmentStartAt: data.segmentStartAt ? Number(data.segmentStartAt) : undefined,
      accumulatedMs: Number(data.accumulatedMs) || 0,
      segments: Array.isArray(data.segments)
        ? data.segments
            .map((item: any) => ({
              startAt: Number(item?.startAt) || 0,
              endAt: Number(item?.endAt) || 0,
            }))
            .filter((item: TimerSessionSegment) => item.startAt > 0 && item.endAt > item.startAt)
        : [],
      running: Boolean(data.running),
      paused: Boolean(data.paused),
      activityId: data.activityId ? String(data.activityId) : undefined,
    }
  } catch {
    return null
  }
}

// 保存会话
export async function saveSession(session: TimerSession): Promise<void> {
  await ensureStorage()
  const fm = fmOrThrow()
  const path = getSessionPath()
  const text = JSON.stringify(session, null, 2)
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

// 清空会话
export async function clearSession(): Promise<void> {
  await ensureStorage()
  const fm = fmOrThrow()
  const path = getSessionPath()
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
