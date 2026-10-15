import { Path, Script } from "scripting"

const SUPPRESS_NOTICE_KEY = "FileStore_suppress_missing_npm_notice"

export async function checkNpmDependencies(): Promise<void> {
  if (Storage.get<boolean>(SUPPRESS_NOTICE_KEY)) return

  const packageJSON = JSON.parse(await FileManager.readAsString(Path.join(Script.directory, "package.json"))) as {
    dependencies?: Record<string, string>
  }
  const missing = Object.keys(packageJSON.dependencies ?? {}).filter((name) => {
    try {
      require(name)
      return false
    } catch {
      return true
    }
  })

  if (missing.length === 0) return

  const suppress = await Dialog.confirm({
    title: "缺少运行依赖",
    message: `FileStore 缺少 ${missing.join(", ")}。请在 Scripting 的 FileStore 项目中安装 package.json 声明的依赖。`,
    cancelLabel: "知道了",
    confirmLabel: "不再提示",
  })
  if (suppress) Storage.set(SUPPRESS_NOTICE_KEY, true)
}
