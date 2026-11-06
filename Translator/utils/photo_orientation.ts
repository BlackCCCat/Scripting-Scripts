const MAX_IMAGE_DIMENSION = 2000
const OCR_OPTIONS: RecognizeTextOptions = {
  recognitionLevel: "accurate",
  usesLanguageCorrection: true,
  minimumTextHeight: 0.01,
}

type Recognition = Awaited<ReturnType<typeof Vision.recognizeText>>

export function preparePhotoImage(image: UIImage) {
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height))
  const size = {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  }

  if (image.imageOrientation !== "up" && image.imageOrientation !== "unknown") {
    const normalized = image.renderedIn(size)
    if (!normalized) throw new Error("无法校正图片方向。")
    return normalized
  }

  return scale < 1 ? image.preparingThumbnail(size) ?? image : image
}

function recognitionScore(result: Recognition) {
  return result.candidates.reduce((score, item) => {
    const length = item.content.trim().length
    return score + Math.min(length, 120) * Math.max(0, Math.min(1, item.confidence))
  }, 0)
}

function rotationAngles(orientation?: Device.Orientation) {
  if (orientation === "portraitUpsideDown") return [180, 90, 270]
  if (orientation === "landscapeRight") return [270, 90, 180]
  return [90, 270, 180]
}

function cropToPreview(image: UIImage, result: Recognition, aspect: number) {
  if (!Number.isFinite(aspect) || aspect <= 0) return { image, result }
  const { width, height } = image
  const cropWidth = Math.min(width, height * aspect)
  const cropHeight = Math.min(height, width / aspect)
  if (Math.abs(cropWidth - width) < 1 && Math.abs(cropHeight - height) < 1) return { image, result }
  const x = (width - cropWidth) / 2
  const y = (height - cropHeight) / 2
  const cropped = image.croppedTo({ x, y, width: cropWidth, height: cropHeight })
  if (!cropped) return { image, result }
  const candidates = result.candidates.flatMap((candidate) => {
    const box = candidate.boundingBox
    const left = Math.max(0, (box.x * width - x) / cropWidth)
    const right = Math.min(1, ((box.x + box.width) * width - x) / cropWidth)
    const bottom = Math.max(0, (box.y * height - y) / cropHeight)
    const top = Math.min(1, ((box.y + box.height) * height - y) / cropHeight)
    return right > left && top > bottom
      ? [{ ...candidate, boundingBox: { x: left, y: bottom, width: right - left, height: top - bottom } }]
      : []
  })
  return { image: cropped, result: { ...result, candidates } }
}

export async function recognizePhotoText(
  image: UIImage,
  options: {
    orientation?: Device.Orientation
    previewAspect?: number
    outputRotation?: number
    isCurrent?: () => boolean
  } = {}
) {
  const { orientation, previewAspect, outputRotation, isCurrent = () => true } = options
  const matchesPreview = (candidate: UIImage) => previewAspect == null ||
    Math.abs(candidate.width - candidate.height) < 1 ||
    (candidate.width >= candidate.height) === (previewAspect >= 1)
  const finish = (candidate: UIImage, result: Recognition) => previewAspect == null
    ? { image: candidate, result }
    : cropToPreview(candidate, result, previewAspect)
  const connectionAngle = outputRotation == null ? null : ((outputRotation % 360) + 360) % 360
  if (previewAspect != null && !matchesPreview(image) && connectionAngle != null) {
    const correction = Math.abs(connectionAngle - 90) < 1 ? 270
      : Math.abs(connectionAngle - 270) < 1 ? 90 : null
    if (correction != null) {
      const corrected = image.rotated(correction)
      const result = await Vision.recognizeText(corrected, OCR_OPTIONS)
      return finish(corrected, result)
    }
  }
  let bestImage = image
  let bestResult = await Vision.recognizeText(image, OCR_OPTIONS)
  let bestScore = matchesPreview(image) ? recognitionScore(bestResult) : -Infinity
  const characterCount = bestResult.candidates.reduce((count, item) => count + item.content.trim().length, 0)

  const sidewaysCapture = orientation === "landscapeLeft" || orientation === "landscapeRight" || orientation === "portraitUpsideDown"
  // The screen direction wins over device orientation, which can stay portrait when rotation lock is on.
  if (matchesPreview(image) && !sidewaysCapture && characterCount >= 24 && bestScore / characterCount >= 0.75) {
    return finish(bestImage, bestResult)
  }

  for (const angle of rotationAngles(orientation)) {
    if (!isCurrent()) break
    try {
      const rotated = image.rotated(angle)
      if (!matchesPreview(rotated)) continue
      const result = await Vision.recognizeText(rotated, OCR_OPTIONS)
      const score = recognitionScore(result)
      if (score > bestScore * 1.15) {
        bestImage = rotated
        bestResult = result
        bestScore = score
      }
    } catch {
      break
    }
  }

  return finish(bestImage, bestResult)
}
