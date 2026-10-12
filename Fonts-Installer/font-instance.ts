import { Path, Script } from "scripting"
import { inspectFontData, type InspectedFont } from "./font"

export async function prepareFontForInstall(selected: InspectedFont): Promise<InspectedFont> {
  if (!selected.info.variation) return selected

  if (typeof Python === "undefined" || typeof Python.run !== "function") {
    throw new Error("安装可变字体的单独字重需要支持 Python.run 的新版 Scripting。")
  }

  const directory = Path.join(FileManager.temporaryDirectory, `fonts-installer-${UUID.string()}`)
  const extension = selected.info.format === "OpenType" ? ".otf" : ".ttf"
  const source = Path.join(directory, `source${extension}`)
  const destination = Path.join(directory, `instance${extension}`)
  try {
    await FileManager.createDirectory(directory, true)
    await FileManager.writeAsData(source, selected.data)
    const result = await Python.run(
      'import os, runpy; runpy.run_path(os.path.join(os.environ["FONT_INSTALLER_SCRIPT_DIR"], "font-instance.py"))',
      { env: {
        FONT_INSTALLER_SCRIPT_DIR: Script.directory,
        FONT_INSTALLER_INPUT: source,
        FONT_INSTALLER_OUTPUT: destination,
        FONT_INSTALLER_AXES: JSON.stringify(selected.info.variation.axes),
        FONT_INSTALLER_FAMILY: selected.info.familyName,
        FONT_INSTALLER_STYLE: selected.info.styleName,
        FONT_INSTALLER_FULL_NAME: selected.info.fullName,
        FONT_INSTALLER_POSTSCRIPT: selected.info.postScriptName,
      } },
    )
    if (result.exitCode !== 0 || !FileManager.existsSync(destination)) {
      throw new Error(`生成独立字重失败：${result.output.trim() || "字体无法实例化"}`)
    }
    const data = await FileManager.readAsData(destination)
    const info = inspectFontData(destination, data)
    return {
      data,
      info: {
        ...info,
        path: selected.info.path,
        fileName: selected.info.fileName,
        familyName: selected.info.familyName,
        styleName: selected.info.styleName,
        fullName: selected.info.fullName,
      },
    }
  } finally {
    try {
      await FileManager.remove(directory)
    } catch (error) {
      console.warn("无法清理字体实例临时文件", error)
    }
  }
}
