import { Path } from "scripting"

const PREVIEW_DIR_NAME = "PDFHelperPreviews"
const THUMB_WIDTH = 176
const THUMB_HEIGHT = 244

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

export async function buildPdfPagePreview(
  page: PDFPage
): Promise<{ previewImage: UIImage | null; previewFilePath: string | null }> {
  const pageData = await page.data
  if (!pageData) {
    return { previewImage: null, previewFilePath: null }
  }

  // Convert PDF page data → UIImage → small thumbnail
  const fullImage = UIImage.fromData(pageData)
  if (fullImage) {
    const thumb = fullImage.preparingThumbnail({ width: THUMB_WIDTH, height: THUMB_HEIGHT })
    if (thumb) {
      // Return tiny in-memory thumbnail, no file I/O needed
      return { previewImage: thumb, previewFilePath: null }
    }
  }

  return { previewImage: null, previewFilePath: null }
}
