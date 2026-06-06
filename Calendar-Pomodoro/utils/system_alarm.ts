import {
  UNLIMITED_ALARM_SYSTEM_SECONDS,
  UNLIMITED_COUNTDOWN_SECONDS,
} from "../constants"
import {
  CancelPomodoroTimerIntent,
  StopPomodoroTimerIntent,
} from "../app_intents"
import type { Task } from "../types"

const ALARM_SOURCE = "calendar-pomodoro"
const ALARM_LIVE_ACTIVITY_NAME = "CalendarPomodoroAlarmActivity"

function newAlarmId(taskId: string): string {
  const uuid = (globalThis as any).UUID
  if (typeof uuid?.string === "function") return uuid.string()
  throw new Error(`UUID 不可用，无法创建系统倒计时：${taskId}`)
}

function countdownSecondsForTask(task: Task, durationSeconds?: number): number {
  if (durationSeconds && durationSeconds > 0) {
    return Math.max(1, Math.floor(durationSeconds))
  }
  const seconds = task.unlimited
    ? UNLIMITED_ALARM_SYSTEM_SECONDS
    : Number(task.countdownSeconds ?? 0)
  return Math.max(1, Math.floor(seconds || UNLIMITED_COUNTDOWN_SECONDS))
}

function buildAlarmAttributes(
  task: Task,
  alarmId: string,
  options?: {
    durationSeconds?: number
    startedAtMs?: number
  },
): AlarmManager.Attributes {
  const stopButton = AlarmManager.Button.create({
    title: "停止",
    textColor: "#FFFFFF",
    systemImageName: "stop.fill",
  })
  const pauseButton = AlarmManager.Button.create({
    title: "暂停",
    textColor: "#FFFFFF",
    systemImageName: "pause.fill",
  })
  const resumeButton = AlarmManager.Button.create({
    title: "继续",
    textColor: "#FFFFFF",
    systemImageName: "play.fill",
  })

  const duration = countdownSecondsForTask(task, options?.durationSeconds)
  const attributes = AlarmManager.Attributes.create({
    alert: AlarmManager.AlertPresentation.create({
      title: task.name,
      stopButton,
    }),
    countdown: AlarmManager.CountdownPresentation.create(
      task.unlimited ? `${task.name} · 不限时` : task.name,
      pauseButton,
    ),
    paused: AlarmManager.PausedPresentation.create(
      `${task.name} · 已暂停`,
      resumeButton,
    ),
    tintColor: task.unlimited ? "#AF52DE" : "#FF9500",
    metadata: {
      source: ALARM_SOURCE,
      alarmId,
      taskId: task.id,
      title: task.name,
      calendarTitle: task.calendarTitle,
      startAt: String(options?.startedAtMs ?? Date.now()),
      duration: String(duration),
      unlimited: String(Boolean(task.unlimited)),
    },
    liveActivity: {
      name: ALARM_LIVE_ACTIVITY_NAME,
    },
  })

  if (!attributes) throw new Error("AlarmManager 展示属性创建失败")
  return attributes
}

function buildCountdownConfiguration(
  task: Task,
  alarmId: string,
  options?: {
    durationSeconds?: number
    startedAtMs?: number
  },
): AlarmManager.Configuration {
  const duration = countdownSecondsForTask(task, options?.durationSeconds)
  const configuration = AlarmManager.Configuration.timer({
    duration,
    attributes: buildAlarmAttributes(task, alarmId, options),
    sound: AlarmManager.Sound.default(),
    stopIntent: StopPomodoroTimerIntent({ alarmId }) as any,
    secondaryIntent: CancelPomodoroTimerIntent({ alarmId }) as any,
  })
  if (!configuration) throw new Error("AlarmManager 倒计时配置创建失败")
  return configuration
}

export async function startPomodoroAlarm(
  task: Task,
  options?: {
    durationSeconds?: number
    startedAtMs?: number
  },
): Promise<string | null> {
  if (!AlarmManager.isAvailable) return null
  const alarmId = newAlarmId(task.id)
  await AlarmManager.schedule(alarmId, buildCountdownConfiguration(task, alarmId, options))
  return alarmId
}

export async function stopPomodoroAlarm(alarmId?: string | null) {
  if (!alarmId || !AlarmManager.isAvailable) return
  try {
    const alarms = await AlarmManager.alarms()
    const alarm = alarms.find((item) => item.id === alarmId)
    if (alarm?.state === "countdown" || alarm?.state === "paused" || alarm?.state === "alerting") {
      await AlarmManager.stop(alarmId)
      return
    }
    await AlarmManager.cancel(alarmId)
  } catch {
    // 系统侧可能已经清理，忽略即可。
  }
}

export async function cancelPomodoroAlarm(alarmId?: string | null) {
  if (!alarmId || !AlarmManager.isAvailable) return
  try {
    const alarms = await AlarmManager.alarms()
    const alarm = alarms.find((item) => item.id === alarmId)
    if (alarm?.state === "alerting") {
      await AlarmManager.stop(alarmId)
      return
    }
    await AlarmManager.cancel(alarmId)
  } catch {
    // 系统侧可能已经清理，忽略即可。
  }
}

export async function pausePomodoroAlarm(alarmId?: string | null) {
  if (!alarmId || !AlarmManager.isAvailable) return
  try {
    await AlarmManager.pause(alarmId)
  } catch {
    // ignore
  }
}

export async function resumePomodoroAlarm(alarmId?: string | null) {
  if (!alarmId || !AlarmManager.isAvailable) return
  try {
    await AlarmManager.resume(alarmId)
  } catch {
    // ignore
  }
}
