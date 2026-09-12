import { Path } from "scripting"

const PREVIEW_DIR_NAME = "PDFHelperPreviews"

let _previewDirCache: string | null = null

export async function cleanUpPreviewDirectory(): Promise<void> {
  const dir = _previewDirCache || Path.join(FileManager.temporaryDirectory, PREVIEW_DIR_NAME)
  try {
    const fm = (globalThis as any).FileManager
    if (fm && typeof fm.remove === "function") {
      await fm.remove(dir)
    }
  } catch { }
}

/**
 * Scripting 目前仅封装了 PDFKit 数据操作层（PDFDocument、PDFPage），未提供页面位图光栅化渲染能力。
 * 返回 null 以使用 Apple HIG 规范的原生 PDF 卡片展示；实际页面查看由 QuickLook.previewURLs 提供。
 */
export async function buildPdfPagePreview(
  _page: PDFPage,
  _document?: PDFDocument
): Promise<{ previewImage: UIImage | null; previewFilePath: string | null }> {
  return { previewImage: null, previewFilePath: null }
}
