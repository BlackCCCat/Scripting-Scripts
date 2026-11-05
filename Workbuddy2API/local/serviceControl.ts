export const SERVICE_ACTIVITY_NAME = "WorkBuddy2APIService"
export type ServiceActivityState = { runId: string; port: number; lan: boolean; keptAlive: boolean }
export type ServiceActivityRef = { activityId: string; state: ServiceActivityState }

const ACTIVITY_KEY = "wb2api.local.service-activity-control"
const STOP_KEY = "wb2api.local.service-stop-request"
const shared = { shared: true }

export function serviceActivityRef(): ServiceActivityRef | null {
  const value = Storage.get<ServiceActivityRef>(ACTIVITY_KEY, shared)
  return value && typeof value.activityId === "string" && typeof value.state?.runId === "string" ? value : null
}
export function saveServiceActivityRef(activityId: string, state: ServiceActivityState) {
  if (!Storage.set(ACTIVITY_KEY, { activityId, state }, shared)) throw new Error("实时活动控制信息保存失败")
}
export function clearServiceActivityRef(activityId: string) {
  if (serviceActivityRef()?.activityId === activityId) Storage.remove(ACTIVITY_KEY, shared)
}

export function pendingStopId(): string | null { return Storage.get<string>(STOP_KEY, shared) }
export function requestStopOnNextRun(runId: string) {
  if (!Storage.set(STOP_KEY, runId, shared)) throw new Error("停止请求保存失败")
}
export function clearPendingStop(runId: string) {
  if (pendingStopId() === runId) Storage.remove(STOP_KEY, shared)
}
