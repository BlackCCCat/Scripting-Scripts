import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

import { UNLIMITED_COUNTDOWN_SECONDS } from "./constants"
import type { Task } from "./types"
import {
  clearSession,
  loadSession,
  type TimerSession,
  type TimerSessionSegment,
} from "./utils/session"
import { loadTasks, saveTasks } from "./utils/storage"
import { formatDateTime, formatDuration } from "./utils/time"

type PomodoroAlarmIntentParams = {
  alarmId: string
}

function appendCompletedSegment(
  base: TimerSessionSegment[],
  startAtMs: number | undefined,
  endAtMs: number,
): TimerSessionSegment[] {
  if (!startAtMs || endAtMs <= startAtMs) return base
  return [...base, { startAt: startAtMs, endAt: endAtMs }]
}

async function stopSystemAlarm(alarmId: string) {
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
    // 系统闹钟可能已经被系统侧移除，忽略即可。
  }
}

async function resolveCalendar(task: Task): Promise<Calendar | null> {
  try {
    const calendars = await Calendar.forEvents()
    return calendars.find((cal) => cal.identifier === task.calendarId) ?? null
  } catch {
    return null
  }
}

function buildFinalSegments(
  session: TimerSession,
  task: Task,
  endAtMs: number,
): { total: number; segments: TimerSessionSegment[] } {
  const segmentElapsed =
    session.running && session.segmentStartAt
      ? Math.max(0, endAtMs - session.segmentStartAt)
      : 0
  const rawTotal = session.accumulatedMs + segmentElapsed
  const countdownMs =
    (task.countdownSeconds ?? UNLIMITED_COUNTDOWN_SECONDS) * 1000
  const total = task.unlimited ? rawTotal : Math.min(rawTotal, countdownMs)
  const overflowMs = Math.max(0, rawTotal - total)
  let segments = session.segments ?? []

  if (session.running && session.segmentStartAt) {
    segments = appendCompletedSegment(
      segments,
      session.segmentStartAt,
      endAtMs - overflowMs,
    )
  }
  if (!segments.length && total > 0) {
    segments = appendCompletedSegment(
      [],
      session.sessionStartAt,
      session.sessionStartAt + total,
    )
  }

  return { total, segments }
}

async function clearTaskNoteDraft(tasks: Task[], taskId: string) {
  await saveTasks(tasks.map((task) => (
    task.id === taskId ? { ...task, noteDraft: "" } : task
  )))
}

async function saveSessionToCalendar() {
  const session = await loadSession()
  if (!session) return

  const tasks = await loadTasks()
  const task = tasks.find((item) => item.id === session.taskId)
  if (!task) {
    await clearSession()
    return
  }

  const calendar = await resolveCalendar(task)
  if (!calendar || !calendar.allowsContentModifications) return

  const nowMs = Date.now()
  const { total, segments } = buildFinalSegments(session, task, nowMs)
  if (!segments.length || total <= 0) {
    await clearSession()
    await clearTaskNoteDraft(tasks, task.id)
    return
  }

  const overallStartAt = segments[0]?.startAt ?? session.sessionStartAt
  const overallEndAt = segments[segments.length - 1]?.endAt ?? nowMs
  const trimmedNote = (task.noteDraft ?? "").trim()
  const notePrefix = trimmedNote ? `${trimmedNote}\n\n` : ""
  const summaryText = [
    `开始：${formatDateTime(new Date(overallStartAt))}`,
    `结束：${formatDateTime(new Date(overallEndAt))}`,
    `累计有效时长：${formatDuration(total)}`,
  ].join("\n")

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (!segment || segment.endAt <= segment.startAt) continue
    const startDate = new Date(segment.startAt)
    const endDate = new Date(segment.endAt)
    const event = new CalendarEvent()
    event.title = task.name
    event.calendar = calendar
    event.startDate = startDate
    event.endDate = endDate
    event.notes = `${notePrefix}分段：${index + 1}/${segments.length}\n开始：${formatDateTime(startDate)}\n结束：${formatDateTime(endDate)}\n时长：${formatDuration(segment.endAt - segment.startAt)}\n\n${summaryText}`
    await event.save()
  }

  await clearSession()
  await clearTaskNoteDraft(tasks, task.id)
}

export const StopPomodoroTimerIntent = AppIntentManager.register<PomodoroAlarmIntentParams>({
  name: "StopCalendarPomodoroTimerIntentV3",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (params: PomodoroAlarmIntentParams) => {
    await saveSessionToCalendar()
    await stopSystemAlarm(params.alarmId)
    try {
      Widget.reloadAll()
    } catch {}
  },
})
