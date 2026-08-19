const OCR_MAX_IMAGE_DIMENSION = 2200

async function ensureImageAvailable(path: string): Promise<void> {
  const fm = (globalThis as any).FileManager
  if (
    typeof fm?.isFileStoredIniCloud === "function" &&
    typeof fm?.isiCloudFileDownloaded === "function" &&
    typeof fm?.downloadFileFromiCloud === "function" &&
    fm.isFileStoredIniCloud(path) &&
    !fm.isiCloudFileDownloaded(path)
  ) {
    await fm.downloadFileFromiCloud(path)
  }
}

function imageForRecognition(image: UIImage): UIImage {
  const longestSide = Math.max(image.width, image.height)
  if (longestSide <= OCR_MAX_IMAGE_DIMENSION || typeof image.preparingThumbnail !== "function") {
    return image
  }
  const scale = OCR_MAX_IMAGE_DIMENSION / longestSide
  return image.preparingThumbnail({
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  }) ?? image
}

export async function recognizeTextFromImagePath(path?: string | null): Promise<string> {
  if (!path) throw new Error("图片文件不可读取")
  await ensureImageAvailable(path)
  const image = UIImage.fromFile(path)
  if (!image) throw new Error("图片文件不可读取")
  const vision = (globalThis as any).Vision
  if (typeof vision?.recognizeText !== "function") throw new Error("当前 Scripting 版本不支持 OCR")
  const result = await vision.recognizeText(imageForRecognition(image), {
    recognitionLevel: "accurate",
    recognitionLanguages: ["zh-Hans", "en"],
    usesLanguageCorrection: true,
  })
  return String(result.text ?? "").trim()
}
