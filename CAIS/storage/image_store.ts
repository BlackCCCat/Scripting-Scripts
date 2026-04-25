import { ensureAppDirectories, imagePathForId } from "./paths"
import { hashString } from "../utils/common"

function imageData(image: UIImage): Data | null {
  const dataClass = (globalThis as any).Data
  if (!dataClass || !image) return null
  return typeof dataClass.fromPNG === "function"
    ? dataClass.fromPNG(image)
    : typeof dataClass.fromJPEG === "function"
      ? dataClass.fromJPEG(image, 0.9)
      : null
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
  if (typeof fm.writeAsData === "function") {
    await fm.writeAsData(path, data)
  } else if (typeof fm.writeAsBytes === "function") {
    const bytes = typeof data.toUint8Array === "function"
      ? data.toUint8Array()
      : typeof data.getBytes === "function"
        ? data.getBytes()
        : null
    if (!bytes) return undefined
    await fm.writeAsBytes(path, bytes)
  } else {
    return undefined
  }
  return path
}

export async function removeImage(path?: string | null): Promise<void> {
  if (!path) return
  const fm = (globalThis as any).FileManager
  try {
    if (typeof fm?.exists === "function" && await fm.exists(path)) {
      await fm.remove(path)
    } else if (typeof fm?.existsSync === "function" && fm.existsSync(path)) {
      fm.removeSync(path)
    }
  } catch {
  }
}
