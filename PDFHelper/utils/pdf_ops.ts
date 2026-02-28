import { Path } from "scripting"
import type { PageItem, SourceItem } from "../types"

export function getSelectedPages(sources: SourceItem[]): PageItem[] {
  const rows: Array<{ page: PageItem; natural: number; order: number }> = []
  let natural = 0

  for (const source of sources) {
    for (const page of source.pages) {
      if (page.selected) {
        rows.push({
          page,
          natural,
          order: page.selectedOrder ?? Number.MAX_SAFE_INTEGER,
        })
      }
      natural += 1
    }
  }

  rows.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.natural - b.natural
  })

  return rows.map((row) => row.page)
}

async function clonePage(page: PDFPage): Promise<PDFPage | null> {
  const pageData = await page.data
  if (!pageData) return null
  const pageDocument = PDFDocument.fromData(pageData)
  if (!pageDocument) return null
  return pageDocument.pageAt(0)
}

function appendPage(document: PDFDocument, page: PDFPage): void {
  const doc: any = document
  const count = getPageCount(doc)
  const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(doc) ?? {})
    .filter((name) => {
      const lower = name.toLowerCase()
      if (lower === "constructor") return false
      if (lower.includes("insert") && lower.includes("page")) return true
      if (lower.includes("add") && lower.includes("page")) return true
      if (lower.includes("append") && lower.includes("page")) return true
      return false
    })

  const candidates = [
    "insertPageAt",
    "insertPage",
    "addPage",
    "appendPage",
    "insert",
    ...methodNames,
  ]

  const tried = new Set<string>()
  for (const name of candidates) {
    if (tried.has(name)) continue
    tried.add(name)
    const fn = (doc as any)[name]
    if (typeof fn !== "function") continue

    const before = getPageCount(doc)
    const argSets: any[][] = [
      [page, count],
      [count, page],
      [page],
      [count, page, false],
      [page, count, false],
    ]

    for (const args of argSets) {
      try {
        fn.apply(doc, args)
        const after = getPageCount(doc)
        if (after > before) return
      } catch {
      }
    }
  }

  const available = Object.getOwnPropertyNames(Object.getPrototypeOf(doc) ?? {})
    .filter((name) => name !== "constructor")
    .slice(0, 30)
    .join(", ")
  throw new Error(`当前环境不支持多页插入，无法完成合并。可用方法: ${available || "无"}`)
}

function getPageCount(doc: any): number {
  const keys = ["pageCount", "count", "numberOfPages"]
  for (const key of keys) {
    const value = doc?.[key]
    if (typeof value === "number") return value
    if (typeof value === "function") {
      try {
        const result = value.call(doc)
        if (typeof result === "number") return result
      } catch {
      }
    }
  }
  return 0
}

async function addAllPagesFromWhole(
  outputDocument: PDFDocument,
  pdfPath: string,
  pageCount: number
): Promise<number> {
  const sourceDocument = PDFDocument.fromFilePath(pdfPath)
  if (!sourceDocument || sourceDocument.isLocked) return 0

  let added = 0
  const total = Math.min(sourceDocument.pageCount, pageCount)
  for (let i = 0; i < total; i++) {
    const page = sourceDocument.pageAt(i)
    if (!page) continue
    const copiedPage = await clonePage(page)
    if (!copiedPage) continue
    appendPage(outputDocument, copiedPage)
    added++
  }
  return added
}

async function buildDocumentFromPages(pages: PageItem[]): Promise<{ document: PDFDocument; pageCount: number }> {
  return Thread.runInBackground(async () => {
    let outputDocument: PDFDocument | null = null
    let insertedPageCount = 0
    const sourceCache = new Map<string, PDFDocument>()

    for (const pageItem of pages) {
      if (pageItem.kind === "pdf-whole") {
        if (!outputDocument) {
          const sourceDocument = PDFDocument.fromFilePath(pageItem.pdfPath)
          if (!sourceDocument || sourceDocument.isLocked) continue
          const firstPage = sourceDocument.pageAt(0)
          if (!firstPage) continue
          const firstClone = await clonePage(firstPage)
          if (!firstClone) continue
          const firstData = await firstClone.data
          if (!firstData) continue
          outputDocument = PDFDocument.fromData(firstData)
          if (!outputDocument) continue
          insertedPageCount += 1

          for (let i = 1; i < Math.min(sourceDocument.pageCount, pageItem.pageCount); i++) {
            const p = sourceDocument.pageAt(i)
            if (!p) continue
            const cp = await clonePage(p)
            if (!cp) continue
            appendPage(outputDocument, cp)
            insertedPageCount++
          }
        } else {
          const added = await addAllPagesFromWhole(outputDocument, pageItem.pdfPath, pageItem.pageCount)
          insertedPageCount += added
        }
        continue
      }

      let page: PDFPage | null = null

      if (pageItem.kind === "image") {
        page = PDFPage.fromImage(pageItem.image)
      } else {
        const cached = sourceCache.get(pageItem.pdfPath)
        const sourceDocument = cached ?? PDFDocument.fromFilePath(pageItem.pdfPath)
        if (!sourceDocument || sourceDocument.isLocked) continue
        if (!cached) sourceCache.set(pageItem.pdfPath, sourceDocument)
        page = sourceDocument.pageAt(pageItem.pageIndex)
      }

      if (!page) continue

      if (!outputDocument) {
        const firstPage = await clonePage(page)
        if (!firstPage) continue
        const firstData = await firstPage.data
        if (!firstData) continue
        outputDocument = PDFDocument.fromData(firstData)
        if (!outputDocument) continue
        insertedPageCount += 1
        continue
      }

      const copiedPage = await clonePage(page)
      if (!copiedPage) continue
      appendPage(outputDocument, copiedPage)
      insertedPageCount += 1
    }

    if (!outputDocument || insertedPageCount === 0) {
      throw new Error("未能生成 PDF，请检查已选页面是否可读取")
    }

    return { document: outputDocument, pageCount: insertedPageCount }
  })
}

async function documentToData(document: PDFDocument): Promise<Data> {
  const data = await document.data
  if (!data) {
    throw new Error("PDF 数据生成失败")
  }
  return data
}

export async function convertSelectedImagesToPdf(sources: SourceItem[]): Promise<{ data: Data; pageCount: number }> {
  const selectedImages = getSelectedPages(sources).filter((page) => page.kind === "image")
  if (selectedImages.length === 0) {
    throw new Error("请先勾选至少一张图片")
  }

  const { document, pageCount } = await buildDocumentFromPages(selectedImages)
  const data = await documentToData(document)
  return { data, pageCount }
}

export async function mergeSelectedPagesToPdf(sources: SourceItem[]): Promise<{ data: Data; pageCount: number }> {
  const selectedPages = getSelectedPages(sources)
  if (selectedPages.length === 0) {
    throw new Error("请先勾选至少一页")
  }

  const { document, pageCount } = await buildDocumentFromPages(selectedPages)
  const data = await documentToData(document)
  return { data, pageCount }
}
