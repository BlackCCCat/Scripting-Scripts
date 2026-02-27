import { Path } from "scripting"
import type { ImagePageItem, ImportResult, SourceItem } from "../types"
import { createId } from "./id"
import { buildPdfPagePreview } from "./preview"

const MAX_PDF_PAGES = 80

function isPdfPath(path: string): boolean {
  return Path.extname(path).toLowerCase() === ".pdf"
}

function createImageSource(image: UIImage, name: string, sourcePath?: string): SourceItem {
  const sourceId = createId("source")
  const page: ImagePageItem = {
    id: createId("page"),
    kind: "image",
    title: "图片",
    sourceName: name,
    selected: false,
    image,
  }
  return {
    id: sourceId,
    kind: "image",
    name,
    originalPath: sourcePath,
    pages: [page],
  }
}

async function createPdfSource(path: string): Promise<{ source: SourceItem | null; notice?: string }> {
  const fileName = Path.basename(path)
  const document = PDFDocument.fromFilePath(path)
  if (!document) {
    return { source: null, notice: `${fileName} 不是可读取的 PDF 文件` }
  }
  if (document.isLocked) {
    return { source: null, notice: `${fileName} 已加密，暂不支持导入` }
  }

  const sourceId = createId("source")
  const pages: SourceItem["pages"] = []

  const readPageCount = Math.min(document.pageCount, MAX_PDF_PAGES)

  for (let idx = 0; idx < readPageCount; idx += 1) {
    const page = document.pageAt(idx)
    if (!page) continue

    const { previewImage, previewFilePath } = await buildPdfPagePreview(page, sourceId, idx)
    pages.push({
      id: createId("page"),
      kind: "pdf" as const,
      title: `第 ${idx + 1} 页`,
      sourceName: fileName,
      selected: false,
      pdfPath: path,
      pageIndex: idx,
      previewImage,
      previewFilePath,
    })
  }

  if (pages.length === 0) {
    return { source: null, notice: `${fileName} 没有可读取页面` }
  }

  const notice = document.pageCount > MAX_PDF_PAGES
    ? `${fileName} 共 ${document.pageCount} 页，已限制导入前 ${MAX_PDF_PAGES} 页以避免卡顿`
    : undefined

  return {
    source: {
      id: sourceId,
      kind: "pdf",
      name: fileName,
      originalPath: path,
      pages,
    },
    notice,
  }
}

export async function pickSourcesFromFiles(): Promise<ImportResult> {
  const filePaths = await DocumentPicker.pickFiles({
    types: ["public.image", "com.adobe.pdf"],
    allowsMultipleSelection: true,
  })

  if (!filePaths || filePaths.length === 0) {
    return { sources: [], notices: [] }
  }

  const sources: SourceItem[] = []
  const notices: string[] = []

  for (const filePath of filePaths) {
    const fileName = Path.basename(filePath)
    const shouldTreatAsPdf = isPdfPath(filePath)

    if (shouldTreatAsPdf) {
      const { source, notice } = await createPdfSource(filePath)
      if (source) sources.push(source)
      if (notice) notices.push(notice)
      continue
    }

    const image = UIImage.fromFile(filePath)
    if (image) {
      sources.push(createImageSource(image, fileName, filePath))
      continue
    }

    const maybePdf = await createPdfSource(filePath)
    if (maybePdf.source) {
      sources.push(maybePdf.source)
    } else {
      notices.push(maybePdf.notice ?? `${fileName} 格式不支持`)
    }
  }

  return { sources, notices }
}

export async function pickSourcesFromPhotos(): Promise<ImportResult> {
  const picked = await Photos.pick({
    limit: 50,
    filter: PHPickerFilter.images(),
  })

  if (!picked || picked.length === 0) {
    return { sources: [], notices: [] }
  }

  const sources: SourceItem[] = []
  const notices: string[] = []

  for (let idx = 0; idx < picked.length; idx += 1) {
    const item = picked[idx]
    const image = await item.uiImage()
    if (!image) {
      notices.push(`第 ${idx + 1} 张照片读取失败`)
      continue
    }
    sources.push(createImageSource(image, `照片 ${idx + 1}`))
  }

  return { sources, notices }
}
