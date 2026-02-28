import { Path } from "scripting"
import type { ImagePageItem, ImportResult, PdfWholeItem, SourceItem } from "../types"
import { createId } from "./id"
import { buildPdfPagePreview } from "./preview"

/** When per-page count exceeds this threshold, skip preview generation */
const PREVIEW_THRESHOLD = 20

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

type PdfImportMode = "whole" | "per-page"

type PdfImportOptions = {
  mode: PdfImportMode
  startPage: number
  endPage: number
}

function parsePageRange(input: string, pageCount: number): { start: number; end: number } | null {
  const trimmed = input.trim()
  const match = trimmed.match(/^(\d+)\s*[-–—~～到]\s*(\d+)$/)
  if (match) {
    let start = parseInt(match[1], 10)
    let end = parseInt(match[2], 10)
    if (isNaN(start) || isNaN(end)) return null
    if (start > end) [start, end] = [end, start]
    start = Math.max(1, start)
    end = Math.min(pageCount, end)
    if (start > pageCount) return null
    return { start, end }
  }

  const single = parseInt(trimmed, 10)
  if (!isNaN(single) && single >= 1 && single <= pageCount) {
    return { start: single, end: single }
  }

  return null
}

async function askPdfImportOptions(fileName: string, pageCount: number): Promise<PdfImportOptions | null> {
  if (pageCount <= 1) {
    return { mode: "per-page", startPage: 1, endPage: 1 }
  }

  const previewNote = pageCount > PREVIEW_THRESHOLD
    ? `\n（超过 ${PREVIEW_THRESHOLD} 页时将不显示缩略图以提升性能）`
    : ""

  const usePerPage = await Dialog.confirm({
    title: `${fileName}（共 ${pageCount} 页）`,
    message: `「按页选择」将展示每页缩略图供您逐页勾选；\n「整体导入」将作为一个整体项目导入，合并时包含全部页面。${previewNote}`,
    confirmLabel: "按页选择",
    cancelLabel: "整体导入",
  })

  if (!usePerPage) {
    return { mode: "whole", startPage: 1, endPage: pageCount }
  }

  const defaultRange = `1-${pageCount}`

  const rangeInput = await Dialog.prompt({
    title: "选择页码范围",
    message: `共 ${pageCount} 页，无页数上限。\n请输入导入范围，例如 "${defaultRange}" 或 "5-20"`,
    placeholder: defaultRange,
    defaultValue: defaultRange,
  })

  if (rangeInput == null) {
    return null
  }

  const parsed = parsePageRange(rangeInput, pageCount)
  if (parsed) {
    return { mode: "per-page", startPage: parsed.start, endPage: parsed.end }
  }

  return { mode: "per-page", startPage: 1, endPage: pageCount }
}

async function createPdfSourcePerPage(
  path: string,
  startPage: number,
  endPage: number
): Promise<{ source: SourceItem | null; notice?: string }> {
  return Thread.runInBackground(async () => {
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

    const start0 = startPage - 1
    const end0 = Math.min(endPage - 1, document.pageCount - 1)
    const totalPages = end0 - start0 + 1
    const skipPreview = totalPages > PREVIEW_THRESHOLD

    for (let idx = start0; idx <= end0; idx += 1) {
      const page = document.pageAt(idx)
      if (!page) continue

      let previewImage: UIImage | null = null
      let previewFilePath: string | null = null

      if (!skipPreview) {
        const preview = await buildPdfPagePreview(page, sourceId, idx)
        previewImage = preview.previewImage
        previewFilePath = preview.previewFilePath
      }

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

    const rangeLabel = startPage === 1 && endPage >= document.pageCount
      ? ""
      : `（第 ${startPage}-${Math.min(endPage, document.pageCount)} 页）`

    return {
      source: {
        id: sourceId,
        kind: "pdf",
        name: `${fileName}${rangeLabel}`,
        originalPath: path,
        pages,
      },
    }
  })
}

async function createPdfSourceWhole(
  path: string
): Promise<{ source: SourceItem | null; notice?: string }> {
  return Thread.runInBackground(async () => {
    const fileName = Path.basename(path)
    const document = PDFDocument.fromFilePath(path)
    if (!document) {
      return { source: null, notice: `${fileName} 不是可读取的 PDF 文件` }
    }
    if (document.isLocked) {
      return { source: null, notice: `${fileName} 已加密，暂不支持导入` }
    }

    if (document.pageCount === 0) {
      return { source: null, notice: `${fileName} 没有可读取页面` }
    }

    const sourceId = createId("source")

    // Whole mode: generate preview for first page only
    let previewImage: UIImage | null = null
    let previewFilePath: string | null = null
    const firstPage = document.pageAt(0)
    if (firstPage) {
      const preview = await buildPdfPagePreview(firstPage, sourceId, 0)
      previewImage = preview.previewImage
      previewFilePath = preview.previewFilePath
    }

    const wholePage: PdfWholeItem = {
      id: createId("page"),
      kind: "pdf-whole",
      title: `整体（共 ${document.pageCount} 页）`,
      sourceName: fileName,
      selected: false,
      pdfPath: path,
      pageCount: document.pageCount,
      previewImage,
      previewFilePath,
    }

    return {
      source: {
        id: sourceId,
        kind: "pdf",
        name: fileName,
        originalPath: path,
        pages: [wholePage],
      },
    }
  })
}

export async function pickSourcesFromFiles(): Promise<ImportResult> {
  const filePaths = await DocumentPicker.pickFiles({
    types: ["public.image", "com.adobe.pdf"],
    allowsMultipleSelection: true,
  })

  if (!filePaths || filePaths.length === 0) {
    return { sources: [], notices: [] }
  }

  const pdfPaths = filePaths.filter((p: string) => isPdfPath(p))
  const nonPdfPaths = filePaths.filter((p: string) => !isPdfPath(p))

  let pdfOptions: PdfImportOptions | null = null
  if (pdfPaths.length > 0) {
    const firstPdf = PDFDocument.fromFilePath(pdfPaths[0])
    const firstPageCount = firstPdf?.pageCount ?? 0

    if (pdfPaths.length === 1) {
      pdfOptions = await askPdfImportOptions(Path.basename(pdfPaths[0]), firstPageCount)
    } else {
      const usePerPage = await Dialog.confirm({
        title: `导入 ${pdfPaths.length} 个 PDF 文件`,
        message: `「按页选择」将展示每页缩略图供逐页勾选；\n「整体导入」将每个文件作为一个整体项目导入。\n（超过 ${PREVIEW_THRESHOLD} 页时不显示缩略图）`,
        confirmLabel: "按页选择",
        cancelLabel: "整体导入",
      })

      if (usePerPage) {
        const maxPc = Math.max(...pdfPaths.map((p: string) => {
          const doc = PDFDocument.fromFilePath(p)
          return doc?.pageCount ?? 0
        }))
        const defaultRange = `1-${maxPc > 0 ? maxPc : 100}`
        const rangeInput = await Dialog.prompt({
          title: "选择页码范围",
          message: `请输入统一的导入范围，例如 "${defaultRange}"`,
          placeholder: defaultRange,
          defaultValue: defaultRange,
        })

        if (rangeInput == null) {
          pdfOptions = null
        } else {
          const parsed = parsePageRange(rangeInput, maxPc > 0 ? maxPc : 99999)
          pdfOptions = parsed
            ? { mode: "per-page", startPage: parsed.start, endPage: parsed.end }
            : { mode: "per-page", startPage: 1, endPage: maxPc > 0 ? maxPc : 99999 }
        }
      } else {
        pdfOptions = { mode: "whole", startPage: 1, endPage: 99999 }
      }
    }

    if (pdfOptions == null) {
      return { sources: [], notices: [] }
    }
  }

  const sources: SourceItem[] = []
  const notices: string[] = []

  for (const filePath of nonPdfPaths) {
    const fileName = Path.basename(filePath)
    const image = UIImage.fromFile(filePath)
    if (image) {
      sources.push(createImageSource(image, fileName, filePath))
      continue
    }

    const maybePdf = await createPdfSourceWhole(filePath)
    if (maybePdf.source) {
      sources.push(maybePdf.source)
    } else {
      notices.push(maybePdf.notice ?? `${fileName} 格式不支持`)
    }
  }

  for (const filePath of pdfPaths) {
    if (pdfOptions!.mode === "whole") {
      const { source, notice } = await createPdfSourceWhole(filePath)
      if (source) sources.push(source)
      if (notice) notices.push(notice)
    } else {
      const { source, notice } = await createPdfSourcePerPage(
        filePath,
        pdfOptions!.startPage,
        pdfOptions!.endPage
      )
      if (source) sources.push(source)
      if (notice) notices.push(notice)
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
