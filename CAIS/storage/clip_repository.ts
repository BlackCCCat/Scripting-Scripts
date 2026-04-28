import type { CaptureResult, ClipGroup, ClipItem, ClipListScope, ClipPayload, CaisSettings } from "../types"
import { clipTitle, hashString, isLikelyURL, makeId, normalizeClipContent, normalizeText } from "../utils/common"
import { deleteAllClips, deleteClip, deleteFavoriteClips, findClipByHash, findTextClipsByContent, insertClip, listClipGroups, listClips, listImagePaths, trimActiveClips, updateClipContent, updateClipState, updateClipTitle as updateClipTitleRow, getFullClipContent } from "./database"
import { imageContentHash, removeImage, saveImageForClip } from "./image_store"
import { bumpClipDataVersion } from "./change_signal"

function payloadContent(payload: ClipPayload): string {
  if (payload.kind === "image") return `image:${payload.sourceChangeCount ?? Date.now()}`
  if (payload.kind === "url") return normalizeClipContent(payload.url ?? payload.text ?? "")
  return normalizeClipContent(payload.text ?? "")
}

function shouldCapture(payload: ClipPayload, settings: CaisSettings): boolean {
  if (payload.kind === "image") return settings.captureImages
  return settings.captureText
}

export async function addClipFromPayload(payload: ClipPayload, settings: CaisSettings): Promise<CaptureResult> {
  const content = payloadContent(payload)
  if (!content.trim()) return { status: "skipped", reason: "剪贴板为空" }
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
    : hashString(`text:${content}`)
  const textMatches = kind === "image" ? [] : await findTextClipsByContent(content)
  const existing = kind === "image"
    ? await findClipByHash(contentHash, kind)
    : textMatches[0] ?? await findClipByHash(contentHash)
  const now = Date.now()
  if (existing) {
    let changed = false
    for (const duplicate of textMatches.filter((match) => match.id !== existing.id)) {
      await deleteClip(duplicate.id)
      changed = true
    }
    if (settings.duplicatePolicy === "skip") {
      if (changed) bumpClipDataVersion()
      return { status: "skipped", reason: "重复内容已存在" }
    }
    await updateClipState(existing.id, { updatedAt: now })
    await trimActiveClips(settings.maxItems)
    bumpClipDataVersion()
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
  bumpClipDataVersion()
  return { status: "created", item }
}

export async function getClips(search = "", limit = 120, scope?: ClipListScope): Promise<ClipItem[]> {
  return listClips({ search, limit, scope })
}

export async function getClipGroups(scope: ClipListScope, search = "", limit = 120, offset = 0): Promise<ClipGroup[]> {
  return listClipGroups({ scope, search, limit, offset })
}

export async function markCopied(item: ClipItem): Promise<void> {
  const now = Date.now()
  await updateClipState(item.id, { updatedAt: now, lastCopiedAt: now })
  bumpClipDataVersion()
}

export async function togglePinned(item: ClipItem): Promise<void> {
  await updateClipState(item.id, { pinned: !item.pinned, updatedAt: Date.now() })
  bumpClipDataVersion()
}

export async function toggleFavorite(item: ClipItem): Promise<void> {
  await updateClipState(item.id, { favorite: !item.favorite })
  bumpClipDataVersion()
}

export async function softDeleteClip(item: ClipItem): Promise<void> {
  await removeImage(item.imagePath)
  await deleteClip(item.id)
  bumpClipDataVersion()
}

export async function clearAllClips(): Promise<void> {
  const imagePaths = await listImagePaths()
  await deleteAllClips()
  for (const path of imagePaths) await removeImage(path)
  bumpClipDataVersion()
}

export async function clearFavoriteClips(): Promise<void> {
  const imagePaths = await listImagePaths({ favoritesOnly: true })
  await deleteFavoriteClips()
  for (const path of imagePaths) await removeImage(path)
  bumpClipDataVersion()
}

export async function editClipContent(item: ClipItem, value: string): Promise<ClipItem> {
  const content = normalizeClipContent(value)
  if (!content.trim()) throw new Error("内容不能为空")
  const kind = item.kind === "image" ? "text" : isLikelyURL(content) ? "url" : "text"
  const next: ClipItem = {
    ...item,
    kind,
    title: clipTitle(kind, content),
    content,
    contentHash: hashString(`text:${content}`),
    updatedAt: Date.now(),
    imagePath: undefined,
  }
  await updateClipContent(next)
  bumpClipDataVersion()
  return next
}

export async function updateClipTitle(item: ClipItem, value: string): Promise<ClipItem> {
  const title = normalizeText(value) || clipTitle(item.kind, item.content)
  await updateClipTitleRow(item.id, title)
  bumpClipDataVersion()
  return { ...item, title }
}

export async function addFavoriteFromInput(title: string, content: string): Promise<ClipItem> {
  const fixedContent = normalizeClipContent(content)
  if (!fixedContent.trim()) throw new Error("内容不能为空")
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
  bumpClipDataVersion()
  return item
}

export { getFullClipContent }
