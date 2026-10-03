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

export function imageVisualFingerprint(image: UIImage): string | undefined {
  if (!image || image.width <= 0 || image.height <= 0 || typeof image.renderedIn !== "function") return undefined
  const small = image.renderedIn({ width: 17, height: 16 })
  const pixels = typeof small?.getPixelData === "function" ? small.getPixelData() : null
  if (!pixels || pixels.width < 17 || pixels.height < 16) return undefined
  const bytes = pixels.data.toUint8Array()
  if (!bytes || bytes.length < pixels.width * pixels.height * 4) return undefined
  const gray: number[] = []
  let red = 0, green = 0, blue = 0
  for (let y = 0; y < 16; y++) {
    const sourceY = Math.min(pixels.height - 1, Math.floor((y + 0.5) * pixels.height / 16))
    for (let x = 0; x < 17; x++) {
      const sourceX = Math.min(pixels.width - 1, Math.floor((x + 0.5) * pixels.width / 17))
      const offset = (sourceY * pixels.width + sourceX) * 4
      const alpha = bytes[offset + 3] / 255
      const r = bytes[offset] * alpha + 255 * (1 - alpha)
      const g = bytes[offset + 1] * alpha + 255 * (1 - alpha)
      const b = bytes[offset + 2] * alpha + 255 * (1 - alpha)
      red += r; green += g; blue += b
      gray.push(0.299 * r + 0.587 * g + 0.114 * b)
    }
  }
  let bits = ""
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      bits += gray[y * 17 + x] > gray[y * 17 + x + 1] ? "1" : "0"
    }
  }
  let hex = ""
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  const count = 17 * 16
  return `${image.width / image.height}:${Math.round(red / count)}:${Math.round(green / count)}:${Math.round(blue / count)}:${hex}`
}

export function imageVisualFingerprintMatches(a: string, b: string): boolean {
  const left = a.split(":")
  const right = b.split(":")
  if (left.length !== 5 || right.length !== 5 || left[4].length !== 64 || right[4].length !== 64) return false
  if (Math.abs(Number(left[0]) - Number(right[0])) > 0.01) return false
  if ([1, 2, 3].some((index) => Math.abs(Number(left[index]) - Number(right[index])) > 8)) return false
  let different = 0
  for (let i = 0; i < 64; i++) {
    let xor = parseInt(left[4][i], 16) ^ parseInt(right[4][i], 16)
    while (xor) { different += xor & 1; xor >>= 1 }
    if (different > 6) return false
  }
  return true
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
