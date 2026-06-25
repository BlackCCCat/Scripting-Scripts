import { loadSettings } from "./settings_store"

const APP_DIR_NAME = "CAIS"
const IMAGE_DIR_NAME = "images"

function joinPath(base: string, name: string): string {
  if (!base) return name
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`
}

function fileManager(): any {
  return (globalThis as any).FileManager
}

export function localAppRootDirectory(): string {
  const fm = (globalThis as any).FileManager
  const base =
    fm?.appGroupDocumentsDirectory ||
    fm?.documentsDirectory ||
    fm?.scriptsDirectory ||
    ""
  return joinPath(base, APP_DIR_NAME)
}

export function iCloudAppRootDirectory(): string {
  const fm = fileManager()
  return joinPath(fm?.iCloudDocumentsDirectory || "", APP_DIR_NAME)
}

export function isICloudAvailable(): boolean {
  const fm = fileManager()
  return Boolean(fm?.isiCloudEnabled && fm?.iCloudDocumentsDirectory)
}

function useICloudDatabase(): boolean {
  const settings = loadSettings()
  return Boolean(settings.iCloudSync && isICloudAvailable())
}

function useICloudImages(): boolean {
  const settings = loadSettings()
  return Boolean(settings.iCloudSync && settings.iCloudSyncImages && isICloudAvailable())
}

export function appRootDirectory(): string {
  return useICloudDatabase() ? iCloudAppRootDirectory() : localAppRootDirectory()
}

export function databasePath(): string {
  return joinPath(appRootDirectory(), "cais.sqlite")
}

export function localDatabasePath(): string {
  return joinPath(localAppRootDirectory(), "cais.sqlite")
}

export function iCloudDatabasePath(): string {
  return joinPath(iCloudAppRootDirectory(), "cais.sqlite")
}

export function imageDirectory(): string {
  return joinPath(useICloudImages() ? iCloudAppRootDirectory() : localAppRootDirectory(), IMAGE_DIR_NAME)
}

export function localImageDirectory(): string {
  return joinPath(localAppRootDirectory(), IMAGE_DIR_NAME)
}

export function iCloudImageDirectory(): string {
  return joinPath(iCloudAppRootDirectory(), IMAGE_DIR_NAME)
}

export function imagePathForId(id: string): string {
  return joinPath(imageDirectory(), `${id}.png`)
}

export function thumbnailPathForId(id: string): string {
  return joinPath(imageDirectory(), `${id}.thumb.jpg`)
}

export function thumbnailPathForImagePath(path?: string | null): string | undefined {
  if (!path) return undefined
  const slashIndex = path.lastIndexOf("/")
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : ""
  const fileName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path
  const baseName = fileName.replace(/\.[^.]+$/, "")
  return `${directory}${baseName}.thumb.jpg`
}

export async function ensureAppDirectories(): Promise<void> {
  const fm = (globalThis as any).FileManager
  if (!fm) return
  const root = appRootDirectory()
  const images = imageDirectory()
  if (typeof fm.exists === "function" && typeof fm.createDirectory === "function") {
    if (!(await fm.exists(root))) await fm.createDirectory(root, true)
    if (!(await fm.exists(images))) await fm.createDirectory(images, true)
    return
  }
  if (typeof fm.existsSync === "function" && typeof fm.createDirectorySync === "function") {
    if (!fm.existsSync(root)) fm.createDirectorySync(root, true)
    if (!fm.existsSync(images)) fm.createDirectorySync(images, true)
  }
}
