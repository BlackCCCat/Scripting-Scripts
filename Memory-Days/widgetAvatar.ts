import { Script, Path } from 'scripting'

const APP_FOLDER = '时光纪念数据'
const WIDGET_AVATARS_DIR = 'widget-avatars-v2'

// 缩略图最大边长（像素），覆盖放大后小组件头像在 @3x 屏幕下的像素需求
const WIDGET_MAX_PIXELS = 720
const WIDGET_JPEG_QUALITY = 0.9

function appDir(): string {
  return Path.join(Path.dirname(Path.dirname(Script.directory)), 'configs', APP_FOLDER)
}

function widgetAvatarsDir(): string {
  return `${appDir()}/${WIDGET_AVATARS_DIR}`
}

async function ensureWidgetAvatarsDir(): Promise<void> {
  if (!(await FileManager.exists(widgetAvatarsDir()))) {
    await FileManager.createDirectory(widgetAvatarsDir(), true)
  }
}

function widgetAvatarPath(sourcePath: string): string {
  const lastSlash = sourcePath.lastIndexOf('/')
  const name = lastSlash >= 0 ? sourcePath.slice(lastSlash + 1) : sourcePath
  return `${widgetAvatarsDir()}/${name}`
}

/**
 * 根据原头像路径生成/返回小组件专用缩略图路径。
 * 如果缩略图已存在则直接返回；否则读取原图并按比例压缩后缓存。
 */
export async function resolveWidgetAvatarPath(avatarPath: string | null): Promise<string | null> {
  if (!avatarPath) return null

  const destPath = widgetAvatarPath(avatarPath)
  if (await FileManager.exists(destPath)) {
    return destPath
  }

  return generateWidgetAvatar(avatarPath, destPath)
}

/**
 * 为指定原头像强制重新生成小组件缩略图。
 */
export async function saveWidgetAvatar(avatarPath: string): Promise<string | null> {
  const destPath = widgetAvatarPath(avatarPath)
  try {
    if (await FileManager.exists(destPath)) {
      await FileManager.remove(destPath)
    }
  } catch {
    // 忽略清理失败
  }
  return generateWidgetAvatar(avatarPath, destPath)
}

/**
 * 删除小组件头像缓存。
 */
export async function deleteWidgetAvatar(avatarPath: string | null): Promise<void> {
  if (!avatarPath) return
  try {
    const destPath = widgetAvatarPath(avatarPath)
    if (await FileManager.exists(destPath)) {
      await FileManager.remove(destPath)
    }
  } catch {
    // 忽略清理失败
  }
}

async function generateWidgetAvatar(sourcePath: string, destPath: string): Promise<string | null> {
  try {
    if (!(await FileManager.exists(sourcePath))) return null
    await ensureWidgetAvatarsDir()

    const image = UIImage.fromFile(sourcePath)
    if (!image) return null

    const maxSide = Math.max(image.width, image.height)

    // 尺寸已足够小则直接复制，避免重复压缩损失画质
    if (maxSide <= WIDGET_MAX_PIXELS) {
      const data = await FileManager.readAsData(sourcePath)
      await FileManager.writeAsData(destPath, data)
      return destPath
    }

    const scale = WIDGET_MAX_PIXELS / maxSide
    const thumb = image.preparingThumbnail({
      width: Math.round(image.width * scale),
      height: Math.round(image.height * scale)
    })

    const targetImage = thumb ?? image
    const data = targetImage.toJPEGData(WIDGET_JPEG_QUALITY)
    if (!data) return null

    await FileManager.writeAsData(destPath, data)
    return destPath
  } catch (err) {
    console.log('生成小组件头像失败:', sourcePath, err)
    return null
  }
}
