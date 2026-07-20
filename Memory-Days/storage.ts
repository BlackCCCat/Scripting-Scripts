import { Script, Path } from 'scripting'
import { AnniversaryEvent, AppData, AppSettings, Person } from './types'
import { deleteWidgetAvatar, saveWidgetAvatar } from './widgetAvatar'

const DATA_VERSION = 1
const BACKUP_VERSION = 1
const SCRIPT_STORAGE_NAME = '时光纪念'
const APP_FOLDER = SCRIPT_STORAGE_NAME
const LEGACY_APP_FOLDERS = ['时光纪念数据', '纪念' + '日数据']
const DATA_FILE = 'data.json'
const ICLOUD_SYNC_KEY = `${SCRIPT_STORAGE_NAME}.iCloudSyncEnabled`

interface BackupAsset {
  path: string
  base64: string
}

interface BackupFile {
  app: typeof SCRIPT_STORAGE_NAME
  version: number
  exportedAt: string
  data: AppData
  assets?: BackupAsset[]
}

export interface DataExportResult {
  path: string
  persons: number
  events: number
  assets: number
}

export interface DataImportResult {
  path: string
  persons: number
  events: number
  assets: number
  data: AppData
}

// 获取应用私有数据目录（本地位于 configs 目录下，iCloud 位于 Scripting iCloud Documents 下）
function localAppDir(): string {
  return Path.join(Path.dirname(Path.dirname(Script.directory)), 'configs', APP_FOLDER)
}

function iCloudAppDir(): string {
  return Path.join(FileManager.iCloudDocumentsDirectory, APP_FOLDER)
}

function appDir(useICloud: boolean): string {
  return useICloud ? iCloudAppDir() : localAppDir()
}

function legacyAppDirs(useICloud: boolean): string[] {
  const root = useICloud ? FileManager.iCloudDocumentsDirectory : Path.join(Path.dirname(Path.dirname(Script.directory)), 'configs')
  return LEGACY_APP_FOLDERS.map(folder => Path.join(root, folder))
}

// 获取头像存储目录
function avatarsDir(useICloud: boolean): string {
  return `${appDir(useICloud)}/avatars`
}

// 获取数据文件路径
function dataFilePath(useICloud: boolean): string {
  return `${appDir(useICloud)}/${DATA_FILE}`
}

function normalizeStoredPath(path: string | null | undefined, useICloud: boolean): string | null {
  if (!path) return path ?? null
  const currentRoot = appDir(useICloud)
  for (const legacyRoot of legacyAppDirs(useICloud)) {
    if (path.startsWith(legacyRoot)) return path.replace(legacyRoot, currentRoot)
  }
  return path
}

function isICloudAvailable(): boolean {
  return !!(FileManager.isiCloudEnabled && FileManager.iCloudDocumentsDirectory)
}

function isICloudSyncEnabled(): boolean {
  return !!Storage.get<boolean>(ICLOUD_SYNC_KEY, { shared: true })
}

function setICloudSyncPreference(enabled: boolean): void {
  Storage.set(ICLOUD_SYNC_KEY, enabled, { shared: true })
}

function shouldUseICloudStorage(): boolean {
  return isICloudSyncEnabled() && isICloudAvailable()
}

// 初始化目录
export async function ensureDirectories(useICloud = shouldUseICloudStorage()): Promise<void> {
  const root = appDir(useICloud)
  if (!(await FileManager.exists(root))) {
    for (const legacyDir of legacyAppDirs(useICloud)) {
      if (!(await FileManager.exists(legacyDir))) continue
      try {
        await FileManager.rename(legacyDir, root)
        break
      } catch {
        // 若旧目录迁移失败，则继续创建新目录，避免阻塞应用启动。
      }
    }
  }
  if (!(await FileManager.exists(root))) {
    await FileManager.createDirectory(root, true)
  }
  const avatarRoot = avatarsDir(useICloud)
  if (!(await FileManager.exists(avatarRoot))) {
    await FileManager.createDirectory(avatarRoot, true)
  }
}

// 默认设置
function defaultSettings(): AppSettings {
  return {
    defaultReminderDays: [1, 3],
    defaultRemindOnDay: true,
    notificationsEnabled: true,
    groupPastEvents: true,
    iCloudSyncEnabled: false,
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
  const useICloud = shouldUseICloudStorage()
  return await readDataFromStorage(useICloud) ?? { ...defaultData(), settings: { ...defaultSettings(), iCloudSyncEnabled: useICloud } }
}

// 保存应用数据
export async function saveAppData(data: AppData): Promise<void> {
  const useICloud = shouldUseICloudStorage()
  await ensureDirectories(useICloud)
  const payload: AppData = {
    ...data,
    settings: { ...data.settings, iCloudSyncEnabled: useICloud },
    version: DATA_VERSION
  }
  await FileManager.writeAsString(dataFilePath(useICloud), JSON.stringify(payload, null, 2))
}

// 保存头像图片并返回本地路径
export async function saveAvatar(imageData: Data): Promise<string> {
  const useICloud = shouldUseICloudStorage()
  await ensureDirectories(useICloud)
  const name = `avatar_${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`
  const path = `${avatarsDir(useICloud)}/${name}`
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

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}

function safeFileName(path: string, fallback: string): string {
  const name = basename(path).replace(/[^\w.-]/g, '_')
  return name || fallback
}

async function ensureICloudFileDownloaded(path: string): Promise<void> {
  try {
    if (
      FileManager.isFileStoredIniCloud(path) &&
      !FileManager.isiCloudFileDownloaded(path)
    ) {
      await FileManager.downloadFileFromiCloud(path)
    }
  } catch {
    // 非 iCloud 文件或系统暂时无法判断下载状态时，后续读取自行兜底。
  }
}

async function readImageAsset(path: string | null): Promise<BackupAsset | null> {
  if (!path) return null
  try {
    if (!(await FileManager.exists(path))) return null
    await ensureICloudFileDownloaded(path)
    const data = await FileManager.readAsData(path)
    return { path, base64: data.toBase64String() }
  } catch {
    return null
  }
}

async function copyImageToStorage(path: string | null, useICloud: boolean): Promise<string | null> {
  if (!path) return null
  try {
    if (!(await FileManager.exists(path))) return path
    await ensureDirectories(useICloud)
    const targetRoot = avatarsDir(useICloud)
    if (path.startsWith(`${targetRoot}/`)) return path
    await ensureICloudFileDownloaded(path)
    const data = await FileManager.readAsData(path)
    const newPath = `${targetRoot}/avatar_${Date.now()}_${Math.floor(Math.random() * 10000)}_${safeFileName(path, 'photo.jpg')}`
    await FileManager.writeAsData(newPath, data)
    await saveWidgetAvatar(newPath)
    return newPath
  } catch {
    return path
  }
}

async function copyDataToStorage(data: AppData, useICloud: boolean): Promise<AppData> {
  const personPathMap = new Map<string, string | null>()
  const eventPathMap = new Map<string, string | null>()
  const persons: Person[] = []
  const events: AnniversaryEvent[] = []

  for (const person of data.persons) {
    const oldPath = person.avatarPath ?? null
    const nextPath = personPathMap.has(oldPath ?? '')
      ? personPathMap.get(oldPath ?? '') ?? null
      : await copyImageToStorage(oldPath, useICloud)
    personPathMap.set(oldPath ?? '', nextPath)
    persons.push({ ...person, avatarPath: nextPath })
  }

  for (const event of data.events) {
    const oldPath = event.photoPath ?? null
    const nextPath = eventPathMap.has(oldPath ?? '')
      ? eventPathMap.get(oldPath ?? '') ?? null
      : await copyImageToStorage(oldPath, useICloud)
    eventPathMap.set(oldPath ?? '', nextPath)
    events.push({ ...event, photoPath: nextPath })
  }

  return {
    ...data,
    persons,
    events,
    settings: { ...data.settings, iCloudSyncEnabled: useICloud }
  }
}

async function readDataFromStorage(useICloud: boolean): Promise<AppData | null> {
  await ensureDirectories(useICloud)
  const path = dataFilePath(useICloud)
  if (!(await FileManager.exists(path))) return null
  try {
    if (useICloud) await ensureICloudFileDownloaded(path)
    const content = await FileManager.readAsString(path)
    const parsed = JSON.parse(content) as AppData
    if (!parsed || typeof parsed !== 'object') return null
    return migrateData({
      ...defaultData(),
      ...parsed,
      persons: parsed.persons ?? [],
      events: parsed.events ?? [],
      settings: { ...defaultSettings(), ...(parsed.settings ?? {}), iCloudSyncEnabled: useICloud }
    }, useICloud)
  } catch {
    return null
  }
}

function mergeById<T extends { id: string }>(base: T[], incoming: T[]): T[] {
  const items = new Map<string, T>()
  for (const item of base) {
    if (item.id) items.set(item.id, item)
  }
  for (const item of incoming) {
    if (item.id) items.set(item.id, item)
  }
  return Array.from(items.values())
}

function mergeStorageData(base: AppData, incoming: AppData, useICloud: boolean): AppData {
  return {
    ...incoming,
    persons: mergeById(base.persons, incoming.persons),
    events: mergeById(base.events, incoming.events),
    settings: { ...incoming.settings, iCloudSyncEnabled: useICloud },
    version: DATA_VERSION
  }
}

export async function setAppDataStorageMode(enabled: boolean, data: AppData): Promise<AppData> {
  if (enabled && !isICloudAvailable()) {
    throw new Error('iCloud 不可用，请先确认已登录 iCloud 并允许 Scripting 使用 iCloud。')
  }
  const migrated = await copyDataToStorage(data, enabled)
  const existing = await readDataFromStorage(enabled)
  const payload = existing ? mergeStorageData(existing, migrated, enabled) : migrated
  setICloudSyncPreference(enabled)
  await ensureDirectories(enabled)
  await FileManager.writeAsString(dataFilePath(enabled), JSON.stringify({ ...payload, version: DATA_VERSION }, null, 2))
  return payload
}

async function buildBackup(data: AppData): Promise<BackupFile> {
  const assets: BackupAsset[] = []
  const paths = new Set<string>()

  for (const person of data.persons) {
    if (person.avatarPath) paths.add(person.avatarPath)
  }
  for (const event of data.events) {
    if (event.photoPath) paths.add(event.photoPath)
  }
  for (const path of paths) {
    const asset = await readImageAsset(path)
    if (asset) assets.push(asset)
  }

  return {
    app: SCRIPT_STORAGE_NAME,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { ...data, version: DATA_VERSION },
    assets
  }
}

function exportFileName(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-')
  return `${SCRIPT_STORAGE_NAME}-备份-${stamp}.json`
}

export async function exportAppData(data: AppData): Promise<DataExportResult> {
  const backup = await buildBackup(data)
  const content = JSON.stringify(backup, null, 2)
  const fileData = Data.fromRawString(content) ?? Data.fromString(content)
  if (!fileData) throw new Error('备份数据编码失败。')
  const paths = await DocumentPicker.exportFiles({
    files: [{ data: fileData, name: exportFileName() }]
  })
  const path = Array.isArray(paths) ? String(paths[0] ?? '') : ''
  if (!path) throw new Error('未选择导出位置。')
  return {
    path,
    persons: data.persons.length,
    events: data.events.length,
    assets: backup.assets?.length ?? 0
  }
}

function parseImportedBackup(content: string): BackupFile {
  const parsed = JSON.parse(content)
  const data = parsed?.data ?? parsed
  if (!data || !Array.isArray(data.persons) || !Array.isArray(data.events)) {
    throw new Error('选择的文件不是有效的时光纪念备份。')
  }
  return {
    app: SCRIPT_STORAGE_NAME,
    version: Number(parsed?.version ?? BACKUP_VERSION),
    exportedAt: String(parsed?.exportedAt ?? ''),
    data: migrateData({
      ...defaultData(),
      ...data,
      persons: data.persons ?? [],
      events: data.events ?? [],
      settings: { ...defaultSettings(), ...(data.settings ?? {}) }
    }, shouldUseICloudStorage()),
    assets: Array.isArray(parsed?.assets) ? parsed.assets : []
  }
}

async function restoreAssets(assets: BackupAsset[]): Promise<Map<string, string>> {
  const restored = new Map<string, string>()
  for (const asset of assets) {
    if (!asset?.path || !asset?.base64) continue
    const data = Data.fromBase64String(asset.base64)
    if (!data) continue
    const path = await saveAvatar(data)
    await saveWidgetAvatar(path)
    restored.set(asset.path, path)
    const normalizedPath = normalizeStoredPath(asset.path, shouldUseICloudStorage())
    if (normalizedPath) restored.set(normalizedPath, path)
  }
  return restored
}

async function importExistingImage(path: string): Promise<string | null> {
  const candidates = Array.from(new Set([
    path,
    normalizeStoredPath(path, shouldUseICloudStorage())
  ].filter(Boolean))) as string[]
  for (const candidate of candidates) {
    try {
      if (!(await FileManager.exists(candidate))) continue
      await ensureICloudFileDownloaded(candidate)
      const data = await FileManager.readAsData(candidate)
      const newPath = await saveAvatar(data)
      await saveWidgetAvatar(newPath)
      return newPath
    } catch {
      // 尝试下一个候选路径
    }
  }
  return null
}

async function resolveImportedImagePath(path: string | null | undefined, assetMap: Map<string, string>): Promise<string | null> {
  if (!path) return null
  const normalizedPath = normalizeStoredPath(path, shouldUseICloudStorage())
  return assetMap.get(path)
    ?? (normalizedPath ? assetMap.get(normalizedPath) : undefined)
    ?? await importExistingImage(path)
}

function remapLargeGroupId(groupId: string | null | undefined, groupIdMap: Map<string, string>): string | null {
  if (!groupId) return null
  if (!groupIdMap.has(groupId)) {
    groupIdMap.set(groupId, generateId())
  }
  return groupIdMap.get(groupId) ?? null
}

async function mergeImportedData(current: AppData, imported: AppData, assetMap: Map<string, string>): Promise<AppData> {
  const personIdMap = new Map<string, string>()
  const groupIdMap = new Map<string, string>()
  const importedPersons: Person[] = []
  for (const person of imported.persons) {
    const id = generateId()
    personIdMap.set(person.id, id)
    importedPersons.push({
      ...person,
      id,
      avatarPath: await resolveImportedImagePath(person.avatarPath, assetMap),
      createdAt: person.createdAt ?? Date.now()
    })
  }
  const importedEvents: AnniversaryEvent[] = []
  for (const event of imported.events) {
    importedEvents.push({
      ...event,
      id: generateId(),
      personId: personIdMap.get(event.personId) ?? event.personId,
      photoPath: await resolveImportedImagePath(event.photoPath, assetMap),
      largeGroupId: remapLargeGroupId(event.largeGroupId, groupIdMap),
      createdAt: event.createdAt ?? Date.now()
    })
  }

  return {
    ...current,
    persons: [...current.persons, ...importedPersons],
    events: [...current.events, ...importedEvents],
    settings: { ...current.settings, iCloudSyncEnabled: shouldUseICloudStorage() },
    version: DATA_VERSION
  }
}

export async function importAppData(current: AppData): Promise<DataImportResult> {
  const paths = await DocumentPicker.pickFiles({
    types: ['public.json', 'public.text', 'public.plain-text'],
    allowsMultipleSelection: false,
    shouldShowFileExtensions: true
  })
  const path = Array.isArray(paths) ? String(paths[0] ?? '') : ''
  if (!path) throw new Error('未选择导入文件。')

  try {
    const content = await FileManager.readAsString(path)
    const backup = parseImportedBackup(content)
    const assetMap = await restoreAssets(backup.assets ?? [])
    const data = await mergeImportedData(current, backup.data, assetMap)
    return {
      path,
      persons: backup.data.persons.length,
      events: backup.data.events.length,
      assets: assetMap.size,
      data
    }
  } finally {
    try {
      DocumentPicker.stopAcessingSecurityScopedResources()
    } catch {
      // 忽略释放安全作用域失败
    }
  }
}

// 数据迁移（未来扩展用）
function migrateData(data: AppData, useICloud = shouldUseICloudStorage()): AppData {
  return {
    ...data,
    settings: { ...defaultSettings(), ...data.settings, iCloudSyncEnabled: useICloud },
    persons: data.persons.map(person => ({
      ...person,
      avatarPath: normalizeStoredPath(person.avatarPath, useICloud)
    })),
    events: data.events.map(event => ({
      ...event,
      photoPath: normalizeStoredPath(event.photoPath, useICloud),
      denseWatermarkEnabled: event.denseWatermarkEnabled ?? true,
      widgetGradientEnabled: event.widgetGradientEnabled ?? false,
      largeGroupId: event.largeGroupId ?? null,
      largePartIndex: event.largePartIndex ?? null
    }))
  }
}
