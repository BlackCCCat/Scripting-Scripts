import type { ClipItem, ClipPayload } from "../types"
import { normalizeClipContent } from "../utils/common"

let lastSelfWriteText = ""
let lastSelfWriteAt = 0

function pasteboard(): any {
  return (globalThis as any).Pasteboard
}

async function pasteboardFlag(value: any): Promise<boolean> {
  try {
    return Boolean(typeof value === "function" ? await value() : await value)
  } catch {
    return false
  }
}

export async function currentChangeCount(): Promise<number> {
  const pb = pasteboard()
  const value = pb ? await pb.changeCount : 0
  return Number(value) || 0
}

export async function readPasteboardPayload(): Promise<ClipPayload | null> {
  const pb = pasteboard()
  if (!pb) return null
  const sourceChangeCount = await currentChangeCount()
  try {
    if (await pasteboardFlag(pb.hasImages)) {
      const image = typeof pb.getImage === "function"
        ? await pb.getImage()
        : null
      if (image) return { kind: "image", image, sourceChangeCount }
      const images = typeof pb.getImages === "function"
        ? await pb.getImages()
        : null
      const firstImage = Array.isArray(images) ? images[0] : null
      if (firstImage) return { kind: "image", image: firstImage, sourceChangeCount }
    }
  } catch {
  }

  try {
    if (await pasteboardFlag(pb.hasStrings) && typeof pb.getString === "function") {
      const text = normalizeClipContent(await pb.getString())
      if (!text.trim()) return null
      if (text === lastSelfWriteText && Date.now() - lastSelfWriteAt < 5000) {
        return null
      }
      return { kind: "text", text, sourceChangeCount }
    }
  } catch {
  }

  try {
    if (await pasteboardFlag(pb.hasURLs) && typeof pb.getURL === "function") {
      const url = normalizeClipContent(await pb.getURL())
      if (!url.trim()) return null
      if (url === lastSelfWriteText && Date.now() - lastSelfWriteAt < 5000) {
        return null
      }
      return { kind: "url", url, text: url, sourceChangeCount }
    }
  } catch {
  }

  return null
}

export async function writeClipToPasteboard(item: ClipItem, fullContent?: string): Promise<void> {
  const pb = pasteboard()
  if (!pb) throw new Error("Pasteboard 不可用")
  if (item.kind === "image" && item.imagePath) {
    const uiImage = (globalThis as any).UIImage
    if (typeof uiImage?.fromFile === "function" && typeof pb.setImage === "function") {
      const image = uiImage.fromFile(item.imagePath)
      if (image) {
        await pb.setImage(image)
        return
      }
    }
  }
  const textToWrite = fullContent ?? item.content
  lastSelfWriteText = textToWrite
  lastSelfWriteAt = Date.now()
  await pb.setString(textToWrite)
}

export async function writeTextToPasteboard(text: string): Promise<void> {
  const pb = pasteboard()
  if (!pb) throw new Error("Pasteboard 不可用")
  lastSelfWriteText = text
  lastSelfWriteAt = Date.now()
  await pb.setString(text)
}

export async function writeImageToPasteboard(image: UIImage): Promise<void> {
  const pb = pasteboard()
  if (!pb || typeof pb.setImage !== "function") throw new Error("Pasteboard 不可用")
  await pb.setImage(image)
}
