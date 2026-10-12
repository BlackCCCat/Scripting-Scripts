import { Intent, Navigation, Path, Script } from "scripting"
import { inspectFontFileVariants, type FontInfo } from "./font"
import { removeBookmarksForSharedFont } from "./shared-font"
import { SharedFontInstallView } from "./shared-install-view"

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

async function inspectSharedFont(sourcePath: string, destination: string): Promise<FontInfo[]> {
  await FileManager.copyFile(sourcePath, destination)
  const inspected = await inspectFontFileVariants(destination)
  return inspected.map(({ info }) => ({
    ...info,
    path: sourcePath,
    fileName: Path.basename(sourcePath),
  }))
}

async function run() {
  let sourcePath: string | null = null
  let previewDirectory: string | null = null
  let failureMessage: string | null = null

  try {
    if (Intent.fileURLsParameter && Intent.fileURLsParameter.length > 1) {
      throw new Error("一次只能安装一个字体文件。")
    }

    sourcePath = resolveFontPath()
    if (!sourcePath) {
      throw new Error("请提供一个 .ttf 或 .otf 字体文件；其他输入类型不会被处理。")
    }

    previewDirectory = Path.join(FileManager.temporaryDirectory, `fonts-installer-preview-${UUID.string()}`)
    const fontFileName = `font${Path.extname(sourcePath).toLowerCase()}`
    await FileManager.createDirectory(previewDirectory, true)
    const fonts = await inspectSharedFont(sourcePath, Path.join(previewDirectory, fontFileName))
    try {
      removeBookmarksForSharedFont(sourcePath)
    } catch (error) {
      console.warn("无法清理分享字体的文件书签", error)
    }
    DocumentPicker.stopAcessingSecurityScopedResources()
    sourcePath = null
    await Navigation.present({
      element: <SharedFontInstallView
        fonts={fonts}
        previewDirectory={previewDirectory}
        fontFileName={fontFileName}
      />,
    })
  } catch (error) {
    failureMessage = `无法打开字体：${errorMessage(error)}`
  } finally {
    if (previewDirectory) {
      try {
        await FileManager.remove(previewDirectory)
      } catch (error) {
        console.warn("无法清理分享预览的临时文件", error)
      }
    }
    if (sourcePath) {
      try {
        removeBookmarksForSharedFont(sourcePath)
      } catch (error) {
        console.warn("无法清理分享字体的文件书签", error)
      }
      DocumentPicker.stopAcessingSecurityScopedResources()
    }
  }
  if (failureMessage) {
    try {
      await Dialog.alert({ title: "无法打开字体", message: failureMessage })
    } catch (error) {
      console.warn("无法显示字体错误", error)
    }
  }
  Script.exit(failureMessage ? Intent.text(failureMessage) : undefined)
}

run()
