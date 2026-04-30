import { Intent, Script } from "scripting"

import { runShortcutUpdate } from "./utils/shortcut_update"

;(async () => {
  try {
    const result = await runShortcutUpdate({
      shortcutParameter: Intent.shortcutParameter,
      textsParameter: Intent.textsParameter,
    })
    Script.exit(Intent.text(result.text))
  } catch (e: any) {
    const message = String(e?.stack ?? e?.message ?? e)
    console.log(`[Surge模块管理][Intent] fatal: ${message}`)
    Script.exit(Intent.text(`Surge 模块更新失败：${message}`))
  }
})()
