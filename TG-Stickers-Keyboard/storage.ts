import { Path } from "scripting"
import type { CachedSticker, StickerPack } from "./types"
import { readPrivateStorage, STORAGE_KEYS, writePrivateStorage } from "./privateStorage"

const SCRIPT_NAME = "TG Stickers Keyboard"
const ROOT_DIR = `${FileManager.appGroupDocumentsDirectory}/${SCRIPT_NAME}`
const STICKERS_DIR = `${ROOT_DIR}/stickers`
const PREVIEWS_DIR = `${ROOT_DIR}/previews`
const THUMBNAILS_DIR = `${ROOT_DIR}/thumbnails`
const LEGACY_GIFS_DIR = `${ROOT_DIR}/gifs`
const RECENT_LIMIT = 10
const STATIC_STICKER_EXTENSIONS = new Set([".webp", ".png", ".jpg", ".jpeg"])

export function loadBotToken(): string {
  return readPrivateStorage<string>(STORAGE_KEYS.botToken) ?? ""
}

export function saveBotToken(token: string) {
  writePrivateStorage(STORAGE_KEYS.botToken, token.trim())
}

export function loadTargetKeyboardScript(): string {
  return readPrivateStorage<string>(STORAGE_KEYS.targetScript) ?? ""
}

export function saveTargetKeyboardScript(scriptName: string) {
  writePrivateStorage(STORAGE_KEYS.targetScript, scriptName.trim())
}

export function loadSoundEnabled(): boolean {
  return readPrivateStorage<boolean>(STORAGE_KEYS.soundEnabled) ?? true
}

export function saveSoundEnabled(enabled: boolean) {
  writePrivateStorage(STORAGE_KEYS.soundEnabled, enabled)
}

export function loadDynamicStickersEnabled(): boolean {
  return readPrivateStorage<boolean>(STORAGE_KEYS.dynamicStickersEnabled) ?? false
}

export function saveDynamicStickersEnabled(enabled: boolean) {
  writePrivateStorage(STORAGE_KEYS.dynamicStickersEnabled, enabled)
}

export function loadPacks(): StickerPack[] {
  const storedPacks = readPrivateStorage<StickerPack[]>(STORAGE_KEYS.packs) ?? []
  const recoveredPacks = recoverPacksFromDisk(storedPacks)
  if (recoveredPacks.length !== storedPacks.length
    || recoveredPacks.some((pack, index) => pack.stickers.length !== storedPacks[index]?.stickers.length)) {
    savePacks(recoveredPacks)
  }
  return recoveredPacks
}

export function savePacks(packs: StickerPack[]) {
  writePrivateStorage(STORAGE_KEYS.packs, packs)
}

export function loadRecentStickers(): CachedSticker[] {
  const stickers = readPrivateStorage<CachedSticker[]>(STORAGE_KEYS.recentStickers) ?? []
  const existing = stickers.filter((sticker) => FileManager.existsSync(sticker.localPath))
  if (existing.length !== stickers.length) saveRecentStickers(existing)
  return existing.slice(0, RECENT_LIMIT)
}

export function saveRecentStickers(stickers: CachedSticker[]) {
  writePrivateStorage(STORAGE_KEYS.recentStickers, stickers.slice(0, RECENT_LIMIT))
}

export { migrateLegacySharedStorage } from "./privateStorage"

export function rememberRecentSticker(sticker: CachedSticker): CachedSticker[] {
  const next = [
    sticker,
    ...loadRecentStickers().filter((item) => item.id !== sticker.id),
  ].slice(0, RECENT_LIMIT)
  saveRecentStickers(next)
  return next
}

function recoverPacksFromDisk(storedPacks: StickerPack[]): StickerPack[] {
  try {
    return scanPacksFromDisk(storedPacks)
  } catch {
    return storedPacks
  }
}

function scanPacksFromDisk(storedPacks: StickerPack[]): StickerPack[] {
  if (!FileManager.existsSync(STICKERS_DIR)) return storedPacks

  const packs = [...storedPacks]
  const packIndexByDirectory = new Map(
    packs.map((pack, index) => [packDirectory(pack.name), index]),
  )

  for (const directory of FileManager.readDirectorySync(STICKERS_DIR)) {
    if (!FileManager.isDirectorySync(directory)) continue

    const packIndex = packIndexByDirectory.get(directory)
    const existingPack = packIndex == null ? undefined : packs[packIndex]
    const knownStickerIds = new Set(existingPack?.stickers.map((sticker) => sticker.id) ?? [])
    const recoveredStickers = FileManager.readDirectorySync(directory)
      .filter((path) => FileManager.isFileSync(path))
      .map((path) => recoverStickerFromFile(existingPack?.name ?? Path.basename(directory), path))
      .filter((sticker): sticker is CachedSticker => !!sticker && !knownStickerIds.has(sticker.id))

    if (recoveredStickers.length === 0) continue
    if (existingPack && packIndex != null) {
      packs[packIndex] = {
        ...existingPack,
        stickers: [...existingPack.stickers, ...recoveredStickers],
      }
      continue
    }

    const name = Path.basename(directory)
    packIndexByDirectory.set(directory, packs.length)
    packs.push({
      name,
      title: name,
      importedAt: Date.now(),
      sourceLink: "",
      stickers: recoveredStickers,
    })
  }
  return packs
}

function recoverStickerFromFile(packName: string, localPath: string): CachedSticker | null {
  const parsed = Path.parse(localPath)
  const extension = parsed.ext.toLowerCase()
  const kind = extension === ".gif"
    ? "video"
    : STATIC_STICKER_EXTENSIONS.has(extension)
      ? "static"
      : null
  if (!kind) return null

  const thumbnailPath = thumbnailLocalPath(packName, parsed.name)
  return {
    id: parsed.name,
    fileId: "",
    fileUniqueId: parsed.name,
    emoji: "",
    kind,
    fileName: parsed.base,
    localPath,
    thumbnailPath: FileManager.existsSync(thumbnailPath) ? thumbnailPath : undefined,
    gifPath: kind === "video" ? localPath : undefined,
  }
}

export function stickersDirectory(): string {
  return STICKERS_DIR
}

export function previewDirectory(name: string): string {
  return `${PREVIEWS_DIR}/${sanitizePathComponent(name)}`
}

export function thumbnailDirectory(name: string): string {
  return `${THUMBNAILS_DIR}/${sanitizePathComponent(name)}`
}

function legacyGifDirectory(name: string): string {
  return `${LEGACY_GIFS_DIR}/${sanitizePathComponent(name)}`
}

export function packDirectory(name: string): string {
  return `${STICKERS_DIR}/${sanitizePathComponent(name)}`
}

export async function removePackDirectories(name: string) {
  for (const directory of [packDirectory(name), previewDirectory(name), thumbnailDirectory(name), legacyGifDirectory(name)]) {
    try {
      if (await FileManager.exists(directory)) await removeDirectory(directory)
    } catch {}
  }
}

async function removeDirectory(directory: string) {
  try {
    await FileManager.remove(directory)
    return
  } catch {}

  try {
    const entries = await FileManager.readDirectory(directory, true)
    for (const entry of entries.reverse()) {
      try {
        await FileManager.remove(entry)
      } catch {}
    }
    if (await FileManager.exists(directory)) await FileManager.remove(directory)
  } catch {}
}

export function stickerLocalPath(setName: string, uniqueId: string, extension: string): string {
  const ext = sanitizeExtension(extension)
  return `${packDirectory(setName)}/${sanitizePathComponent(uniqueId)}.${ext}`
}

export function stickerGifPath(setName: string, uniqueId: string): string {
  return `${packDirectory(setName)}/${sanitizePathComponent(uniqueId)}.gif`
}

export async function ensurePackDirectory(name: string) {
  await FileManager.createDirectory(packDirectory(name), true)
}

export async function ensurePreviewDirectory(name: string) {
  await FileManager.createDirectory(previewDirectory(name), true)
}

export async function ensureThumbnailDirectory(name: string) {
  await FileManager.createDirectory(thumbnailDirectory(name), true)
}

export function previewLocalPath(setName: string, uniqueId: string, extension: string): string {
  const ext = sanitizeExtension(extension)
  return `${previewDirectory(setName)}/${sanitizePathComponent(uniqueId)}.${ext}`
}

export function previewGifPath(setName: string, uniqueId: string): string {
  return `${previewDirectory(setName)}/${sanitizePathComponent(uniqueId)}.gif`
}

export function thumbnailLocalPath(setName: string, uniqueId: string): string {
  return `${thumbnailDirectory(setName)}/${sanitizePathComponent(uniqueId)}.png`
}

export function imageForSticker(localPath: string): UIImage | null {
  if (!FileManager.existsSync(localPath)) return null
  return UIImage.fromFile(localPath)
}

export async function createThumbnail(sourcePath: string, targetPath: string, size = 220): Promise<string | undefined> {
  if (await FileManager.exists(targetPath)) return targetPath
  const image = imageForSticker(sourcePath)
  const thumbnail = image?.preparingThumbnail({ width: size, height: size })
  const data = thumbnail ? Data.fromPNG(thumbnail) : null
  if (!data) return undefined
  await FileManager.writeAsData(targetPath, data)
  return targetPath
}

function sanitizePathComponent(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "pack"
}

function sanitizeExtension(value: string): string {
  const clean = value.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase()
  return clean || "bin"
}
