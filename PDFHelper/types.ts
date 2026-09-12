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

export type WorkspaceId = "primary" | "secondary"

export type WorkspaceState = {
  id: WorkspaceId
  title: string
  sources: SourceItem[]
}

export type WorkspaceLayoutDirection = "horizontal" | "vertical"

export type WorkspaceDisplayMode = "list" | "grid"

export type PdfHelperDragPayload = {
  app: "PDFHelper"
  kind: "source" | "page"
  workspaceId: WorkspaceId
  sourceId: string
  pageId?: string
}
