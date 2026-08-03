import type { CachedSticker } from "./types"

const ALBUM_TITLE = "TG-Stickers"
const ALBUM_ID_KEY = "tg-stickers-keyboard:photo-album-id:v1"
const SAVED_ASSETS_KEY = "tg-stickers-keyboard:photo-assets:v1"

type SavedAssets = Record<string, string>

export type SaveToAlbumResult = {
  saved: number
  alreadySaved: number
  skipped: number
}

export type ClearAlbumResult = {
  deleted: number
  albumDeleted: boolean
}

function stickerKey(packName: string, stickerId: string): string {
  return `${packName}:${stickerId}`
}

function loadSavedAssets(): SavedAssets {
  return Storage.get<SavedAssets>(SAVED_ASSETS_KEY, { shared: true }) ?? {}
}

function saveSavedAssets(assets: SavedAssets) {
  Storage.set(SAVED_ASSETS_KEY, assets, { shared: true })
}

async function assertPhotoLibraryAccess() {
  let status = Photos.authorizationStatus("readWrite")
  if (status === "notDetermined") {
    // Scripting requests access automatically on the first read/write operation.
    try {
      await Photos.fetchAlbums({ type: "album" })
    } catch {}
    status = Photos.authorizationStatus("readWrite")
  }
  if (status === "denied" || status === "restricted") {
    throw new Error("没有照片访问权限，请在系统设置中允许访问照片")
  }
}

async function findAlbum(): Promise<PHAssetCollection | null> {
  const savedId = Storage.get<string>(ALBUM_ID_KEY, { shared: true })
  if (savedId) {
    const savedAlbum = await Photos.fetchAlbum(savedId)
    if (savedAlbum?.title === ALBUM_TITLE) return savedAlbum
  }

  const albums = await Photos.fetchAlbums({ type: "album" })
  const album = albums.find((item) => item.title === ALBUM_TITLE) ?? null
  if (album) Storage.set(ALBUM_ID_KEY, album.localIdentifier, { shared: true })
  return album
}

async function ensureAlbum(): Promise<PHAssetCollection> {
  const existing = await findAlbum()
  if (existing) return existing

  const created = await Photos.createAlbum(ALBUM_TITLE)
  if (!created) throw new Error(`无法创建 ${ALBUM_TITLE} 相簿`)
  Storage.set(ALBUM_ID_KEY, created.localIdentifier, { shared: true })
  return created
}

function photoPath(sticker: CachedSticker): string | null {
  if (sticker.gifPath && FileManager.existsSync(sticker.gifPath)) return sticker.gifPath
  if (sticker.fileName.toLowerCase().endsWith(".gif") && FileManager.existsSync(sticker.localPath)) {
    return sticker.localPath
  }
  if (sticker.kind === "static" && FileManager.existsSync(sticker.localPath)) return sticker.localPath
  return null
}

async function wait(milliseconds: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function findNewAsset(before: Set<string>): Promise<PHAsset | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const assets = await Photos.fetchAssets({
      mediaType: "image",
      sortBy: "modificationDate",
      ascending: false,
      limit: 500,
    })
    const created = assets.find((asset) => !before.has(asset.localIdentifier))
    if (created) return created
    await wait(150)
  }
  return null
}

async function saveSticker(sticker: CachedSticker): Promise<PHAsset> {
  const path = photoPath(sticker)
  if (!path) throw new Error("该贴纸没有可保存的图片或 GIF 文件")

  const before = new Set((await Photos.fetchAssets({
    mediaType: "image",
    sortBy: "modificationDate",
    ascending: false,
    limit: 500,
  })).map((asset) => asset.localIdentifier))
  const saved = await Photos.savePhoto(path, {
    fileName: sticker.fileName,
    shouldMoveFile: false,
  })
  if (!saved) throw new Error(`保存贴纸失败：${sticker.emoji || sticker.fileName}`)

  const asset = await findNewAsset(before)
  if (!asset) throw new Error("贴纸已写入照片图库，但无法取得新照片标识")
  return asset
}

export async function saveStickersToAlbum(
  packName: string,
  stickers: CachedSticker[],
): Promise<SaveToAlbumResult> {
  const eligible = stickers.filter((sticker) => photoPath(sticker))
  if (eligible.length === 0) throw new Error("选择的贴纸没有可保存的图片或 GIF")

  await assertPhotoLibraryAccess()
  const album = await ensureAlbum()
  const savedAssets = loadSavedAssets()
  const existingIds = eligible
    .map((sticker) => savedAssets[stickerKey(packName, sticker.id)])
    .filter((assetId): assetId is string => !!assetId)
  const existingAssets = existingIds.length ? await Photos.fetchAssets(existingIds) : []
  const existingById = new Map(existingAssets.map((asset) => [asset.localIdentifier, asset]))
  let saved = 0
  let alreadySaved = 0

  for (const sticker of eligible) {
    const key = stickerKey(packName, sticker.id)
    const existingId = savedAssets[key]
    if (existingId) {
      const existing = existingById.get(existingId)
      if (existing) {
        const added = await album.addAssets([existing])
        if (!added) throw new Error(`无法将贴纸加入 ${ALBUM_TITLE} 相簿`)
        alreadySaved += 1
        continue
      }
      delete savedAssets[key]
    }

    const asset = await saveSticker(sticker)
    savedAssets[key] = asset.localIdentifier
    saveSavedAssets(savedAssets)
    const added = await album.addAssets([asset])
    if (!added) throw new Error(`无法将贴纸加入 ${ALBUM_TITLE} 相簿`)
    saved += 1
  }

  return {
    saved,
    alreadySaved,
    skipped: stickers.length - eligible.length,
  }
}

export async function clearStickersFromAlbum(): Promise<ClearAlbumResult> {
  await assertPhotoLibraryAccess()
  const savedAssets = loadSavedAssets()
  const album = await findAlbum()
  const albumAssets = album ? await album.fetchAssets() : []
  const savedIds = [...new Set(Object.values(savedAssets))]
  const recordedAssets = savedIds.length ? await Photos.fetchAssets(savedIds) : []
  const assets = [...new Map(
    [...albumAssets, ...recordedAssets].map((asset) => [asset.localIdentifier, asset]),
  ).values()]

  if (assets.length > 0) {
    const deleted = await Photos.deleteAssets(assets)
    if (!deleted) throw new Error("已取消删除相册贴纸")
  }
  saveSavedAssets({})

  let albumDeleted = false
  if (album && (await album.fetchAssets()).length === 0) {
    albumDeleted = await Photos.deleteAlbums([album])
    if (albumDeleted) Storage.remove(ALBUM_ID_KEY, { shared: true })
  }

  return { deleted: assets.length, albumDeleted }
}
