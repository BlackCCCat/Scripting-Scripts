import { LiveActivity, Navigation, Script } from "scripting"
import { currentServiceRunId, gatewayState, restoreGateway, stopGateway } from "./local/gateway"
import { forgetEndedServiceActivity } from "./local/serviceActivity"
import { clearPendingStop, pendingStopId, serviceActivityRef } from "./local/serviceControl"
import { credentialSyncEnabled, migrateCredentialKeys, setCredentialSyncEnabled } from "./local/store"
import { App } from "./ui/App"

// Script.onError 在旧版本不存在，注册失败时静默跳过，不影响启动
try {
  const scriptWithError = Script as typeof Script & { onError?: (handler: (error: any) => void) => void }
  if (typeof scriptWithError.onError === "function") scriptWithError.onError((error: any) => {
    const message = String(error?.message ?? error)
    // Scripting 运行时 fetch 桥接的已知问题：响应流被 cancel/error 后，原生 completion 仍会
    // 调用 controller.close()，这层异常在脚本侧无法捕获，单独归档避免与真实脚本错误混淆。
    const runtime = /^Stream is (?:closed or errored|errored)$/.test(message)
    if (runtime) console.warn("[Scripting runtime] " + message)
    const key = runtime ? "runtimeErrs" : "errs"
    const list = Storage.get(key) as string[] ?? []
    list.push([error, error?.name ?? "", error?.stack ?? ""].filter(Boolean).join("\n"))
    Storage.set(key, list.slice(-20))
  })
} catch { }

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
    try {
      if (credentialSyncEnabled()) await setCredentialSyncEnabled(true)
      const migration = migrateCredentialKeys()
      if (migration.failed) await Dialog.alert({ title: "钥匙串迁移未完成", message: `${migration.failed} 条凭据未能迁移或清理，请检查 iCloud 钥匙串状态。` })
    } catch (error) {
      await Dialog.alert({ title: "钥匙串暂不可用", message: error instanceof Error ? error.message : String(error) })
    }
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
