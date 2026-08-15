import { Path, Script } from "scripting"

export const SHARED_FONT_PARAMETER = "sharedFontToken"

const supportedExtensions = new Set([".ttf", ".otf"])
const stagedFontPattern = /^[0-9a-f-]{36}-.+\.(?:ttf|otf)$/i
const staleFontAgeMilliseconds = 24 * 60 * 60 * 1000

function inboxDirectory(): string {
  return Path.join(FileManager.appGroupDocumentsDirectory, "Fonts Installer", "Shared Fonts")
}

export async function removeExpiredStagedFonts(): Promise<void> {
  const directory = inboxDirectory()
  try {
    const paths = await FileManager.readDirectory(directory)
    const cutoff = Date.now() - staleFontAgeMilliseconds
    await Promise.all(paths.map(async path => {
      try {
        const stat = await FileManager.stat(path)
        if (stat.type === "file" && stat.modificationDate < cutoff) await FileManager.remove(path)
      } catch (error) {
        console.warn("无法清理过期字体副本", error)
      }
    }))
  } catch {
    // The inbox may not exist on the first share.
  }
}

export async function stageSharedFont(sourcePath: string): Promise<string> {
  if (!sourcePath) throw new Error("找不到分享的字体文件。")

  const extension = Path.extname(sourcePath).toLowerCase()
  if (!supportedExtensions.has(extension)) {
    throw new Error("只接受 .ttf 或 .otf 字体文件。")
  }

  const directory = inboxDirectory()
  await removeExpiredStagedFonts()
  await FileManager.createDirectory(directory, true)
  const token = `${UUID.string()}-${Path.basename(sourcePath)}`
  const destination = Path.join(directory, token)
  await FileManager.copyFile(sourcePath, destination)
  return token
}

export function sharedFontPathFromQuery(): string | null {
  const token = Script.queryParameters?.[SHARED_FONT_PARAMETER]
  return typeof token === "string" ? sharedFontPathFromToken(token) : null
}

export function sharedFontPathFromToken(token: string): string | null {
  if (typeof token !== "string" || !stagedFontPattern.test(token) || Path.basename(token) !== token) {
    return null
  }
  return Path.join(inboxDirectory(), token)
}

export async function removeStagedFont(path: string): Promise<void> {
  if (Path.normalize(Path.dirname(path)) !== Path.normalize(inboxDirectory())) return
  try {
    await FileManager.remove(path)
  } catch (error) {
    if (FileManager.existsSync(path)) throw error
  }
}
