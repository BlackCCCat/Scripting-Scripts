import type { ClipItem, ClipKind, ClipPayload } from "../types"
import { insertIgnoredClipboardHash } from "../storage/database"
import { getFullClipContent } from "../storage/clip_repository"
import { imageContentHash } from "../storage/image_store"
import { hashString, isLikelyURL, normalizeClipContent } from "../utils/common"
import { readPasteboardPayload } from "./pasteboard_adapter"

function payloadContent(payload: ClipPayload): string {
  if (payload.kind === "image") return ""
  if (payload.kind === "url") return normalizeClipContent(payload.url ?? payload.text ?? "")
  return normalizeClipContent(payload.text ?? "")
}

function payloadCaptureKind(payload: ClipPayload, content: string): ClipKind {
  return payload.kind === "text" && isLikelyURL(content) ? "url" : payload.kind
}

function textCaptureHash(content: string): string {
  return hashString(`text:${normalizeClipContent(content)}`)
}

function payloadCaptureHash(payload: ClipPayload): string | undefined {
  const content = payloadContent(payload)
  const kind = payloadCaptureKind(payload, content)
  if (kind === "image") {
    const imageHash = payload.imageContentHash || (payload.image ? imageContentHash(payload.image) : undefined)
    return imageHash ? hashString(`image:${imageHash}`) : undefined
  }
  return textCaptureHash(content)
}

async function itemCaptureHash(item: ClipItem): Promise<string | undefined> {
  if (item.kind === "image") return item.contentHash
  return textCaptureHash(await getFullClipContent(item.id))
}

export async function ignoreCurrentClipboardIfMatchesDeletedItem(item: ClipItem): Promise<boolean> {
  try {
    const payload = await readPasteboardPayload({ includeSelfWrites: true })
    if (!payload || payload.sourceChangeCount == null) return false
    const currentHash = payloadCaptureHash(payload)
    const deletedHash = await itemCaptureHash(item)
    if (!currentHash || currentHash !== deletedHash) return false
    await insertIgnoredClipboardHash(currentHash, payload.sourceChangeCount, payload.kind)
    return true
  } catch {
    return false
  }
}
