import {
  createThumbnail,
  ensurePackDirectory,
  ensurePreviewDirectory,
  ensureThumbnailDirectory,
  previewGifPath,
  previewLocalPath,
  stickerGifPath,
  stickerLocalPath,
  thumbnailLocalPath,
} from "./storage"
import { convertWebmToGif } from "./gifConverter"
import type { ImportProgress, PreviewSticker, StickerKind, StickerPack, StickerPackPreview } from "./types"

const STATIC_PREVIEW_CONCURRENCY = 12
const VIDEO_PREVIEW_CONCURRENCY = 2
const DOWNLOAD_CONCURRENCY = 10

type TelegramResponse<T> = {
  ok: boolean
  result?: T
  description?: string
}

type TelegramFile = {
  file_path?: string
}

type TelegramSticker = {
  file_id: string
  file_unique_id: string
  width?: number
  height?: number
  is_animated?: boolean
  is_video?: boolean
  emoji?: string
}

type TelegramStickerSet = {
  name: string
  title: string
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
  includeDynamic = false,
): Promise<StickerPackPreview> {
  const name = extractStickerSetName(input)
  if (!name) throw new Error("请输入 Telegram 贴纸链接或贴纸包短名称")

  onProgress?.({ current: 0, total: 0, message: "正在读取贴纸包信息" })
  const set = await callTelegram<TelegramStickerSet>(botToken, "getStickerSet", { name })
  await ensurePreviewDirectory(set.name)

  const candidates = set.stickers
    .map((sticker, index) => ({ sticker, index }))
    .filter(({ sticker }) => (
      isStaticStickerCandidate(sticker) || (includeDynamic && isVideoStickerCandidate(sticker))
    ))
  const staticCandidates = candidates.filter(({ sticker }) => isStaticStickerCandidate(sticker))
  const videoCandidates = candidates.filter(({ sticker }) => isVideoStickerCandidate(sticker))
  let completed = 0

  const prepareSticker = async ({ sticker, index }: { sticker: TelegramSticker; index: number }) => {
    const previewSticker = await buildPreviewSticker(botToken, set.name, sticker)
    completed += 1
    onProgress?.({
      current: completed,
      total: candidates.length,
      message: `正在准备贴纸预览 ${completed}/${candidates.length}`,
    })
    return { index, sticker: previewSticker }
  }

  const [staticStickers, videoStickers] = await Promise.all([
    mapWithConcurrency(staticCandidates, STATIC_PREVIEW_CONCURRENCY, prepareSticker),
    mapWithConcurrency(videoCandidates, VIDEO_PREVIEW_CONCURRENCY, prepareSticker),
  ])
  const stickers = [...staticStickers, ...videoStickers]
    .sort((left, right) => left.index - right.index)
    .map(({ sticker }) => sticker)

  return {
    name: set.name,
    title: set.title,
    sourceLink: input.trim(),
    stickers,
  }
}

export async function downloadStickerSelection(
  botToken: string,
  preview: StickerPackPreview,
  selectedIds: string[],
  onProgress?: (progress: ImportProgress) => void,
  includeDynamic = false,
): Promise<StickerPack> {
  await ensurePackDirectory(preview.name)
  await ensureThumbnailDirectory(preview.name)

  const selectedIdSet = new Set(selectedIds)
  const selected = preview.stickers.filter((sticker) => (
    selectedIdSet.has(sticker.id)
    && (sticker.kind === "static" || (includeDynamic && sticker.kind === "video"))
  ))
  const total = selected.length
  let completed = 0
  const stickers = await mapWithConcurrency(selected, DOWNLOAD_CONCURRENCY, async (sticker) => {
    const remotePath = sticker.remotePath ?? (await callTelegram<TelegramFile>(botToken, "getFile", {
      file_id: sticker.fileId,
    })).file_path

    let localPath = sticker.localPath
    let fileName = sticker.fileName
    let gifPath: string | undefined

    if (sticker.kind === "video") {
      gifPath = stickerGifPath(preview.name, sticker.fileUniqueId)
      if (!(await FileManager.exists(gifPath))) {
        if (sticker.gifPath && await FileManager.exists(sticker.gifPath)) {
          await FileManager.copyFile(sticker.gifPath, gifPath)
        } else {
          if (!remotePath) throw new Error(`无法获取动态贴纸：${sticker.emoji || sticker.fileUniqueId}`)
          if (!(await FileManager.exists(localPath))) {
            await downloadTelegramFile(botToken, remotePath, localPath)
          }
          onProgress?.({
            current: completed,
            total,
            message: `正在转换动态贴纸 ${completed + 1}/${total}`,
          })
          await convertWebmToGif(localPath, gifPath)
        }
      }
      try {
        if (localPath !== gifPath && await FileManager.exists(localPath)) await FileManager.remove(localPath)
      } catch {}
      localPath = gifPath
      fileName = `${sticker.fileUniqueId}.gif`
    } else if (!(await FileManager.exists(localPath))) {
      if (sticker.previewPath && sticker.previewIsOriginal && await FileManager.exists(sticker.previewPath)) {
        await FileManager.copyFile(sticker.previewPath, localPath)
      } else if (remotePath) {
        await downloadTelegramFile(botToken, remotePath, localPath)
      }
    }

    const thumbnailSource = sticker.previewPath && await FileManager.exists(sticker.previewPath)
      ? sticker.previewPath
      : localPath
    const thumbnailPath = await createThumbnail(
      thumbnailSource,
      thumbnailLocalPath(preview.name, sticker.fileUniqueId),
    )

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
      fileName,
      localPath,
      thumbnailPath,
      gifPath,
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
  const kind = stickerKind(sticker, extension)
  const localPath = stickerLocalPath(setName, sticker.file_unique_id, extension)
  const previewPath = kind === "static"
    ? await cacheStaticPreview(botToken, setName, sticker.file_unique_id, remotePath, extension)
    : undefined
  const animatedPreviewPath = kind === "video" && remotePath
    ? await buildVideoPreview(botToken, setName, sticker.file_unique_id, remotePath, extension)
    : undefined

  return {
    id: sticker.file_unique_id,
    fileId: sticker.file_id,
    fileUniqueId: sticker.file_unique_id,
    emoji: sticker.emoji ?? "",
    kind,
    width: sticker.width,
    height: sticker.height,
    fileName: `${sticker.file_unique_id}.${extension}`,
    localPath,
    gifPath: animatedPreviewPath,
    remotePath,
    previewPath: animatedPreviewPath ?? previewPath,
    previewIsOriginal: !!previewPath,
  }
}

async function buildVideoPreview(
  botToken: string,
  setName: string,
  uniqueId: string,
  remotePath: string,
  extension: string,
): Promise<string> {
  const gifPath = previewGifPath(setName, uniqueId)
  if (await FileManager.exists(gifPath)) return gifPath
  const downloadedGifPath = stickerGifPath(setName, uniqueId)
  if (await FileManager.exists(downloadedGifPath)) return downloadedGifPath

  const sourcePath = previewLocalPath(setName, uniqueId, extension)
  if (!(await FileManager.exists(sourcePath))) {
    await downloadTelegramFile(botToken, remotePath, sourcePath)
  }
  try {
    await convertWebmToGif(sourcePath, gifPath)
  } finally {
    try {
      if (await FileManager.exists(sourcePath)) await FileManager.remove(sourcePath)
    } catch {}
  }
  return gifPath
}

async function cacheStaticPreview(
  botToken: string,
  setName: string,
  uniqueId: string,
  remotePath: string | undefined,
  extension: string,
): Promise<string | undefined> {
  const downloadedPath = stickerLocalPath(setName, uniqueId, extension)
  if (await FileManager.exists(downloadedPath)) {
    return downloadedPath
  }
  if (!remotePath) return undefined

  const localPath = previewLocalPath(setName, uniqueId, extension)
  if (!(await FileManager.exists(localPath))) {
    await downloadTelegramFile(botToken, remotePath, localPath)
  }
  return localPath
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

function isVideoStickerCandidate(sticker: TelegramSticker): boolean {
  return !!sticker.is_video
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
