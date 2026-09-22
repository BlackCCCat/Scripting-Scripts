import {
  ensureAppDirectories,
  imagePathForId,
  listPreviewPathForId,
  listPreviewPathForImagePath,
  thumbnailPathForId,
  thumbnailPathForImagePath,
} from "./paths"
import { hashString } from "../utils/common"

const THUMBNAIL_SIZE = 220
const THUMBNAIL_QUALITY = 0.68
const LIST_PREVIEW_SIZE = 1024
const LIST_PREVIEW_QUALITY = 0.82
const previewPathCache = new Map<string, string>()
const listPreviewPathCache = new Map<string, string>()

function imageData(image: UIImage): Data | null {
  const dataClass = (globalThis as any).Data
  if (!dataClass || !image) return null
  if (typeof image.toPNGData === "function") return image.toPNGData()
  if (typeof image.toJPEGData === "function") return image.toJPEGData(0.9)
  return typeof dataClass.fromPNG === "function"
    ? dataClass.fromPNG(image)
    : typeof dataClass.fromJPEG === "function"
      ? dataClass.fromJPEG(image, 0.9)
      : null
}

function jpegData(image: UIImage, quality: number): Data | null {
  const dataClass = (globalThis as any).Data
  if (typeof image.toJPEGData === "function") return image.toJPEGData(quality)
  return typeof dataClass?.fromJPEG === "function" ? dataClass.fromJPEG(image, quality) : imageData(image)
}

async function writeData(path: string, data: Data): Promise<boolean> {
  const fm = (globalThis as any).FileManager
  if (!fm) return false
  if (typeof fm.writeAsData === "function") {
    await fm.writeAsData(path, data)
    return true
  }
  if (typeof fm.writeAsBytes === "function") {
    const bytes = typeof data.toUint8Array === "function"
      ? data.toUint8Array()
      : typeof data.getBytes === "function"
        ? data.getBytes()
        : null
    if (!bytes) return false
    await fm.writeAsBytes(path, bytes)
    return true
  }
  return false
}

function imageThumbnail(image: UIImage, size: number): UIImage | null {
  if (typeof image.preparingThumbnail === "function") {
    return image.preparingThumbnail({ width: size, height: size })
  }
  if (typeof image.renderedIn === "function") {
    return image.renderedIn({ width: size, height: size })
  }
  return null
}

export function imageContentHash(image: UIImage): string | undefined {
  const data = imageData(image)
  if (!data) return undefined
  try {
    return hashString(data.toBase64String())
  } catch {
    const bytes = typeof data.toUint8Array === "function" ? data.toUint8Array() : null
    return bytes ? hashString(Array.from(bytes).join(",")) : undefined
  }
}

export async function saveImageForClip(id: string, image: UIImage): Promise<string | undefined> {
  const fm = (globalThis as any).FileManager
  if (!fm || !image) return undefined
  await ensureAppDirectories()
  const path = imagePathForId(id)
  const data = imageData(image)
  if (!data) return undefined
  if (!(await writeData(path, data))) return undefined
  const listPreview = imageThumbnail(image, LIST_PREVIEW_SIZE)
  const listPreviewData = listPreview ? jpegData(listPreview, LIST_PREVIEW_QUALITY) : null
  if (listPreviewData) {
    try { await writeData(listPreviewPathForId(id), listPreviewData) } catch {}
  }
  const thumb = imageThumbnail(listPreview ?? image, THUMBNAIL_SIZE)
  const thumbData = thumb ? jpegData(thumb, THUMBNAIL_QUALITY) : null
  if (thumbData) {
    try { await writeData(thumbnailPathForId(id), thumbData) } catch {}
  }
  return path
}

export async function removeImage(path?: string | null): Promise<void> {
  if (!path) return
  previewPathCache.delete(path)
  listPreviewPathCache.delete(path)
  const fm = (globalThis as any).FileManager
  const paths = [path, thumbnailPathForImagePath(path), listPreviewPathForImagePath(path)].filter(Boolean) as string[]
  try {
    for (const filePath of paths) {
      if (typeof fm?.exists === "function" && await fm.exists(filePath)) {
        await fm.remove(filePath)
      } else if (typeof fm?.existsSync === "function" && fm.existsSync(filePath)) {
        fm.removeSync(filePath)
      }
    }
  } catch {
  }
}

export function imagePreviewPath(path?: string | null): string | undefined {
  if (!path) return undefined
  const cached = previewPathCache.get(path)
  if (cached) return cached
  const thumb = thumbnailPathForImagePath(path)
  const fm = (globalThis as any).FileManager
  try {
    if (thumb && typeof fm?.existsSync === "function" && fm.existsSync(thumb)) {
      previewPathCache.set(path, thumb)
      return thumb
    }
  } catch {
  }
  previewPathCache.set(path, path)
  return path
}

export function imageListPreviewPath(path?: string | null): string | undefined {
  if (!path) return undefined
  const cached = listPreviewPathCache.get(path)
  if (cached) return cached
  const preview = listPreviewPathForImagePath(path)
  const fm = (globalThis as any).FileManager
  try {
    if (preview && typeof fm?.existsSync === "function" && fm.existsSync(preview)) {
      listPreviewPathCache.set(path, preview)
      return preview
    }
  } catch {
  }
  return path
}
