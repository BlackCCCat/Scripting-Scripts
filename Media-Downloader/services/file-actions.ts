import { Path } from "scripting"
import type { SaveMode } from "./preferences"
import type { DownloadedFile, DownloadSuccess } from "./douyin"

export type PostDownloadResult = {
  message: string
  keepFilesInHistory: boolean
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function commandLine(args: string[]): string {
  const [command, ...rest] = args
  return [command, ...rest.map(shellQuote)].join(" ")
}

async function saveVideoToPhotos(filePath: string, fileName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const ok = await Photos.saveVideo(filePath, {
      fileName,
      shouldMoveFile: false,
    })
    return { ok }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function makePhotosCompatibleVideo(filePath: string): Promise<string | null> {
  const ext = Path.extname(filePath)
  const base = ext ? filePath.slice(0, -ext.length) : filePath
  const outputPath = `${base}.photos.mp4`
  const result = await Shell.run(
    commandLine([
      "ffmpeg",
      "-nostdin",
      "-y",
      "-i",
      filePath,
      "-c:v",
      "h264_videotoolbox",
      "-b:v",
      "6000k",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      outputPath,
    ]),
    { timeout: 3600 }
  )

  if (result.exitCode !== 0 || !FileManager.existsSync(outputPath)) {
    try {
      if (FileManager.existsSync(outputPath)) FileManager.removeSync(outputPath)
    } catch {}
    return null
  }

  return outputPath
}

export async function saveFilePathToPhotos(filePath: string, fileName: string) {
  const original = await saveVideoToPhotos(filePath, fileName)
  if (original.ok) return

  let convertedPath: string | null = null
  try {
    convertedPath = await makePhotosCompatibleVideo(filePath)
    if (convertedPath) {
      const converted = await saveVideoToPhotos(convertedPath, fileName)
      if (converted.ok) return
    }
  } finally {
    try {
      if (convertedPath && FileManager.existsSync(convertedPath)) FileManager.removeSync(convertedPath)
    } catch {}
  }

  throw new Error(original.error ? `保存到相册失败：${original.error}` : "保存到相册失败")
}

export async function saveImageFilePathToPhotos(filePath: string, fileName: string) {
  const ok = await Photos.savePhoto(filePath, {
    fileName,
    shouldMoveFile: false,
  })
  if (!ok) {
    throw new Error("保存图片到相册失败")
  }
}

export async function saveDownloadedFilesToPhotos(files: DownloadedFile[]) {
  for (const file of files) {
    if (file.mediaType === "image") {
      await saveImageFilePathToPhotos(file.filePath, file.fileName)
    } else {
      await saveFilePathToPhotos(file.filePath, file.fileName)
    }
  }
}

export async function exportDownloadedFilesToFiles(files: DownloadedFile[]) {
  const exportFiles = files.map((file) => {
    const data = Data.fromFile(file.filePath)
    if (!data) {
      throw new Error(`读取本地文件失败，无法导出：${file.fileName}`)
    }
    return {
      data,
      name: file.fileName,
    }
  })

  const exported = await DocumentPicker.exportFiles({
    files: exportFiles,
  })

  if (!exported.length) {
    throw new Error("用户取消了导出")
  }

  return exported
}

export async function postDownloadAction(record: DownloadSuccess, mode: SaveMode): Promise<PostDownloadResult> {
  const files = record.files?.length ? record.files : [{
    filePath: record.filePath,
    fileName: record.fileName,
    finalURL: record.finalURL,
    bytesWritten: record.bytesWritten,
    mediaType: record.mediaType || "video",
  }]
  const fileCountText = files.length > 1 ? `${files.length} 个文件` : record.fileName

  if (mode === "photos") {
    await saveDownloadedFilesToPhotos(files)
    return { message: "已按默认偏好保存到相册。", keepFilesInHistory: false }
  }

  if (mode === "files") {
    const paths = await exportDownloadedFilesToFiles(files)
    return { message: `已按默认偏好导出到文件：${paths.join(", ")}`, keepFilesInHistory: false }
  }

  const result = await Dialog.actionSheet({
    title: "下载完成",
    message: `《${record.extracted.title || record.fileName}》已下载（${fileCountText}）。接下来你想做什么？`,
    actions: [
      { label: "保存到相册" },
      { label: "导出到文件" },
      { label: "分享文件" },
      { label: "仅保留到历史记录" },
    ],
    cancelButton: true,
  })

  if (result === 0) {
    await saveDownloadedFilesToPhotos(files)
    return { message: "已保存到相册。", keepFilesInHistory: false }
  }
  if (result === 1) {
    const paths = await exportDownloadedFilesToFiles(files)
    return { message: `已导出到文件：${paths.join(", ")}`, keepFilesInHistory: false }
  }
  if (result === 2) {
    await ShareSheet.present(files.map((file) => file.filePath))
    return { message: "已打开分享面板。", keepFilesInHistory: false }
  }
  return { message: "已加入下载历史。", keepFilesInHistory: true }
}
