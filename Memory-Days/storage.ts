import { Script, Path } from 'scripting'
import { AppData, AppSettings } from './types'
import { deleteWidgetAvatar } from './widgetAvatar'

const DATA_VERSION = 1
const APP_FOLDER = '时光纪念数据'
const LEGACY_APP_FOLDER = '纪念' + '日数据'
const DATA_FILE = 'data.json'

// 获取应用私有数据目录（位于 configs 目录下）
function appDir(): string {
  return Path.join(Path.dirname(Path.dirname(Script.directory)), 'configs', APP_FOLDER)
}

function legacyAppDir(): string {
  return Path.join(Path.dirname(Path.dirname(Script.directory)), 'configs', LEGACY_APP_FOLDER)
}

// 获取头像存储目录
function avatarsDir(): string {
  return `${appDir()}/avatars`
}

// 获取数据文件路径
function dataFilePath(): string {
  return `${appDir()}/${DATA_FILE}`
}

// 初始化目录
export async function ensureDirectories(): Promise<void> {
  if (!(await FileManager.exists(appDir())) && await FileManager.exists(legacyAppDir())) {
    try {
      await FileManager.rename(legacyAppDir(), appDir())
    } catch {
      // 若旧目录迁移失败，则继续创建新目录，避免阻塞应用启动。
    }
  }
  if (!(await FileManager.exists(appDir()))) {
    await FileManager.createDirectory(appDir(), true)
  }
  if (!(await FileManager.exists(avatarsDir()))) {
    await FileManager.createDirectory(avatarsDir(), true)
  }
}

// 默认设置
function defaultSettings(): AppSettings {
  return {
    defaultReminderDays: [1, 3],
    defaultRemindOnDay: true,
    notificationsEnabled: true,
    groupPastEvents: true,
    notificationHour: 9,
    notificationMinute: 0
  }
}

// 默认数据
function defaultData(): AppData {
  return {
    persons: [],
    events: [],
    settings: defaultSettings(),
    version: DATA_VERSION
  }
}

// 读取应用数据
export async function loadAppData(): Promise<AppData> {
  await ensureDirectories()
  const path = dataFilePath()
  if (!(await FileManager.exists(path))) {
    return defaultData()
  }
  try {
    const content = await FileManager.readAsString(path)
    const parsed = JSON.parse(content) as AppData
    if (!parsed || typeof parsed !== 'object') {
      return defaultData()
    }
    return migrateData({
      ...defaultData(),
      ...parsed,
      persons: parsed.persons ?? [],
      events: parsed.events ?? [],
      settings: { ...defaultSettings(), ...(parsed.settings ?? {}) }
    })
  } catch {
    return defaultData()
  }
}

// 保存应用数据
export async function saveAppData(data: AppData): Promise<void> {
  await ensureDirectories()
  const payload: AppData = { ...data, version: DATA_VERSION }
  await FileManager.writeAsString(dataFilePath(), JSON.stringify(payload, null, 2))
}

// 保存头像图片并返回本地路径
export async function saveAvatar(imageData: Data): Promise<string> {
  await ensureDirectories()
  const name = `avatar_${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`
  const path = `${avatarsDir()}/${name}`
  await FileManager.writeAsData(path, imageData)
  return path
}

// 删除头像文件
export async function deleteAvatar(path: string | null): Promise<void> {
  if (!path) return
  try {
    if (await FileManager.exists(path)) {
      await FileManager.remove(path)
    }
    await deleteWidgetAvatar(path)
  } catch {
    // 忽略清理失败
  }
}

// 生成唯一 ID
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// 数据迁移（未来扩展用）
function migrateData(data: AppData): AppData {
  const legacyRoot = legacyAppDir()
  const currentRoot = appDir()
  return {
    ...data,
    persons: data.persons.map(person => ({
      ...person,
      avatarPath: person.avatarPath?.startsWith(legacyRoot)
        ? person.avatarPath.replace(legacyRoot, currentRoot)
        : person.avatarPath
    })),
    events: data.events.map(event => ({
      ...event,
      photoPath: event.photoPath?.startsWith(legacyRoot)
        ? event.photoPath.replace(legacyRoot, currentRoot)
        : event.photoPath ?? null,
      denseWatermarkEnabled: event.denseWatermarkEnabled ?? true,
      widgetGradientEnabled: event.widgetGradientEnabled ?? false,
      largeGroupId: event.largeGroupId ?? null,
      largePartIndex: event.largePartIndex ?? null
    }))
  }
}
