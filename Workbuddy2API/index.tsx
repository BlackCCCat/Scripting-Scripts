import { Navigation, Script } from "scripting"
import { currentServiceRunId, gatewayState, restoreGateway, stopGateway } from "./local/gateway"
import { clearMainSessionId, saveMainSessionId, serviceActivityRef } from "./local/serviceControl"
import { migrateCredentialKeys } from "./local/store"
import { App } from "./ui/App"

async function run() {
  let stopping = false
  const handlerId = ScriptSession.register(async message => {
    const command = message as { command?: string; runId?: string } | null
    if (!command || command.command !== "stop" || typeof command.runId !== "string" || !command.runId)
      return { ok: false, message: "无效的服务控制命令" }
    if (stopping) return { ok: false, message: "HTTP 服务正在关闭" }
    if (command.runId !== currentServiceRunId() && (gatewayState().running || serviceActivityRef()?.state.runId !== command.runId))
      return { ok: false, message: "这次 HTTP 服务已经结束" }
    stopping = true
    try {
      await stopGateway()
      if (Script.supportsMinimization()) Script.enableMinimize(false)
      return { ok: true, message: null }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    } finally { stopping = false }
  })
  try {
    saveMainSessionId(handlerId)
    const migration = migrateCredentialKeys()
    if (migration.failed) await Dialog.alert({ title: "钥匙串迁移未完成", message: `${migration.failed} 条旧凭据未能清理，请检查 Scripting 的钥匙串权限。` })
    Script.onResume(() => { void restoreGateway().then(() => { if (Script.supportsMinimization()) Script.enableMinimize(gatewayState().running) }) })
    await restoreGateway()
    if (Script.supportsMinimization()) Script.enableMinimize(gatewayState().running)
    await Navigation.present(<App />)
  } finally {
    try { await stopGateway() }
    finally { ScriptSession.unregister(handlerId); clearMainSessionId(handlerId); Script.exit() }
  }
}

void run()
