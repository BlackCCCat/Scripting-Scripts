import { AppIntentManager, AppIntentProtocol, LiveActivity } from "scripting"
import { clearMainSessionId, clearServiceActivityRef, mainSessionId, requestStopOnNextRun,
  serviceActivityRef, SERVICE_ACTIVITY_NAME, type ServiceActivityRef, type ServiceActivityState } from "./local/serviceControl"

type StopReply = { ok: boolean; message: string | null }

async function endActivity(ref: ServiceActivityRef) {
  const activity = await LiveActivity.from<ServiceActivityState>(ref.activityId, SERVICE_ACTIVITY_NAME)
  if (!activity) {
    const state = await LiveActivity.getActivityState(ref.activityId)
    if (state !== "dismissed" &&
      (state === "active" || state === "stale" || (await LiveActivity.getAllActivitiesIds()).includes(ref.activityId)))
      throw new Error("找不到可操作的实时活动，请打开脚本重试")
  } else {
    const state = await activity.getActivityState()
    if (state !== "dismissed" &&
      !((state === "ended" || state === null) && !(await LiveActivity.getAllActivitiesIds()).includes(ref.activityId)))
      if (!await activity.end({ ...ref.state, keptAlive: false }, { dismissTimeInterval: 0 }))
        throw new Error("实时活动结束失败，请打开脚本重试")
  }
  clearServiceActivityRef(ref.activityId)
}

export const StopServiceIntent = AppIntentManager.register({
  name: "WorkBuddy2APIStopServiceV5",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async ({ runId }: { runId: string }) => {
    if (typeof runId !== "string" || !runId) throw new Error("无效的服务控制命令")
    const ref = serviceActivityRef()
    if (ref && ref.state.runId !== runId) return
    const sessionId = mainSessionId()
    if (sessionId) {
      let reply: StopReply | null = null
      try { reply = await ScriptSession.request<StopReply>(sessionId, { command: "stop", runId }, { timeout: 30_000 }) }
      catch (error) {
        const code = String((error as { code?: string })?.code ?? "")
        const latest = serviceActivityRef()
        if (code === "SCRIPT_SESSION_TIMEOUT" && latest?.state.runId === runId && latest.httpStopped) {
          await endActivity(latest)
          return
        }
        if (!/^SCRIPT_SESSION_(NOT_FOUND|CLOSED|UNAVAILABLE|INVALID_HANDLER)$/.test(code)) throw error
        clearMainSessionId(sessionId)
      }
      if (reply?.ok) return
      if (reply) {
        const latest = serviceActivityRef()
        if (latest?.state.runId !== runId || !latest.httpStopped) throw new Error(reply.message ?? "HTTP 服务关闭失败")
        await endActivity(latest)
        return
      }
    }
    // 主脚本已退出时端口也已关闭；清理残留活动并阻止下次运行自动重启。
    if (!ref) throw new Error("未找到实时活动控制信息，请打开脚本重试")
    requestStopOnNextRun(runId)
    await endActivity(ref)
  },
})
