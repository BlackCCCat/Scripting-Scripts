import { ensureAppDirectories, imagePathForId, thumbnailPathForId, thumbnailPathForImagePath } from "./paths"
import { hashString } from "../utils/common"

const THUMBNAIL_SIZE = 220
const THUMBNAIL_QUALITY = 0.68
const previewPathCache = new Map<string, string>()

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

function imageThumbnail(image: UIImage): UIImage | null {
  if (typeof image.preparingThumbnail === "function") {
    return image.preparingThumbnail({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE })
  }
  if (typeof image.renderedIn === "function") {
    return image.renderedIn({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE })
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
  const thumb = imageThumbnail(image)
  const thumbData = thumb ? jpegData(thumb, THUMBNAIL_QUALITY) : null
  if (thumbData) {
    try { await writeData(thumbnailPathForId(id), thumbData) } catch {}
  }
  return path
}

export async function removeImage(path?: string | null): Promise<void> {
  if (!path) return
  previewPathCache.delete(path)
  const fm = (globalThis as any).FileManager
  const paths = [path, thumbnailPathForImagePath(path)].filter(Boolean) as string[]
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
