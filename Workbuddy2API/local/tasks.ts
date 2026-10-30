import { completeChat } from "./chat"
import { credential } from "./store"
import { acceptTask, adoptFirstBuddy, claimTask, listTasks, reportChatActivity, type GrowthTask } from "./upstream"

const automated = new Set(["chat_5", "first_buddy", "Model_chat_GLM5.2"])
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
export type TaskOutcome = { status: "done" | "pending"; message: string }
export type TaskRunEntry = { uid: string; code: string; title: string; status: "done" | "pending" | "skipped" | "failed"; message: string }

export function taskAction(task: GrowthTask): string {
  if (task.claimed) return "已领取"
  if (task.locked) return "未解锁"
  if (task.claimable && task.task_code !== "first_buddy") return "领取奖励"
  if (automated.has(task.task_code) && !task.miniprogram) return "推进并领奖"
  return ["accepted", "completed"].includes(task.accept_status) ? "等待进度" : "接受任务"
}

export function canProcessTask(task: GrowthTask, canWrite: boolean): boolean {
  return canWrite && !["等待进度", "已领取", "未解锁"].includes(taskAction(task))
}

export function canAutoProcessTask(task: GrowthTask, canWrite: boolean): boolean {
  return canWrite && !task.claimed && !task.locked &&
    ((task.claimable && task.task_code !== "first_buddy") || (automated.has(task.task_code) && !task.miniprogram))
}

export function taskUnavailableReason(task: GrowthTask, canWrite: boolean): string {
  if (!canWrite) return "国际区任务当前仅支持查询"
  if (task.locked) return "尚未解锁"
  if (task.claimed) return "已领取"
  if (task.accept_status === "completed") return "上游标记已完成，但进度未达领奖条件"
  return task.accept_status === "accepted" ? "已接受，当前脚本没有该任务的推进动作" : "尚未支持自动推进，可在账号详情单独接受"
}

export function showInTodayTasks(task: GrowthTask, day: string): boolean {
  return !task.claimed || [task.completedAt, task.claimedAt].some(time => time != null && new Date(time).toDateString() === day)
}

export async function processTask(uid: string, selected: GrowthTask): Promise<TaskOutcome> {
  const account = credential(uid)
  if (!account || account.site !== "cn" || account.enterpriseId) throw new Error("该账号任务只支持查看")
  let task = (await listTasks(uid)).find(item => item.task_code === selected.task_code)
  if (!task) throw new Error("任务已不在上游列表中")
  if (task.claimed) return { status: "done", message: "上游已确认领取" }
  if (task.locked) throw new Error("任务尚未解锁")
  if (task.claimable && task.task_code !== "first_buddy") {
    await claimTask(uid, task)
    return { status: "done", message: "上游已确认领奖请求" }
  }
  if (!["accepted", "completed"].includes(task.accept_status) && !["chat_5", "first_buddy"].includes(task.task_code)) {
    await acceptTask(uid, task)
    task = (await listTasks(uid)).find(item => item.task_code === task!.task_code)
    if (!task || !["accepted", "completed", "claimed"].includes(task.accept_status)) throw new Error("接受请求已发送，但上游未确认登记")
  }
  if (task.claimed) return { status: "done", message: "上游已确认领取" }
  if (!automated.has(task.task_code) || task.miniprogram) return { status: "pending", message: "已接受任务，等待上游记录进度" }

  if (task.task_code === "chat_5") {
    const count = Math.max(0, Math.min(5, (task.target || 5) - (task.current || 0)))
    for (let i = 0; i < count; i++) {
      await reportChatActivity(uid)
      if (i + 1 < count) await wait(1050)
    }
  } else if (task.task_code === "first_buddy") {
    await reportChatActivity(uid)
    await wait(1050)
    await adoptFirstBuddy(uid)
  } else {
    await completeChat({ model: "cn:glm-5.2", messages: [{ role: "user", content: "hi，请回复一句话" }], stream: false }, uid, "auxiliary")
    await wait(1050)
    await reportChatActivity(uid, "glm-5.2", "GLM-5.2")
  }

  for (let i = 0; i < 4; i++) {
    task = (await listTasks(uid)).find(item => item.task_code === selected.task_code)
    if (!task) throw new Error("动作已执行，但回读时任务消失")
    if (task.claimed) return { status: "done", message: "上游已确认领取" }
    if (task.claimable) {
      await claimTask(uid, task)
      return { status: "done", message: "任务已达标，领奖请求已确认" }
    }
    if (i < 3) await wait(3000)
  }
  return { status: "pending", message: "动作已发送，进度尚未入账，请稍后扫描确认" }
}

export async function runTaskBatch(uid: string, tasks: GrowthTask[], onEntry: (entry: TaskRunEntry) => void): Promise<void> {
  const account = credential(uid)
  if (!account) throw new Error("账号凭据不存在")
  const canWrite = account.site === "cn" && !account.enterpriseId
  const emit = (task: GrowthTask, status: TaskRunEntry["status"], message: string) => onEntry({ uid, code: task.task_code, title: task.title, status, message })
  const pending = tasks.filter(task => !task.claimed)
  const skipped = pending.filter(task => !canAutoProcessTask(task, canWrite))
  if (!canWrite) {
    for (const task of skipped) emit(task, "skipped", taskUnavailableReason(task, canWrite))
    return
  }
  const priority = (task: GrowthTask) => task.claimable && task.task_code !== "first_buddy" ? 0 : task.task_code === "first_buddy" ? 1 : 2
  const candidates = pending.filter(task => canAutoProcessTask(task, canWrite)).sort((a, b) => priority(a) - priority(b))
  const attempted = new Set<string>()
  async function run(task: GrowthTask) {
    attempted.add(task.task_code)
    try {
      const outcome = await processTask(uid, task)
      emit(task, outcome.status, outcome.message)
    } catch (error) { emit(task, "failed", error instanceof Error ? error.message : String(error)) }
  }
  for (const task of candidates) {
    await run(task)
  }
  try {
    const latest = await listTasks(uid)
    for (const task of latest) {
      if (task.claimable && task.task_code !== "first_buddy" && !attempted.has(task.task_code)) await run(task)
    }
  } finally {
    for (const task of skipped) {
      if (!attempted.has(task.task_code)) emit(task, "skipped", taskUnavailableReason(task, canWrite))
    }
  }
}
