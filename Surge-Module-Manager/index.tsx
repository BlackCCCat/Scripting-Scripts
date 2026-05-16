import { Intent, Navigation, Script } from "scripting"
import { HomeView } from "./components/HomeView"
import { runShortcutUpdate } from "./utils/shortcut_update"

function hasShortcutInput(): boolean {
  return !!(
    Intent.shortcutParameter ||
    Intent.textsParameter?.length ||
    Intent.urlsParameter?.length ||
    Intent.fileURLsParameter?.length
  )
}

async function run() {
  if (hasShortcutInput()) {
    try {
      console.log("[Surge模块管理][Intent] handled by index.tsx")
      const result = await runShortcutUpdate({
        shortcutParameter: Intent.shortcutParameter,
        textsParameter: Intent.textsParameter,
      })
      Script.exit(Intent.text(result.text))
      return
    } catch (e: any) {
      const message = String(e?.stack ?? e?.message ?? e)
      console.log(`[Surge模块管理][Intent] index fatal: ${message}`)
      Script.exit(Intent.text(`Surge 模块更新失败：${message}`))
      return
    }
  }

  await Navigation.present({
    element: <HomeView />,
  })

  // 视图关闭后退出脚本（Scripting 推荐模式）
  Script.exit()
}

run()
