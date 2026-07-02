export type PhotoItem = {
  id: string
  asset: PHAsset
  image: UIImage | null
  loading: boolean
}

export type PhotoSourceKind = "all" | "screenshots" | "album"

export type PhotoSource = {
  kind: PhotoSourceKind
  albumId?: string
}

export type AlbumOption = {
  id: string
  title: string
  subtitle: string
  count: number
  collection: PHAssetCollection
}

export type PointOffset = {
  x: number
  y: number
}

export type CardMotion = {
  offset: PointOffset
  scale: number
  opacity: number
}
