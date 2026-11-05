import { LiveActivity, Navigation, Script } from "scripting"
import { currentServiceRunId, gatewayState, restoreGateway, stopGateway } from "./local/gateway"
import { forgetEndedServiceActivity } from "./local/serviceActivity"
import { clearPendingStop, pendingStopId, serviceActivityRef } from "./local/serviceControl"
import { migrateCredentialKeys } from "./local/store"
import { App } from "./ui/App"

async function run() {
  let exiting = false
  const exitAfterActivityEnds = async (runId: string, activityId: string) => {
    const currentRun = currentServiceRunId()
    if (exiting || pendingStopId() !== runId || currentRun && currentRun !== runId) return
    exiting = true
    try {
      forgetEndedServiceActivity(activityId)
      await stopGateway()
      clearPendingStop(runId)
    } catch (error) { console.error("HTTP 服务停止时清理失败", error) }
    finally {
      LiveActivity.removeActivityUpdateListener(onActivityUpdate)
      Script.exit()
    }
  }
  const onActivityUpdate = (detail: { id: string; state: string }) => {
    const ref = serviceActivityRef()
    if (ref?.activityId === detail.id && pendingStopId() === ref.state.runId &&
      (detail.state === "ended" || detail.state === "dismissed"))
      void exitAfterActivityEnds(ref.state.runId, detail.id)
  }
  const checkPendingStop = async (): Promise<boolean> => {
    const pending = pendingStopId()
    const ref = serviceActivityRef()
    const currentRun = currentServiceRunId()
    if (!pending || ref?.state.runId !== pending || currentRun && currentRun !== pending) return false
    const state = await LiveActivity.getActivityState(ref.activityId)
    if (state === "ended" || state === "dismissed") await exitAfterActivityEnds(pending, ref.activityId)
    return true
  }
  LiveActivity.addActivityUpdateListener(onActivityUpdate)
  try {
    const migration = migrateCredentialKeys()
    if (migration.failed) await Dialog.alert({ title: "钥匙串迁移未完成", message: `${migration.failed} 条旧凭据未能清理，请检查 Scripting 的钥匙串权限。` })
    Script.onResume(() => { void (async () => {
      if (await checkPendingStop()) return
      await restoreGateway()
      if (Script.supportsMinimization()) Script.enableMinimize(gatewayState().running)
    })() })
    if (!await checkPendingStop()) await restoreGateway()
    if (Script.supportsMinimization()) Script.enableMinimize(gatewayState().running)
    await Navigation.present(<App />)
  } finally {
    LiveActivity.removeActivityUpdateListener(onActivityUpdate)
    try { await stopGateway() }
    finally { Script.exit() }
  }
}

void run()
