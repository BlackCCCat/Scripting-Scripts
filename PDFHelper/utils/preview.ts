import { Path } from "scripting"

const PREVIEW_DIR_NAME = "PDFHelperPreviews"

async function ensurePreviewDirectory(): Promise<string> {
  const dir = Path.join(FileManager.temporaryDirectory, PREVIEW_DIR_NAME)
  await FileManager.createDirectory(dir, true)
  return dir
}

export async function buildPdfPagePreview(
  page: PDFPage,
  fileId: string,
  pageIndex: number
): Promise<{ previewImage: UIImage | null; previewFilePath: string | null }> {
  const pageData = await page.data
  if (!pageData) {
    return { previewImage: null, previewFilePath: null }
  }

  const dir = await ensurePreviewDirectory()
  const previewPath = Path.join(dir, `${fileId}-${pageIndex + 1}.pdf`)
  await FileManager.writeAsData(previewPath, pageData)
  return { previewImage: null, previewFilePath: previewPath }
}
