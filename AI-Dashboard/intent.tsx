import { Intent, Script } from "scripting"
import { refreshAllAccountsFromBackground } from "./services/refresh_service"

async function run() {
  try {
    const summary = await refreshAllAccountsFromBackground()
    Script.exit(
      Intent.text(
        `已刷新 ${summary.succeeded} 个账号，失败 ${summary.failed} 个。`
      )
    )
  } catch {
    Script.exit(Intent.text("刷新失败"))
  }
}

void run()
