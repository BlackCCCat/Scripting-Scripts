import type { CaptureResult, ClipItem, ClipPayload, CaisSettings } from "../types"
import { clipTitle, hashString, isLikelyURL, makeId, normalizeText } from "../utils/common"
import { deleteAllClips, deleteClip, deleteFavoriteClips, findClipByHash, insertClip, listClips, listImagePaths, purgeOldDeleted, trimActiveClips, updateClipContent, updateClipState, updateClipTitle as updateClipTitleRow, getFullClipContent } from "./database"
import { imageContentHash, removeImage, saveImageForClip } from "./image_store"

function payloadContent(payload: ClipPayload): string {
  if (payload.kind === "image") return `image:${payload.sourceChangeCount ?? Date.now()}`
  if (payload.kind === "url") return normalizeText(payload.url ?? payload.text ?? "")
  return normalizeText(payload.text ?? "")
}

function shouldCapture(payload: ClipPayload, settings: CaisSettings): boolean {
  if (payload.kind === "image") return settings.captureImages
  return settings.captureText
}

export async function addClipFromPayload(payload: ClipPayload, settings: CaisSettings): Promise<CaptureResult> {
  const content = payloadContent(payload)
  if (!content) return { status: "skipped", reason: "剪贴板为空" }
  const kind = payload.kind === "text" && isLikelyURL(content) ? "url" : payload.kind
  if (!shouldCapture({ ...payload, kind }, settings)) {
    return { status: "skipped", reason: "当前类型未开启采集" }
  }
  let imageHash: string | undefined
  let image: UIImage | undefined
  if (kind === "image") {
    image = payload.image
    if (!image) return { status: "skipped", reason: "图片内容不可读取" }
    imageHash = imageContentHash(image)
    if (!imageHash) return { status: "skipped", reason: "图片内容不可读取" }
  }
  const contentHash = kind === "image"
    ? hashString(`${kind}:${imageHash}`)
    : hashString(`${kind}:${content}`)
  const existing = await findClipByHash(contentHash, kind)
  const now = Date.now()
  if (existing) {
    if (settings.duplicatePolicy === "skip") {
      return { status: "skipped", reason: "重复内容已存在" }
    }
    await updateClipState(existing.id, { updatedAt: now })
    await trimActiveClips(settings.maxItems)
    return { status: "updated", item: { ...existing, updatedAt: now } }
  }

  const id = makeId()
  let imagePath: string | undefined
  if (kind === "image") {
    if (!image) return { status: "skipped", reason: "图片内容不可读取" }
    imagePath = await saveImageForClip(id, image)
    if (!imagePath) return { status: "skipped", reason: "图片保存失败" }
  }
  const item: ClipItem = {
    id,
    kind,
    title: clipTitle(kind, content),
    content,
    contentHash,
    imagePath,
    sourceChangeCount: payload.sourceChangeCount,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    favorite: false,
    manualFavorite: false,
    deletedAt: null,
  }
  await insertClip(item)
  await trimActiveClips(settings.maxItems)
  return { status: "created", item }
}

export async function getClips(search = "", limit = 120): Promise<ClipItem[]> {
  return listClips({ search, limit })
}

export async function markCopied(item: ClipItem): Promise<void> {
  const now = Date.now()
  await updateClipState(item.id, { updatedAt: now, lastCopiedAt: now })
}

export async function togglePinned(item: ClipItem): Promise<void> {
  await updateClipState(item.id, { pinned: !item.pinned, updatedAt: Date.now() })
}

export async function toggleFavorite(item: ClipItem): Promise<void> {
  await updateClipState(item.id, { favorite: !item.favorite })
}

export async function softDeleteClip(item: ClipItem): Promise<void> {
  await removeImage(item.imagePath)
  await deleteClip(item.id)
}

export async function clearAllClips(): Promise<void> {
  const imagePaths = await listImagePaths()
  await deleteAllClips()
  for (const path of imagePaths) await removeImage(path)
}

export async function clearFavoriteClips(): Promise<void> {
  const imagePaths = await listImagePaths({ favoritesOnly: true })
  await deleteFavoriteClips()
  for (const path of imagePaths) await removeImage(path)
}

export async function editClipContent(item: ClipItem, value: string): Promise<ClipItem> {
  const content = normalizeText(value)
  if (!content) throw new Error("内容不能为空")
  const kind = item.kind === "image" ? "text" : isLikelyURL(content) ? "url" : "text"
  const next: ClipItem = {
    ...item,
    kind,
    title: clipTitle(kind, content),
    content,
    contentHash: hashString(`${kind}:${content}`),
    updatedAt: Date.now(),
    imagePath: undefined,
  }
  await updateClipContent(next)
  return next
}

export async function updateClipTitle(item: ClipItem, value: string): Promise<ClipItem> {
  const title = normalizeText(value) || clipTitle(item.kind, item.content)
  await updateClipTitleRow(item.id, title)
  return { ...item, title }
}

export async function cleanupDeleted(settings: CaisSettings): Promise<void> {
  const before = Date.now() - settings.keepDeletedDays * 24 * 60 * 60 * 1000
  await purgeOldDeleted(before)
}

export async function addFavoriteFromInput(title: string, content: string): Promise<ClipItem> {
  const fixedContent = normalizeText(content)
  if (!fixedContent) throw new Error("内容不能为空")
  const kind = isLikelyURL(fixedContent) ? "url" : "text"
  const now = Date.now()
  const item: ClipItem = {
    id: makeId("phrase"),
    kind,
    title: title.trim() || clipTitle(kind, fixedContent),
    content: fixedContent,
    contentHash: hashString(`manual:${kind}:${fixedContent}`),
    sourceChangeCount: 0,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    favorite: true,
    manualFavorite: true,
    deletedAt: null,
  }
  await insertClip(item)
  return item
}

export { getFullClipContent }
