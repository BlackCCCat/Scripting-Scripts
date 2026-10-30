import { LiveActivity } from "scripting"
import { SERVICE_ACTIVITY_NAME, ServiceLiveActivity, type ServiceActivityState } from "../live_activity"
import { clearServiceActivityRef, saveServiceActivityRef, serviceActivityRef } from "./serviceControl"

const ACTIVITY_ID = "wb2api.local.service-activity-id"
const RENDERER_VERSION = "wb2api.local.service-activity-renderer"
const CURRENT_RENDERER_VERSION = 10
let activity: LiveActivity<ServiceActivityState> | null = null
let dismissed = false

async function savedActivity(): Promise<LiveActivity<ServiceActivityState> | null> {
  if (activity) return activity
  const id = Storage.get<string>(ACTIVITY_ID) ?? serviceActivityRef()?.activityId
  if (!id) return null
  try { activity = await LiveActivity.from<ServiceActivityState>(id, SERVICE_ACTIVITY_NAME) }
  catch { activity = null }
  if (!activity) {
    const status = await LiveActivity.getActivityState(id)
    if (status === "dismissed" ||
      (status === "ended" || status === null) && !(await LiveActivity.getAllActivitiesIds()).includes(id)) {
      Storage.remove(ACTIVITY_ID)
      clearServiceActivityRef(id)
    }
  }
  return activity
}

export async function showServiceActivity(state: ServiceActivityState): Promise<boolean> {
  if (Storage.get<number>(RENDERER_VERSION) !== CURRENT_RENDERER_VERSION &&
    (Storage.get<string>(ACTIVITY_ID) || serviceActivityRef())) {
    if (!await endServiceActivity({ ...state, keptAlive: false })) throw new Error("旧版实时活动未能结束")
  }
  if (!await LiveActivity.areActivitiesEnabled()) return false
  const existing = await savedActivity()
  if (existing) {
    const status = await existing.getActivityState()
    if (status === "ended") {
      if (!await endServiceActivity({ ...state, keptAlive: false })) throw new Error("旧实时活动仍显示，暂时无法重新创建")
    } else if (status === "dismissed") {
      dismissed = true
      activity = null
      Storage.remove(ACTIVITY_ID)
      if (existing.activityId) clearServiceActivityRef(existing.activityId)
    } else {
      if (!await existing.update(state)) return false
      const id = existing.activityId ?? Storage.get<string>(ACTIVITY_ID)
      if (id) saveServiceActivityRef(id, state)
      return true
    }
  }
  if (dismissed || !state.keptAlive || Storage.get<string>(ACTIVITY_ID)) return false
  const next = ServiceLiveActivity()
  if (!await next.start(state)) return false
  activity = next
  const id = next.activityId
  if (!id || !Storage.set(ACTIVITY_ID, id)) {
    await next.end({ ...state, keptAlive: false }, { dismissTimeInterval: 0 })
    activity = null
    throw new Error("实时活动 ID 保存失败")
  }
  try { saveServiceActivityRef(id, state) }
  catch (error) {
    await next.end({ ...state, keptAlive: false }, { dismissTimeInterval: 0 })
    activity = null
    Storage.remove(ACTIVITY_ID)
    throw error
  }
  Storage.set(RENDERER_VERSION, CURRENT_RENDERER_VERSION)
  return true
}

export async function endServiceActivity(finalState: ServiceActivityState): Promise<boolean> {
  dismissed = false
  const id = Storage.get<string>(ACTIVITY_ID) ?? serviceActivityRef()?.activityId ?? activity?.activityId
  if (!id) return true
  const existing = await LiveActivity.from<ServiceActivityState>(id, SERVICE_ACTIVITY_NAME)
  if (existing) {
    const status = await existing.getActivityState()
    if (status !== "dismissed" &&
      !((status === "ended" || status === null) && !(await LiveActivity.getAllActivitiesIds()).includes(id))) {
      if (!await existing.end(finalState, { dismissTimeInterval: 0 })) return false
    }
  } else {
    const status = await LiveActivity.getActivityState(id)
    if (status !== "dismissed" &&
      (status === "active" || status === "stale" || (await LiveActivity.getAllActivitiesIds()).includes(id))) return false
  }
  activity = null
  Storage.remove(ACTIVITY_ID)
  clearServiceActivityRef(id)
  return true
}

