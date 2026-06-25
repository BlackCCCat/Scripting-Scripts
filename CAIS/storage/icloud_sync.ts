import type { CaisSettings } from "../types"
import { bumpClipDataVersion } from "./change_signal"
import { resetDatabaseConnection } from "./database"
import {
  iCloudAppRootDirectory,
  iCloudDatabasePath,
  iCloudImageDirectory,
  isICloudAvailable,
  localAppRootDirectory,
  localDatabasePath,
  localImageDirectory,
} from "./paths"

function fileManager(): any {
  return (globalThis as any).FileManager
}

function joinPath(base: string, name: string): string {
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`
}

async function exists(path: string): Promise<boolean> {
  const fm = fileManager()
  if (!path || !fm) return false
  if (typeof fm.exists === "function") return Boolean(await fm.exists(path))
  return Boolean(fm.existsSync?.(path))
}

async function ensureDirectory(path: string): Promise<void> {
  const fm = fileManager()
  if (!fm || !path) return
  if (!(await exists(path))) await fm.createDirectory?.(path, true)
}

async function removePath(path: string): Promise<void> {
  const fm = fileManager()
  if (!fm || !(await exists(path))) return
  if (typeof fm.remove === "function") await fm.remove(path)
  else fm.removeSync?.(path)
}

async function copyPath(from: string, to: string): Promise<void> {
  const fm = fileManager()
  if (!fm || !from || !to || !(await exists(from))) return
  try {
    if (
      typeof fm.isFileStoredIniCloud === "function" &&
      typeof fm.isiCloudFileDownloaded === "function" &&
      typeof fm.downloadFileFromiCloud === "function" &&
      fm.isFileStoredIniCloud(from) &&
      !fm.isiCloudFileDownloaded(from)
    ) {
      await fm.downloadFileFromiCloud(from)
    }
  } catch {
  }
  const slashIndex = to.lastIndexOf("/")
  if (slashIndex > 0) await ensureDirectory(to.slice(0, slashIndex))
  if (typeof fm.copyFile === "function") await fm.copyFile(from, to)
  else fm.copyFileSync?.(from, to)
}

async function moveFileReplacing(from: string, to: string): Promise<boolean> {
  if (!(await exists(from))) return false
  const slashIndex = to.lastIndexOf("/")
  if (slashIndex > 0) await ensureDirectory(to.slice(0, slashIndex))
  if (await exists(to)) await removePath(to)
  await copyPath(from, to)
  await removePath(from)
  return true
}

async function moveFileIfTargetMissing(from: string, to: string): Promise<boolean> {
  if (!(await exists(from))) return false
  if (await exists(to)) return false
  return moveFileReplacing(from, to)
}

async function moveDirectoryContents(fromDir: string, toDir: string): Promise<boolean> {
  const fm = fileManager()
  if (!fm || !(await exists(fromDir))) return false
  await ensureDirectory(toDir)
  const items: string[] = typeof fm.readDirectory === "function"
    ? await fm.readDirectory(fromDir, true)
    : fm.readDirectorySync?.(fromDir, true) ?? []
  for (const item of items) {
    const itemPath = item.startsWith("/") ? item : joinPath(fromDir, item)
    const relative = itemPath.startsWith(`${fromDir}/`) ? itemPath.slice(fromDir.length + 1) : item
    if (!relative) continue
    const target = joinPath(toDir, relative)
    if (typeof fm.isDirectory === "function" && await fm.isDirectory(itemPath)) {
      await ensureDirectory(target)
      continue
    }
    if (typeof fm.isDirectorySync === "function" && fm.isDirectorySync(itemPath)) {
      await ensureDirectory(target)
      continue
    }
    if (await exists(target)) await removePath(target)
    await copyPath(itemPath, target)
  }
  await removePath(fromDir)
  return true
}

function slash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`
}

async function rewriteImagePathPrefix(dbPath: string, fromDir: string, toDir: string): Promise<void> {
  if (!(await exists(dbPath)) || fromDir === toDir) return
  const sqlite = (globalThis as any).SQLite
  if (!sqlite?.open) return
  const db = sqlite.open(dbPath)
  const fromPrefix = slash(fromDir)
  const toPrefix = slash(toDir)
  try {
    await db.execute(
      "UPDATE clips SET image_path = REPLACE(image_path, ?, ?) WHERE image_path LIKE ?",
      [fromPrefix, toPrefix, `${fromPrefix}%`]
    )
  } catch {
  }
}

function databasePathFor(settings: CaisSettings): string {
  return settings.iCloudSync ? iCloudDatabasePath() : localDatabasePath()
}

function imageDirectoryFor(settings: CaisSettings): string {
  return settings.iCloudSync && settings.iCloudSyncImages ? iCloudImageDirectory() : localImageDirectory()
}

export async function applyICloudSyncSettings(previous: CaisSettings, next: CaisSettings): Promise<void> {
  const changesICloud = previous.iCloudSync !== next.iCloudSync
  const changesImages = previous.iCloudSyncImages !== next.iCloudSyncImages
  if (!changesICloud && !changesImages) return
  if (next.iCloudSync && !isICloudAvailable()) {
    throw new Error("当前设备未启用 iCloud，或 Scripting 尚未获得 iCloud 权限。")
  }

  await ensureDirectory(localAppRootDirectory())
  if (next.iCloudSync || previous.iCloudSync) await ensureDirectory(iCloudAppRootDirectory())

  const previousDb = databasePathFor(previous)
  const nextDb = databasePathFor(next)
  const previousImages = imageDirectoryFor(previous)
  const nextImages = imageDirectoryFor(next)

  if (previousDb !== nextDb) {
    if (next.iCloudSync) await moveFileIfTargetMissing(previousDb, nextDb)
    else await moveFileReplacing(previousDb, nextDb)
  }

  if (previousImages !== nextImages) {
    await moveDirectoryContents(previousImages, nextImages)
    await rewriteImagePathPrefix(nextDb, previousImages, nextImages)
  }

  resetDatabaseConnection()
  bumpClipDataVersion()
}
