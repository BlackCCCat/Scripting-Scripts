import type { SaveMode } from "./preferences"
import type { DownloadedFile, DownloadSuccess } from "./douyin"

export async function saveFilePathToPhotos(filePath: string, fileName: string) {
  const ok = await Photos.saveVideo(filePath, {
    fileName,
    shouldMoveFile: false,
  })
  if (!ok) {
    throw new Error("保存到相册失败")
  }
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

export async function exportFilePathToFiles(filePath: string, fileName: string) {
  const data = Data.fromFile(filePath)
  if (!data) {
    throw new Error("读取本地文件失败，无法导出")
  }

  const exported = await DocumentPicker.exportFiles({
    files: [{ data, name: fileName }],
  })

  if (!exported.length) {
    throw new Error("用户取消了导出")
  }

  return exported[0]
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

export async function postDownloadAction(record: DownloadSuccess, mode: SaveMode): Promise<string> {
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
    return "已按默认偏好保存到相册。"
  }

  if (mode === "files") {
    const paths = await exportDownloadedFilesToFiles(files)
    return `已按默认偏好导出到文件：${paths.join(", ")}`
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
    return "已保存到相册。"
  }
  if (result === 1) {
    const paths = await exportDownloadedFilesToFiles(files)
    return `已导出到文件：${paths.join(", ")}`
  }
  if (result === 2) {
    await ShareSheet.present(files.map((file) => file.filePath))
    return "已打开分享面板。"
  }
  return "已加入下载历史。"
}

export async function askSaveMode(): Promise<Exclude<SaveMode, "ask"> | null> {
  const index = await Dialog.actionSheet({
    title: "抖音视频下载完成后保存到哪里？",
    message: "相册适合直接查看；文件适合导出到 iCloud Drive 或本地文件夹。",
    actions: [
      { label: "保存到相册" },
      { label: "导出到文件" },
    ],
    cancelButton: true,
  })

  if (index === 0) return "photos"
  if (index === 1) return "files"
  return null
}

export async function saveResult(download: DownloadSuccess, mode: Exclude<SaveMode, "ask">) {
  const files = download.files?.length ? download.files : [{
    filePath: download.filePath,
    fileName: download.fileName,
    finalURL: download.finalURL,
    bytesWritten: download.bytesWritten,
    mediaType: download.mediaType || "video",
  }]

  if (mode === "photos") {
    await saveDownloadedFilesToPhotos(files)
    return {
      mode,
      message: `已保存到相册：${files.length > 1 ? `${files.length} 个文件` : download.fileName}`,
    }
  }

  const exported = await exportDownloadedFilesToFiles(files)
  return {
    mode,
    message: `已导出文件：${exported.join(", ")}`,
  }
}
