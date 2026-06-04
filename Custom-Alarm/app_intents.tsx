import { AppIntentManager, AppIntentProtocol, Script, Widget } from "scripting"

import type { AlarmRecord, HolidayCalendarSource } from "./types"
import { DEFAULT_SOUND_NAME } from "./utils/alarm_sounds"
import {
  DEFAULT_HOLIDAY_SOURCE_ID,
  loadCustomAlarmState,
  mergeManagedSystemAlarmIds,
  saveCustomAlarmState,
} from "./utils/storage"
import { buildHolidayDayMap } from "./utils/holiday_calendar"

type StopIntentParams = {
  alarmId: string
  logicalAlarmId: string
}

type SnoozeIntentParams = {
  alarmId: string
  logicalAlarmId: string
}

function occurrenceLimitForRecord(record: AlarmRecord): number | null {
  switch (record.repeatRule.kind) {
    case "daily":
    case "weekly":
    case "monthly":
    case "custom": {
      const limit = Number(record.repeatRule.occurrenceLimit)
      if (!Number.isFinite(limit) || limit <= 0) return null
      return Math.max(1, Math.floor(limit))
    }
    default:
      return null
  }
}

function dateKey(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function startOfToday(fromTimestamp = Date.now()): Date {
  const date = new Date(fromTimestamp)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfYear(year: number): Date {
  return new Date(year + 1, 0, 1, 0, 0, 0, 0)
}

function buildHolidaySets(source: HolidayCalendarSource): { offSet: Set<string>; workSet: Set<string> } {
  const dayMap = buildHolidayDayMap(source)
  const offSet = new Set<string>()
  const workSet = new Set<string>()

  for (const [key, info] of dayMap.entries()) {
    if (info.kind === "off") offSet.add(key)
    else if (info.kind === "work") workSet.add(key)
  }

  return { offSet, workSet }
}

function shouldRingForHolidayMode(
  key: string,
  weekday: number,
  matchMode: "holiday" | "nonHoliday",
  offSet: Set<string>,
  workSet: Set<string>
): boolean {
  if (offSet.has(key)) return matchMode === "holiday"
  if (workSet.has(key)) return matchMode === "nonHoliday"
  const isRegularWeekday = weekday >= 1 && weekday <= 5
  return matchMode === "nonHoliday" ? isRegularWeekday : !isRegularWeekday
}

function nextHolidayFireDate(record: AlarmRecord, source: HolidayCalendarSource, now = Date.now()): Date | null {
  if (record.repeatRule.kind !== "holiday") return null

  const today = startOfToday(now)
  const end = endOfYear(today.getFullYear())
  const { offSet, workSet } = buildHolidaySets(source)
  const cursor = new Date(today.getTime())

  while (cursor.getTime() < end.getTime()) {
    const key = dateKey(cursor)
    const weekday = cursor.getDay()
    if (shouldRingForHolidayMode(key, weekday, record.repeatRule.matchMode, offSet, workSet)) {
      const fireDate = new Date(cursor.getTime())
      fireDate.setHours(record.repeatRule.hour, record.repeatRule.minute, 0, 0)
      if (fireDate.getTime() > now) return fireDate
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return null
}

function nextDailyFireDate(record: AlarmRecord, now = Date.now()): Date | null {
  if (record.repeatRule.kind !== "daily") return null
  const cursor = new Date(now)
  cursor.setSeconds(0, 0)
  cursor.setHours(record.repeatRule.hour, record.repeatRule.minute, 0, 0)
  if (cursor.getTime() <= now) cursor.setDate(cursor.getDate() + 1)
  return cursor
}

function nextWeeklyFireDate(record: AlarmRecord, now = Date.now()): Date | null {
  if (record.repeatRule.kind !== "weekly") return null
  const weekdays = new Set(record.repeatRule.weekdays)
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const weekday = cursor.getDay() + 1
    if (weekdays.has(weekday)) {
      const fireDate = new Date(cursor.getTime())
      fireDate.setHours(record.repeatRule.hour, record.repeatRule.minute, 0, 0)
      if (fireDate.getTime() > now) return fireDate
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return null
}

function nextMonthlyFireDate(record: AlarmRecord, now = Date.now()): Date | null {
  if (record.repeatRule.kind !== "monthly") return null
  const start = new Date(now)
  start.setDate(1)
  start.setHours(0, 0, 0, 0)

  for (let monthOffset = 0; monthOffset < 18; monthOffset += 1) {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + monthOffset, 1)
    const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()
    const targetDay = Math.min(record.repeatRule.dayOfMonth, lastDay)
    const fireDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), targetDay, record.repeatRule.hour, record.repeatRule.minute, 0, 0)
    if (fireDate.getTime() > now) return fireDate
  }

  return null
}

function nextCustomFireDate(record: AlarmRecord, now = Date.now()): Date | null {
  if (record.repeatRule.kind !== "custom") return null

  const cycleDays = record.repeatRule.skipDays + record.repeatRule.ringDays
  if (cycleDays <= 0) return null

  const startDate = new Date(record.repeatRule.startDateTimestamp)
  startDate.setHours(0, 0, 0, 0)

  const cursor = new Date(Math.max(startOfToday(now).getTime(), startDate.getTime()))
  const maxDays = Math.max(cycleDays + record.repeatRule.ringDays, 120)

  for (let dayOffset = 0; dayOffset < maxDays; dayOffset += 1) {
    const diffDays = Math.floor((cursor.getTime() - startDate.getTime()) / 86400000)
    const cyclePosition = diffDays % cycleDays
    if (cyclePosition < record.repeatRule.ringDays) {
      const fireDate = new Date(cursor.getTime())
      fireDate.setHours(record.repeatRule.hour, record.repeatRule.minute, 0, 0)
      if (fireDate.getTime() > now) return fireDate
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return null
}

function buildAlertAttributes(
  title: string,
  logicalAlarmId: string,
  snoozeMinutes: number
): AlarmManager.Attributes {
  const alert = AlarmManager.AlertPresentation.create({
    title,
    stopButton: AlarmManager.Button.create({
      title: "关闭",
      textColor: "#FFFFFF",
      systemImageName: "xmark",
    }),
    secondaryButton: snoozeMinutes > 0 ? AlarmManager.Button.create({
      title: `推迟${snoozeMinutes}分钟`,
      textColor: "#FFFFFF",
      systemImageName: "timer",
    }) : null,
    secondaryBehavior: snoozeMinutes > 0 ? "custom" : null,
  })

  const attributes = AlarmManager.Attributes.create({
    alert,
    countdown: null,
    paused: null,
    tintColor: "#FF9500",
    metadata: {
      source: "custom-alarm",
      logicalAlarmId,
      snoozeMinutes: String(snoozeMinutes),
    },
  })

  if (!attributes) throw new Error("闹钟属性创建失败")
  return attributes
}

function buildRollingAlarmConfiguration(
  params: {
    alarmId: string
    logicalAlarmId: string
    title: string
    snoozeMinutes: number
    soundName: string
    fireDate: Date
  }
): AlarmManager.Configuration {
  const commonOptions = {
    schedule: AlarmManager.Schedule.fixed(params.fireDate),
    attributes: buildAlertAttributes(
      params.title,
      params.logicalAlarmId,
      params.snoozeMinutes
    ),
    sound: params.soundName !== DEFAULT_SOUND_NAME
      ? AlarmManager.Sound.named(params.soundName)
      : AlarmManager.Sound.default(),
    stopIntent: StopCustomAlarmIntent({
      alarmId: params.alarmId,
      logicalAlarmId: params.logicalAlarmId,
    }) as any,
    secondaryIntent: params.snoozeMinutes > 0 ? SnoozeCustomAlarmIntent({
      alarmId: params.alarmId,
      logicalAlarmId: params.logicalAlarmId,
    }) as any : null,
  }
  const configuration = AlarmManager.Configuration.alarm(commonOptions)

  if (!configuration) throw new Error("滚动闹钟配置创建失败")
  return configuration
}

function buildSnoozeCountdownConfiguration(
  params: {
    alarmId: string
    logicalAlarmId: string
    title: string
    snoozeMinutes: number
    soundName: string
  }
): AlarmManager.Configuration {
  const attributes = AlarmManager.Attributes.create({
    alert: AlarmManager.AlertPresentation.create({
      title: params.title,
      stopButton: AlarmManager.Button.create({
        title: "关闭",
        textColor: "#FFFFFF",
        systemImageName: "xmark",
      }),
      secondaryButton: AlarmManager.Button.create({
        title: `推迟${params.snoozeMinutes}分钟`,
        textColor: "#FFFFFF",
        systemImageName: "timer",
      }),
      secondaryBehavior: "countdown",
    }),
    countdown: AlarmManager.CountdownPresentation.create(
      "推迟提醒中",
      AlarmManager.Button.create({
        title: "暂停",
        textColor: "#FFFFFF",
        systemImageName: "pause.fill",
      })
    ),
    paused: AlarmManager.PausedPresentation.create(
      "推迟已暂停",
      AlarmManager.Button.create({
        title: "继续",
        textColor: "#FFFFFF",
        systemImageName: "play.fill",
      })
    ),
    tintColor: "#FF9500",
    metadata: {
      source: "custom-alarm-snooze",
      logicalAlarmId: params.logicalAlarmId,
      snoozeMinutes: String(params.snoozeMinutes),
    },
  })
  if (!attributes) throw new Error("推迟闹钟属性创建失败")

  const configuration = AlarmManager.Configuration.countdown({
    countdown: AlarmManager.Countdown.create({
      preAlert: params.snoozeMinutes * 60,
    }),
    attributes,
    sound: params.soundName !== DEFAULT_SOUND_NAME
      ? AlarmManager.Sound.named(params.soundName)
      : AlarmManager.Sound.default(),
    stopIntent: StopCustomAlarmIntent({
      alarmId: params.alarmId,
      logicalAlarmId: params.logicalAlarmId,
    }) as any,
    secondaryIntent: null,
  })

  if (!configuration) throw new Error("推迟倒计时配置创建失败")
  return configuration
}

export const SnoozeCustomAlarmIntent = AppIntentManager.register<SnoozeIntentParams>({
  name: "SnoozeCustomAlarmIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (params: SnoozeIntentParams) => {
    try {
      try {
        await AlarmManager.stop(params.alarmId)
      } catch {}

      const state = loadCustomAlarmState()
      const record = state.alarms.find((item) => item.id === params.logicalAlarmId)
      if (!record || !record.enabled || record.snoozeMinutes <= 0) return

      const snoozeAlarmId = UUID.string()

      await AlarmManager.schedule(
        snoozeAlarmId,
        buildSnoozeCountdownConfiguration({
          alarmId: snoozeAlarmId,
          logicalAlarmId: record.id,
          title: record.title,
          snoozeMinutes: record.snoozeMinutes,
          soundName: record.soundName,
        })
      )
      await AlarmManager.startCountdown(snoozeAlarmId)

      saveCustomAlarmState({
        ...state,
        alarms: state.alarms.map((item) => (
          item.id === record.id
            ? {
                ...record,
                systemAlarmIds: [snoozeAlarmId],
                lastScheduledAt: Date.now(),
                updatedAt: Date.now(),
              }
            : item
        )),
        managedSystemAlarmIds: mergeManagedSystemAlarmIds(state.managedSystemAlarmIds, [snoozeAlarmId]),
        cleanupCandidateAlarmIds: state.cleanupCandidateAlarmIds,
      })

      try {
        Widget.reloadAll()
      } catch {}
    } finally {
      try {
        Script.exit()
      } catch {}
    }
  },
})

export const StopCustomAlarmIntent = AppIntentManager.register<StopIntentParams>({
  name: "StopCustomAlarmIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (params: StopIntentParams) => {
    try {
      try {
        await AlarmManager.stop(params.alarmId)
      } catch {}

      const state = loadCustomAlarmState()
      const record = state.alarms.find((item) => item.id === params.logicalAlarmId)
      if (!record) return

      const baseRecord: AlarmRecord = {
        ...record,
        completedOccurrences: (record.completedOccurrences ?? 0) + 1,
        systemAlarmIds: record.systemAlarmIds.filter((id) => id !== params.alarmId),
        updatedAt: Date.now(),
      }

      let nextRecord = baseRecord
      let nextManagedIds = state.managedSystemAlarmIds

      if (record.enabled) {
        const occurrenceLimit = occurrenceLimitForRecord(record)
        if (occurrenceLimit !== null && baseRecord.completedOccurrences! >= occurrenceLimit) {
          nextRecord = {
            ...baseRecord,
            enabled: false,
            systemAlarmIds: [],
            lastScheduledAt: null,
          }
        } else if (
          record.repeatRule.kind === "holiday"
          || record.repeatRule.kind === "custom"
          || record.repeatRule.kind === "daily"
          || record.repeatRule.kind === "weekly"
          || record.repeatRule.kind === "monthly"
        ) {
          const repeatRule = record.repeatRule
          let nextDate: Date | null = null

          if (repeatRule.kind === "holiday") {
            const source = state.holidaySources.find((item) => item.id === repeatRule.sourceId)
              ?? state.holidaySources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID)
              ?? null
            if (source) nextDate = nextHolidayFireDate(record, source, Date.now())
          } else if (repeatRule.kind === "custom") {
            nextDate = nextCustomFireDate(record, Date.now())
          } else if (repeatRule.kind === "daily") {
            nextDate = nextDailyFireDate(record, Date.now())
          } else if (repeatRule.kind === "weekly") {
            nextDate = nextWeeklyFireDate(record, Date.now())
          } else if (repeatRule.kind === "monthly") {
            nextDate = nextMonthlyFireDate(record, Date.now())
          }

          if (nextDate) {
            const nextAlarmId = UUID.string()
            try {
              await AlarmManager.schedule(
                nextAlarmId,
                buildRollingAlarmConfiguration({
                  alarmId: nextAlarmId,
                  logicalAlarmId: record.id,
                  title: record.title,
                  snoozeMinutes: record.snoozeMinutes,
                  soundName: record.soundName,
                  fireDate: nextDate,
                })
              )
              nextRecord = {
                ...baseRecord,
                systemAlarmIds: [nextAlarmId],
                lastScheduledAt: Date.now(),
                updatedAt: Date.now(),
              }
              nextManagedIds = mergeManagedSystemAlarmIds(state.managedSystemAlarmIds, [nextAlarmId])
            } catch {
              nextRecord = {
                ...baseRecord,
                enabled: false,
                systemAlarmIds: [],
                lastScheduledAt: null,
              }
            }
          } else {
            nextRecord = {
              ...baseRecord,
              enabled: false,
              systemAlarmIds: [],
              lastScheduledAt: null,
            }
          }
        }
      }

      saveCustomAlarmState({
        ...state,
        alarms: state.alarms.map((item) => (
          item.id === params.logicalAlarmId ? nextRecord : item
        )),
        managedSystemAlarmIds: nextManagedIds,
        cleanupCandidateAlarmIds: state.cleanupCandidateAlarmIds,
      })

      try {
        Widget.reloadAll()
      } catch {}
    } finally {
      try {
        Script.exit()
      } catch {}
    }
  },
})
