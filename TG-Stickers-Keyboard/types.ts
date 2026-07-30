export type StickerKind = "static" | "animated" | "video" | "unknown"

export type CachedSticker = {
  id: string
  fileId: string
  fileUniqueId: string
  emoji: string
  kind: StickerKind
  width?: number
  height?: number
  fileName: string
  localPath: string
  thumbnailPath?: string
  gifPath?: string
  remotePath?: string
}

export type StickerPack = {
  name: string
  title: string
  importedAt: number
  sourceLink: string
  stickers: CachedSticker[]
}

export type ImportProgress = {
  current: number
  total: number
  message: string
}

export type PreviewSticker = {
  id: string
  fileId: string
  fileUniqueId: string
  emoji: string
  kind: StickerKind
  width?: number
  height?: number
  fileName: string
  localPath: string
  thumbnailPath?: string
  gifPath?: string
  remotePath?: string
  previewPath?: string
  previewIsOriginal?: boolean
}

export type StickerPackPreview = {
  name: string
  title: string
  sourceLink: string
  stickers: PreviewSticker[]
}
