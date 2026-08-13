export const MAX_LAN_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024
export const MAX_LAN_IMAGE_PIXELS = 40_000_000

function headerValue(headers: Record<string, string>, name: string): string {
  const target = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target)
  return String(entry?.[1] ?? "")
}

export function imageFromUploadRequest(request: HttpRequest): UIImage {
  const requestType = headerValue(request.headers, "content-type").toLowerCase()
  if (!requestType.startsWith("image/")) throw new Error("文件不是图片")
  const data = request.body
  if (!data || data.size <= 0) throw new Error("请选择图片")
  if (data.size > MAX_LAN_IMAGE_UPLOAD_BYTES) throw new Error("图片不能超过 12 MB")

  const image = UIImage.fromData(data)
  if (!image) throw new Error("图片无法读取")
  const pixelWidth = Math.max(1, image.width * image.scale)
  const pixelHeight = Math.max(1, image.height * image.scale)
  if (pixelWidth * pixelHeight > MAX_LAN_IMAGE_PIXELS) {
    throw new Error("图片分辨率过高")
  }
  return image
}
