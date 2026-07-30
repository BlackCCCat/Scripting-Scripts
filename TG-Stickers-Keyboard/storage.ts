import type { CachedSticker, StickerPack } from "./types"

const PACKS_KEY = "tg-stickers-keyboard:packs:v1"
const TOKEN_KEY = "tg-stickers-keyboard:bot-token:v1"
const TARGET_SCRIPT_KEY = "tg-stickers-keyboard:target-keyboard-script:v1"
const RECENT_STICKERS_KEY = "tg-stickers-keyboard:recent-stickers:v1"
const SOUND_ENABLED_KEY = "tg-stickers-keyboard:sound-enabled:v1"
const SCRIPT_NAME = "TG Stickers Keyboard"
const ROOT_DIR = `${FileManager.appGroupDocumentsDirectory}/${SCRIPT_NAME}`
const STICKERS_DIR = `${ROOT_DIR}/stickers`
const PREVIEWS_DIR = `${ROOT_DIR}/previews`
const THUMBNAILS_DIR = `${ROOT_DIR}/thumbnails`
const LEGACY_GIFS_DIR = `${ROOT_DIR}/gifs`
const RECENT_LIMIT = 10

export function loadBotToken(): string {
  return Storage.get<string>(TOKEN_KEY, { shared: true }) ?? ""
}

export function saveBotToken(token: string) {
  Storage.set(TOKEN_KEY, token.trim(), { shared: true })
}

export function loadTargetKeyboardScript(): string {
  return Storage.get<string>(TARGET_SCRIPT_KEY, { shared: true }) ?? ""
}

export function saveTargetKeyboardScript(scriptName: string) {
  Storage.set(TARGET_SCRIPT_KEY, scriptName.trim(), { shared: true })
}

export function loadSoundEnabled(): boolean {
  return Storage.get<boolean>(SOUND_ENABLED_KEY, { shared: true }) ?? true
}

export function saveSoundEnabled(enabled: boolean) {
  Storage.set(SOUND_ENABLED_KEY, enabled, { shared: true })
}

export function loadPacks(): StickerPack[] {
  return Storage.get<StickerPack[]>(PACKS_KEY, { shared: true }) ?? []
}

export function savePacks(packs: StickerPack[]) {
  Storage.set(PACKS_KEY, packs, { shared: true })
}

export function loadRecentStickers(): CachedSticker[] {
  const stickers = Storage.get<CachedSticker[]>(RECENT_STICKERS_KEY, { shared: true }) ?? []
  const existing = stickers.filter((sticker) => FileManager.existsSync(sticker.localPath))
  if (existing.length !== stickers.length) saveRecentStickers(existing)
  return existing.slice(0, RECENT_LIMIT)
}

export function saveRecentStickers(stickers: CachedSticker[]) {
  Storage.set(RECENT_STICKERS_KEY, stickers.slice(0, RECENT_LIMIT), { shared: true })
}

export function rememberRecentSticker(sticker: CachedSticker): CachedSticker[] {
  const next = [
    sticker,
    ...loadRecentStickers().filter((item) => item.id !== sticker.id),
  ].slice(0, RECENT_LIMIT)
  saveRecentStickers(next)
  return next
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
