import { Intent, Script } from "scripting"
import {
  removeBookmarksForSharedFont,
  removeStagedFont,
  SHARED_FONT_PARAMETER,
  sharedFontPathFromToken,
  stageSharedFont,
} from "./shared-font"

function resolveFontPath(): string | null {
  if (Intent.fileURLsParameter?.length === 1) return Intent.fileURLsParameter[0]

  const parameter = Intent.shortcutParameter
  if (parameter?.type === "fileURL" && typeof parameter.value === "string") {
    return parameter.value
  }
  return null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function run() {
  let stagedPath: string | null = null
  let sourcePath: string | null = null
  let sourceAccessReleased = false
  let failureMessage: string | null = null

  try {
    if (Intent.fileURLsParameter && Intent.fileURLsParameter.length > 1) {
      throw new Error("一次只能安装一个字体文件。")
    }

    sourcePath = resolveFontPath()
    if (!sourcePath) {
      throw new Error("请提供一个 .ttf 或 .otf 字体文件；其他输入类型不会被处理。")
    }

    const token = await stageSharedFont(sourcePath)
    stagedPath = sharedFontPathFromToken(token)
    if (!stagedPath) throw new Error("无法准备分享的字体文件。")

    try {
      removeBookmarksForSharedFont(sourcePath)
    } catch (error) {
      console.warn("无法清理分享字体的文件书签", error)
    }
    DocumentPicker.stopAcessingSecurityScopedResources()
    sourceAccessReleased = true

    const url = Script.createRunSingleURLScheme(Script.name, {
      [SHARED_FONT_PARAMETER]: token,
    })
    const opened = await Safari.openURL(url)
    if (!opened) throw new Error("系统未能打开 Fonts Installer。")

    stagedPath = null
  } catch (error) {
    if (stagedPath) {
      try {
        await removeStagedFont(stagedPath)
      } catch (cleanupError) {
        console.warn("无法清理分享的字体副本", cleanupError)
      }
    }
    failureMessage = `无法打开字体：${errorMessage(error)}`
  } finally {
    if (!sourceAccessReleased) {
      if (sourcePath) {
        try {
          removeBookmarksForSharedFont(sourcePath)
        } catch (error) {
          console.warn("无法清理分享字体的文件书签", error)
        }
      }
      DocumentPicker.stopAcessingSecurityScopedResources()
    }
  }

  if (failureMessage) {
    Script.exit(Intent.text(failureMessage))
    return
  }
  Script.exit()
}

run()
