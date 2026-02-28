export type PageItem = ImagePageItem | PdfPageItem | PdfWholeItem

export type SourceItem = {
  id: string
  kind: "image" | "pdf"
  name: string
  originalPath?: string
  pages: PageItem[]
}

export type ImagePageItem = {
  id: string
  kind: "image"
  title: string
  sourceName: string
  selected: boolean
  selectedOrder?: number
  image: UIImage
}

export type PdfPageItem = {
  id: string
  kind: "pdf"
  title: string
  sourceName: string
  selected: boolean
  selectedOrder?: number
  pdfPath: string
  pageIndex: number
  previewImage: UIImage | null
  previewFilePath: string | null
}

export type PdfWholeItem = {
  id: string
  kind: "pdf-whole"
  title: string
  sourceName: string
  selected: boolean
  selectedOrder?: number
  pdfPath: string
  pageCount: number
  previewImage: UIImage | null
  previewFilePath: string | null
}

export type ImportResult = {
  sources: SourceItem[]
  notices: string[]
}
