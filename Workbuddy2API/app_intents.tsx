import { AppIntentManager, AppIntentProtocol, LiveActivity } from "scripting"
import { clearPendingStop, requestStopOnNextRun, serviceActivityRef, SERVICE_ACTIVITY_NAME, type ServiceActivityState } from "./local/serviceControl"

export const StopServiceIntent = AppIntentManager.register({
  name: "WorkBuddy2APIStopServiceV6",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async ({ runId }: { runId: string }) => {
    const ref = serviceActivityRef()
    if (!runId || !ref || ref.state.runId !== runId) throw new Error("这次 HTTP 服务已经结束")
    const activity = await LiveActivity.from<ServiceActivityState>(ref.activityId, SERVICE_ACTIVITY_NAME)
    if (!activity) throw new Error("找不到实时活动，请打开脚本关闭服务")

    requestStopOnNextRun(runId)
    try {
      const state = await activity.getActivityState()
      if (state !== "ended" && state !== "dismissed" &&
        !await activity.end({ ...ref.state, keptAlive: false }, { dismissTimeInterval: 0 }))
        throw new Error("实时活动结束失败")
      // The main script observes the ended/dismissed state, then stops HTTP and exits.
    } catch (error) {
      clearPendingStop(runId)
      throw error
    }
  },
})
