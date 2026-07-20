import { deleteAvatar, saveAvatar } from './storage'
import { saveWidgetAvatar } from './widgetAvatar'

export const MEDIUM_PHOTO_ASPECT = 188 / 158

export interface PhotoCropOptions {
  zoom: number
  x: number
  y: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function cropImageToAspect(image: UIImage, aspectRatio: number, options?: PhotoCropOptions): UIImage {
  const width = image.width
  const height = image.height
  if (!width || !height || aspectRatio <= 0) return image

  const currentRatio = width / height
  const zoom = clamp(options?.zoom ?? 1, 1, 3)
  const xFocus = clamp(options?.x ?? 0.5, 0, 1)
  const yFocus = clamp(options?.y ?? 0.5, 0, 1)

  let cropWidth = width
  let cropHeight = height
  if (currentRatio > aspectRatio) {
    cropWidth = height * aspectRatio
  } else if (currentRatio < aspectRatio) {
    cropHeight = width / aspectRatio
  }

  cropWidth = cropWidth / zoom
  cropHeight = cropHeight / zoom
  const x = Math.max(0, (width - cropWidth) * xFocus)
  const y = Math.max(0, (height - cropHeight) * yFocus)
  return image.croppedTo({ x, y, width: cropWidth, height: cropHeight }) ?? image
}

export async function saveCroppedPhoto(image: UIImage, aspectRatio = MEDIUM_PHOTO_ASPECT, options?: PhotoCropOptions): Promise<string | null> {
  const cropped = cropImageToAspect(image, aspectRatio, options)
  const data = cropped.toJPEGData(0.9)
  if (!data) return null
  const path = await saveAvatar(data)
  await saveWidgetAvatar(path)
  return path
}

export async function replaceDraftPhoto(
  nextPath: string | null,
  currentPath: string | null,
  originalPath: string | null
): Promise<string | null> {
  if (nextPath && currentPath && currentPath !== originalPath && currentPath !== nextPath) {
    await deleteAvatar(currentPath)
  }
  return nextPath
}
