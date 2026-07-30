import {
  createThumbnail,
  ensurePackDirectory,
  ensurePreviewDirectory,
  ensureThumbnailDirectory,
  previewLocalPath,
  stickerLocalPath,
  thumbnailLocalPath,
} from "./storage"
import type { CachedSticker, ImportProgress, PreviewSticker, StickerKind, StickerPack, StickerPackPreview } from "./types"

type TelegramResponse<T> = {
  ok: boolean
  result?: T
  description?: string
}

type TelegramFile = {
  file_id: string
  file_unique_id: string
  file_size?: number
  file_path?: string
}

type TelegramPhotoSize = {
  file_id: string
  file_unique_id: string
  file_size?: number
  width?: number
  height?: number
}

type TelegramSticker = {
  file_id: string
  file_unique_id: string
  type?: string
  width?: number
  height?: number
  is_animated?: boolean
  is_video?: boolean
  emoji?: string
  thumbnail?: TelegramPhotoSize
}

type TelegramStickerSet = {
  name: string
  title: string
  sticker_type?: string
  stickers: TelegramSticker[]
}

export function extractStickerSetName(input: string): string {
  const value = input.trim()
  if (!value) return ""

  try {
    const url = new URL(value)
    if (url.protocol === "tg:") {
      return url.searchParams.get("set") ?? ""
    }

    const parts = url.pathname.split("/").filter(Boolean)
    const marker = parts.findIndex((part) => part === "addstickers" || part === "addemoji")
    if (marker >= 0 && parts[marker + 1]) return parts[marker + 1]
  } catch {
    // Bare set names are allowed.
  }

  return value.replace(/^@/, "")
}

export async function fetchStickerSetPreview(
  botToken: string,
  input: string,
  onProgress?: (progress: ImportProgress) => void,
): Promise<StickerPackPreview> {
  const name = extractStickerSetName(input)
  if (!name) throw new Error("请输入 Telegram 贴纸链接或贴纸包短名称")

  onProgress?.({ current: 0, total: 0, message: "正在读取贴纸包信息" })
  const set = await callTelegram<TelegramStickerSet>(botToken, "getStickerSet", { name })
  await ensurePreviewDirectory(set.name)
  await ensurePackDirectory(set.name)
  await ensureThumbnailDirectory(set.name)

  const staticCandidates = set.stickers.filter(isStaticStickerCandidate)
  const stickers = await mapWithConcurrency(staticCandidates, 8, async (sticker, index) => {
    onProgress?.({
      current: index + 1,
      total: staticCandidates.length,
      message: `正在准备静态贴纸预览 ${index + 1}/${staticCandidates.length}`,
    })
    return await buildPreviewSticker(botToken, set.name, sticker)
  })
  const staticStickers = stickers.filter((sticker) => sticker.kind === "static")

  return {
    name: set.name,
    title: set.title,
    sourceLink: input.trim(),
    stickers: staticStickers,
  }
}

export async function importStickerSet(
  botToken: string,
  input: string,
  onProgress?: (progress: ImportProgress) => void,
): Promise<StickerPack> {
  const preview = await fetchStickerSetPreview(botToken, input, onProgress)
  return await downloadStickerSelection(botToken, preview, preview.stickers.map((sticker) => sticker.id), onProgress)
}

export async function downloadStickerSelection(
  botToken: string,
  preview: StickerPackPreview,
  selectedIds: string[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<StickerPack> {
  await ensurePackDirectory(preview.name)
  await ensureThumbnailDirectory(preview.name)

  const selected = preview.stickers.filter((sticker) => selectedIds.includes(sticker.id) && sticker.kind === "static")
  const total = selected.length
  let completed = 0
  const stickers = await mapWithConcurrency(selected, 6, async (sticker) => {
    onProgress?.({
      current: completed,
      total,
      message: `正在下载 ${completed}/${total}`,
    })

    const remotePath = sticker.remotePath ?? (await callTelegram<TelegramFile>(botToken, "getFile", {
      file_id: sticker.fileId,
    })).file_path

    if (!(await FileManager.exists(sticker.localPath))) {
      if (sticker.previewPath && sticker.previewIsOriginal && await FileManager.exists(sticker.previewPath)) {
        await FileManager.copyFile(sticker.previewPath, sticker.localPath)
      } else if (remotePath) {
        await downloadTelegramFile(botToken, remotePath, sticker.localPath)
      }
    }

    completed += 1
    onProgress?.({
      current: completed,
      total,
      message: `正在下载 ${completed}/${total}`,
    })

    return {
      id: sticker.id,
      fileId: sticker.fileId,
      fileUniqueId: sticker.fileUniqueId,
      emoji: sticker.emoji,
      kind: sticker.kind,
      width: sticker.width,
      height: sticker.height,
      fileName: sticker.fileName,
      localPath: sticker.localPath,
      thumbnailPath: await createThumbnail(sticker.localPath, thumbnailLocalPath(preview.name, sticker.fileUniqueId)),
      remotePath,
    }
  })

  onProgress?.({ current: total, total, message: "导入完成" })
  return {
    name: preview.name,
    title: preview.title,
    importedAt: Date.now(),
    sourceLink: preview.sourceLink,
    stickers,
  }
}

async function callTelegram<T>(
  botToken: string,
  method: string,
  params: Record<string, string>,
): Promise<T> {
  const token = botToken.trim()
  if (!token) throw new Error("请先填写 Bot Token")

  const url = new URL(`https://api.telegram.org/bot${token}/${method}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))

  const response = await fetch(url.toString())
  const payload = await response.json() as TelegramResponse<T>
  if (!response.ok || !payload.ok || payload.result == null) {
    throw new Error(payload.description ?? `Telegram API 请求失败：${method}`)
  }
  return payload.result
}

async function downloadTelegramFile(botToken: string, remotePath: string, localPath: string) {
  const url = `https://api.telegram.org/file/bot${botToken.trim()}/${remotePath}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载失败：${remotePath}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  await FileManager.writeAsBytes(localPath, bytes)
}

async function buildPreviewSticker(
  botToken: string,
  setName: string,
  sticker: TelegramSticker,
): Promise<PreviewSticker> {
  const file = await callTelegram<TelegramFile>(botToken, "getFile", {
    file_id: sticker.file_id,
  })
  const remotePath = file.file_path
  const extension = extensionFromFilePath(remotePath)
  const localPath = stickerLocalPath(setName, sticker.file_unique_id, extension)
  const thumbnailPath = thumbnailLocalPath(setName, sticker.file_unique_id)
  const preview = await downloadPreviewImage(botToken, setName, sticker, remotePath, extension)

  return {
    id: sticker.file_unique_id,
    fileId: sticker.file_id,
    fileUniqueId: sticker.file_unique_id,
    emoji: sticker.emoji ?? "",
    kind: stickerKind(sticker, extension),
    width: sticker.width,
    height: sticker.height,
    fileName: `${sticker.file_unique_id}.${extension}`,
    localPath,
    thumbnailPath: preview.isOriginal && preview.path
      ? await createThumbnail(preview.path, thumbnailPath)
      : undefined,
    remotePath,
    previewPath: preview.path,
    previewIsOriginal: preview.isOriginal,
  }
}

async function downloadPreviewImage(
  botToken: string,
  setName: string,
  sticker: TelegramSticker,
  remotePath: string | undefined,
  stickerExtension: string,
): Promise<{ path?: string; isOriginal?: boolean }> {
  const thumb = sticker.thumbnail
  if (!thumb) {
    if (!remotePath || stickerKind(sticker, stickerExtension) !== "static") return {}
    const localPath = previewLocalPath(setName, sticker.file_unique_id, stickerExtension)
    if (!(await FileManager.exists(localPath))) {
      await downloadTelegramFile(botToken, remotePath, localPath)
    }
    return { path: localPath, isOriginal: true }
  }

  const file = await callTelegram<TelegramFile>(botToken, "getFile", {
    file_id: thumb.file_id,
  })
  if (!file.file_path) return {}

  const thumbExtension = extensionFromFilePath(file.file_path)
  const localPath = previewLocalPath(setName, thumb.file_unique_id, thumbExtension)
  if (!(await FileManager.exists(localPath))) {
    await downloadTelegramFile(botToken, file.file_path, localPath)
  }
  return { path: localPath, isOriginal: false }
}

function extensionFromFilePath(path?: string): string {
  const match = path?.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
  return match?.[1]?.toLowerCase() ?? "bin"
}

function stickerKind(sticker: TelegramSticker, extension: string): StickerKind {
  if (sticker.is_animated || extension === "tgs") return "animated"
  if (sticker.is_video || extension === "webm") return "video"
  if (["webp", "png", "jpg", "jpeg"].includes(extension)) return "static"
  return "unknown"
}

function isStaticStickerCandidate(sticker: TelegramSticker): boolean {
  return !sticker.is_animated && !sticker.is_video
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker))
  return results
}
