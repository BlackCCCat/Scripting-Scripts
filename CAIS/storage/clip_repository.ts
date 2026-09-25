import type {
  CaptureResult,
  ClipboardClearRange,
  ClipGroup,
  ClipItem,
  ClipKind,
  ClipKindCountsByScope,
  ClipListScope,
  ClipPayload,
  CaisSettings,
  FavoriteFormat,
  FavoriteGroup,
  FavoriteGroupRuleType,
} from "../types"
import { clipTitle, hashString, isLikelyURL, makeId, normalizeClipContent, normalizeText } from "../utils/common"
import { favoriteDelimiterForItem, normalizeFavoriteDelimiter, parseFavoriteFields } from "../utils/favorite_fields"
import { makeRegex } from "../utils/custom_action"
import {
  countClipKindsByScope,
  countClipsByScope,
  deleteClipboardClipsByRange,
  deleteClip,
  deleteFavoriteClips,
  deleteFavoriteGroup as deleteFavoriteGroupRow,
  favoriteGroupTitleExists,
  findClipByHash,
  findClipById,
  findTextClipsByContent,
  getFullClipContent,
  insertClip,
  insertFavoriteGroup,
  listClipGroups,
  listClips,
  listFavoriteGroupDefinitions,
  listAutomaticFavoriteItems,
  listImagePaths,
  nextFavoriteGroupSortOrder,
  nextFavoriteItemOrder,
  reorderFavoriteGroups as reorderFavoriteGroupRows,
  replaceAutomaticFavoriteGroupAssignments,
  trimActiveClips,
  updateClipContent,
  updateClipState,
  updateClipTitle as updateClipTitleRow,
  updateFavoriteGroup as updateFavoriteGroupRow,
} from "./database"
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

function favoriteGroupMatches(group: FavoriteGroup, title: string, content: string): boolean {
  const source = `${title}\n${content}`
  if (group.ruleType === "regex") {
    return makeRegex(group.pattern).test(source)
  }
  const keyword = group.pattern.trim()
  return group.ignoreCase
    ? source.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())
    : source.includes(keyword)
}

async function resolveFavoriteGroupId(
  title: string,
  content: string,
  requestedGroupId?: string,
  requestedGroupManual = false,
): Promise<string | undefined> {
  const groups = await listFavoriteGroupDefinitions()
  if (requestedGroupManual && requestedGroupId && groups.some((group) => group.id === requestedGroupId)) {
    return requestedGroupId
  }
  return groups.find((group) => favoriteGroupMatches(group, title, content))?.id
}

async function reclassifyAutomaticFavorites(preferredGroupId?: string): Promise<number> {
  const definitions = await listFavoriteGroupDefinitions()
  const preferred = definitions.find((group) => group.id === preferredGroupId)
  const groups = preferred
    ? [preferred, ...definitions.filter((group) => group.id !== preferred.id)]
    : definitions
  const counters = new Map<string, number>()
  let preferredMatches = 0
  const assignments = (await listAutomaticFavoriteItems()).flatMap((item) => {
    const group = groups.find((candidate) => favoriteGroupMatches(candidate, item.title, item.content))
    const key = group?.id ?? ""
    const favoriteOrder = counters.get(key) ?? 0
    counters.set(key, favoriteOrder + 1)
    if (group?.id === preferredGroupId) preferredMatches += 1
    if (group?.id === item.favoriteGroupId && favoriteOrder === item.favoriteOrder) return []
    return [{ id: item.id, favoriteGroupId: group?.id, favoriteOrder }]
  })
  await replaceAutomaticFavoriteGroupAssignments(assignments)
  return preferredMatches
}

async function resolveDuplicate(
  existing: ClipItem,
  textMatches: ClipItem[],
  settings: CaisSettings,
): Promise<CaptureResult> {
  let changed = false
  for (const duplicate of textMatches.filter((match) => match.id !== existing.id)) {
    await deleteClip(duplicate.id)
    changed = true
  }
  if (settings.duplicatePolicy === "skip") {
    if (changed) bumpClipDataVersion()
    return { status: "skipped", reason: "重复内容已存在" }
  }
  const updatedAt = Date.now()
  await updateClipState(existing.id, { updatedAt })
  await trimActiveClips(settings.maxItems)
  bumpClipDataVersion()
  return { status: "updated", item: { ...existing, updatedAt } }
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
    imageHash = payload.imageContentHash || imageContentHash(image)
    if (!imageHash) return { status: "skipped", reason: "图片内容不可读取" }
  }
  const contentHash = kind === "image"
    ? hashString(`${kind}:${imageHash}`)
    : hashString(`text:${content}`)
  const textMatches = kind === "image" ? [] : await findTextClipsByContent(content)
  const existing = kind === "image"
    ? await findClipByHash(contentHash, kind)
    : textMatches[0] ?? null
  if (existing) {
    return resolveDuplicate(existing, textMatches, settings)
  }

  const now = Date.now()
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
  try {
    await insertClip(item)
  } catch (error) {
    const concurrentMatches = kind === "image" ? [] : await findTextClipsByContent(content)
    const concurrent = kind === "image"
      ? await findClipByHash(contentHash, kind)
      : concurrentMatches[0] ?? null
    if (!concurrent) throw error
    await removeImage(imagePath)
    return resolveDuplicate(concurrent, concurrentMatches, settings)
  }
  await trimActiveClips(settings.maxItems)
  bumpClipDataVersion()
  return { status: "created", item }
}

export async function getClips(search = "", limit = 120, scope?: ClipListScope): Promise<ClipItem[]> {
  return listClips({ search, limit, scope })
}

export async function getClipGroups(scope: ClipListScope, search = "", limit = 120, offset = 0, kind?: ClipKind): Promise<ClipGroup[]> {
  return listClipGroups({ scope, search, limit, offset, kind })
}

export async function getClipCounts(): Promise<Record<ClipListScope, number>> {
  return countClipsByScope()
}

export async function getClipKindCounts(): Promise<ClipKindCountsByScope> {
  return countClipKindsByScope()
}

export async function getClipById(id: string): Promise<ClipItem | null> {
  return findClipById(id)
}

export async function markCopied(item: ClipItem, changeSource?: unknown, copiedAt = Date.now()): Promise<void> {
  await updateClipState(item.id, { updatedAt: copiedAt, lastCopiedAt: copiedAt })
  bumpClipDataVersion(changeSource)
}

export async function togglePinned(item: ClipItem): Promise<void> {
  await updateClipState(item.id, item.favorite
    ? { pinned: !item.pinned }
    : { pinned: !item.pinned, updatedAt: Date.now() })
  bumpClipDataVersion()
}

export async function toggleFavorite(item: ClipItem): Promise<void> {
  if (item.favorite) {
    await updateClipState(item.id, {
      favorite: false,
      favoriteGroupId: null,
      favoriteGroupManual: false,
      favoriteOrder: null,
      favoriteUpdatedAt: null,
    })
  } else {
    const content = await getFullClipContent(item.id)
    const favoriteGroupId = await resolveFavoriteGroupId(item.title, content)
    const favoriteOrder = await nextFavoriteItemOrder(favoriteGroupId)
    const now = Date.now()
    await updateClipState(item.id, {
      favorite: true,
      updatedAt: now,
      favoriteGroupId: favoriteGroupId ?? null,
      favoriteGroupManual: false,
      favoriteOrder,
      favoriteUpdatedAt: now,
    })
  }
  bumpClipDataVersion()
}

export async function softDeleteClip(item: ClipItem): Promise<void> {
  await removeImage(item.imagePath)
  await deleteClip(item.id)
  bumpClipDataVersion()
}

export async function clearFavoriteClips(): Promise<void> {
  const imagePaths = await listImagePaths({ favoritesOnly: true })
  await deleteFavoriteClips()
  for (const path of imagePaths) await removeImage(path)
  bumpClipDataVersion()
}

export async function clearClipboardClipsByRange(range: ClipboardClearRange): Promise<void> {
  const imagePaths = await listImagePaths({ clipboardRange: range })
  await deleteClipboardClipsByRange(range)
  for (const path of imagePaths) await removeImage(path)
  bumpClipDataVersion()
}

export async function editClipContent(
  item: ClipItem,
  value: string,
  defaultFieldDelimiter?: string,
): Promise<ClipItem> {
  const content = normalizeClipContent(value)
  if (!content.trim()) throw new Error("内容不能为空")
  if (item.favoriteFormat === "fields") {
    const parsed = parseFavoriteFields(
      content,
      favoriteDelimiterForItem(item, defaultFieldDelimiter ?? ":"),
    )
    if (parsed.errors.length) throw new Error(parsed.errors[0])
  }
  if (!item.manualFavorite) {
    const duplicate = (await findTextClipsByContent(content)).find((match) => match.id !== item.id)
    if (duplicate) throw new Error("相同内容已存在")
  }
  const kind = item.favoriteFormat === "fields"
    ? "text"
    : item.kind === "image" ? "text" : isLikelyURL(content) ? "url" : "text"
  const title = item.title === clipTitle(item.kind, item.content)
    ? clipTitle(kind, content)
    : item.title
  const updatedAt = Date.now()
  const favoriteGroupId = item.favorite && !item.favoriteGroupManual
    ? await resolveFavoriteGroupId(title, content)
    : item.favoriteGroupId
  const favoriteOrder = favoriteGroupId !== item.favoriteGroupId
    ? await nextFavoriteItemOrder(favoriteGroupId)
    : item.favoriteOrder
  const next: ClipItem = {
    ...item,
    kind,
    title,
    content,
    contentHash: hashString(`text:${content}`),
    updatedAt,
    favoriteUpdatedAt: item.favorite ? updatedAt : item.favoriteUpdatedAt,
    favoriteGroupId,
    favoriteGroupManual: item.favoriteGroupManual,
    favoriteOrder,
    imagePath: undefined,
  }
  try {
    await updateClipContent(next)
  } catch (error) {
    if (!item.manualFavorite) {
      const duplicate = (await findTextClipsByContent(content)).find((match) => match.id !== item.id)
      if (duplicate) throw new Error("相同内容已存在")
    }
    throw error
  }
  bumpClipDataVersion()
  return next
}

export async function updateClipTitle(item: ClipItem, value: string): Promise<ClipItem> {
  const title = normalizeText(value) || clipTitle(item.kind, item.content)
  const updatedAt = Date.now()
  const favoriteGroupId = item.favorite && !item.favoriteGroupManual
    ? await resolveFavoriteGroupId(title, await getFullClipContent(item.id))
    : item.favoriteGroupId
  const favoriteOrder = favoriteGroupId !== item.favoriteGroupId
    ? await nextFavoriteItemOrder(favoriteGroupId)
    : item.favoriteOrder
  await updateClipTitleRow(item.id, title, updatedAt, item.favorite ? updatedAt : undefined)
  if (favoriteGroupId !== item.favoriteGroupId) {
    await updateClipState(item.id, {
      favoriteGroupId: favoriteGroupId ?? null,
      favoriteOrder: favoriteOrder ?? null,
    })
  }
  bumpClipDataVersion()
  return {
    ...item,
    title,
    updatedAt,
    favoriteUpdatedAt: item.favorite ? updatedAt : item.favoriteUpdatedAt,
    favoriteGroupId,
    favoriteGroupManual: item.favoriteGroupManual,
    favoriteOrder,
  }
}

export async function addFavoriteFromInput(
  title: string,
  content: string,
  options: { format?: FavoriteFormat; fieldDelimiter?: string; defaultFieldDelimiter?: string; favoriteGroupId?: string } = {},
): Promise<ClipItem> {
  const fixedContent = normalizeClipContent(content)
  if (!fixedContent.trim()) throw new Error("内容不能为空")
  const favoriteFormat: FavoriteFormat = options.format === "fields" ? "fields" : "plain"
  const fieldDelimiter = favoriteFormat === "fields" && options.fieldDelimiter != null
    ? normalizeFavoriteDelimiter(options.fieldDelimiter)
    : undefined
  if (favoriteFormat === "fields") {
    const parsed = parseFavoriteFields(
      fixedContent,
      fieldDelimiter ?? normalizeFavoriteDelimiter(options.defaultFieldDelimiter),
    )
    if (parsed.errors.length) throw new Error(parsed.errors[0])
  }
  const kind = favoriteFormat === "fields" ? "text" : isLikelyURL(fixedContent) ? "url" : "text"
  const now = Date.now()
  const normalizedTitle = title.trim() || clipTitle(kind, fixedContent)
  const favoriteGroupId = await resolveFavoriteGroupId(
    normalizedTitle,
    fixedContent,
    options.favoriteGroupId,
    Boolean(options.favoriteGroupId),
  )
  const favoriteOrder = await nextFavoriteItemOrder(favoriteGroupId)
  const item: ClipItem = {
    id: makeId("phrase"),
    kind,
    title: normalizedTitle,
    content: fixedContent,
    contentHash: hashString(`manual:${favoriteFormat}:${kind}:${fieldDelimiter ?? ""}:${fixedContent}`),
    sourceChangeCount: 0,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    favorite: true,
    manualFavorite: true,
    favoriteFormat,
    fieldDelimiter,
    fieldDelimiterOverride: Boolean(fieldDelimiter),
    favoriteGroupId,
    favoriteGroupManual: Boolean(options.favoriteGroupId),
    favoriteOrder,
    favoriteUpdatedAt: now,
    deletedAt: null,
  }
  await insertClip(item)
  bumpClipDataVersion()
  return item
}

export async function updateFavoriteFromInput(
  item: ClipItem,
  title: string,
  content: string,
  format: FavoriteFormat,
  fieldDelimiter?: string,
  defaultFieldDelimiter?: string,
  requestedFavoriteGroupId?: string,
  requestedFavoriteGroupManual = false,
): Promise<ClipItem> {
  const fixedContent = normalizeClipContent(content)
  if (!fixedContent.trim()) throw new Error("内容不能为空")
  const favoriteFormat: FavoriteFormat = format === "fields" ? "fields" : "plain"
  const delimiter = favoriteFormat === "fields" && fieldDelimiter != null
    ? normalizeFavoriteDelimiter(fieldDelimiter)
    : undefined
  if (favoriteFormat === "fields") {
    const parsed = parseFavoriteFields(
      fixedContent,
      delimiter ?? normalizeFavoriteDelimiter(defaultFieldDelimiter),
    )
    if (parsed.errors.length) throw new Error(parsed.errors[0])
  }
  if (!item.manualFavorite) {
    const duplicate = (await findTextClipsByContent(fixedContent)).find((match) => match.id !== item.id)
    if (duplicate) throw new Error("相同内容已存在")
  }
  const kind = favoriteFormat === "fields" ? "text" : isLikelyURL(fixedContent) ? "url" : "text"
  const titleValue = normalizeText(title) || clipTitle(kind, fixedContent)
  const favoriteGroupId = await resolveFavoriteGroupId(
    titleValue,
    fixedContent,
    requestedFavoriteGroupId,
    requestedFavoriteGroupManual,
  )
  const favoriteOrder = favoriteGroupId === item.favoriteGroupId && item.favoriteOrder != null
    ? item.favoriteOrder
    : await nextFavoriteItemOrder(favoriteGroupId)
  const updatedAt = Date.now()
  const next: ClipItem = {
    ...item,
    kind,
    title: titleValue,
    content: fixedContent,
    contentHash: item.manualFavorite
      ? hashString(`manual:${favoriteFormat}:${kind}:${delimiter ?? ""}:${fixedContent}`)
      : hashString(`text:${fixedContent}`),
    updatedAt,
    favorite: true,
    favoriteFormat,
    fieldDelimiter: delimiter,
    fieldDelimiterOverride: Boolean(delimiter),
    favoriteGroupId,
    favoriteGroupManual: requestedFavoriteGroupManual && Boolean(favoriteGroupId),
    favoriteOrder,
    favoriteUpdatedAt: updatedAt,
  }
  try {
    await updateClipContent(next)
    if (!item.favorite) await updateClipState(item.id, { favorite: true })
  } catch (error) {
    if (!item.manualFavorite) {
      const duplicate = (await findTextClipsByContent(fixedContent)).find((match) => match.id !== item.id)
      if (duplicate) throw new Error("相同内容已存在")
    }
    throw error
  }
  bumpClipDataVersion()
  return next
}

export async function getFavoriteGroupDefinitions(): Promise<FavoriteGroup[]> {
  return listFavoriteGroupDefinitions()
}

export async function createFavoriteGroup(
  title: string,
  ruleType: FavoriteGroupRuleType,
  pattern: string,
  ignoreCase: boolean,
): Promise<{ group: FavoriteGroup; matchedCount: number }> {
  const normalizedTitle = normalizeText(title)
  if (!normalizedTitle) throw new Error("分组名称不能为空")
  if (await favoriteGroupTitleExists(normalizedTitle)) throw new Error("已存在同名分组")
  const normalizedPattern = ruleType === "regex" ? pattern : pattern.trim()
  if (!normalizedPattern.trim()) throw new Error("匹配内容不能为空")
  if (ruleType === "regex") makeRegex(normalizedPattern)
  const now = Date.now()
  const group: FavoriteGroup = {
    id: makeId("favorite-group"),
    title: normalizedTitle,
    ruleType: ruleType === "regex" ? "regex" : "keyword",
    pattern: normalizedPattern,
    ignoreCase: ruleType === "keyword" && ignoreCase,
    sortOrder: await nextFavoriteGroupSortOrder(),
    createdAt: now,
    updatedAt: now,
  }
  try {
    await insertFavoriteGroup(group)
  } catch (error: any) {
    if (String(error?.message ?? error).includes("favorite_groups.title")) {
      throw new Error("已存在同名分组")
    }
    throw error
  }
  const matchedCount = await reclassifyAutomaticFavorites(group.id)
  bumpClipDataVersion()
  return { group, matchedCount }
}

export async function saveFavoriteGroup(
  current: FavoriteGroup,
  title: string,
  ruleType: FavoriteGroupRuleType,
  pattern: string,
  ignoreCase: boolean,
): Promise<{ group: FavoriteGroup; matchedCount: number }> {
  const normalizedTitle = normalizeText(title)
  if (!normalizedTitle) throw new Error("分组名称不能为空")
  if (await favoriteGroupTitleExists(normalizedTitle, current.id)) throw new Error("已存在同名分组")
  const normalizedPattern = ruleType === "regex" ? pattern : pattern.trim()
  if (!normalizedPattern.trim()) throw new Error("匹配内容不能为空")
  if (ruleType === "regex") makeRegex(normalizedPattern)
  const group: FavoriteGroup = {
    ...current,
    title: normalizedTitle,
    ruleType: ruleType === "regex" ? "regex" : "keyword",
    pattern: normalizedPattern,
    ignoreCase: ruleType === "keyword" && ignoreCase,
    updatedAt: Date.now(),
  }
  try {
    await updateFavoriteGroupRow(group)
  } catch (error: any) {
    if (String(error?.message ?? error).includes("favorite_groups.title")) {
      throw new Error("已存在同名分组")
    }
    throw error
  }
  const matchedCount = await reclassifyAutomaticFavorites(group.id)
  bumpClipDataVersion()
  return { group, matchedCount }
}

export async function removeFavoriteGroup(group: FavoriteGroup): Promise<void> {
  await deleteFavoriteGroupRow(group.id)
  await reclassifyAutomaticFavorites()
  bumpClipDataVersion()
}

export async function reorderFavoriteGroups(ids: string[]): Promise<void> {
  await reorderFavoriteGroupRows(ids)
  bumpClipDataVersion()
}

export { getFullClipContent }
