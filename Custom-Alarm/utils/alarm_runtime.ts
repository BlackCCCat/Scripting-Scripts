import type { AlarmRecord, AlarmRepeatRule, HolidayCalendarSource } from "../types"
import { SnoozeCustomAlarmIntent } from "../app_intents"
import { buildHolidayDayMap } from "./holiday_calendar"

export const HOLIDAY_HORIZON_DAYS = 120
export const EXPANDED_RULE_HORIZON_DAYS = 365

type LimitedRepeatRule =
  | Extract<AlarmRepeatRule, { kind: "daily" }>
  | Extract<AlarmRepeatRule, { kind: "weekly" }>
  | Extract<AlarmRepeatRule, { kind: "monthly" }>
  | Extract<AlarmRepeatRule, { kind: "custom" }>

function twoDigits(value: number): string {
  return String(value).padStart(2, "0")
}

export function formatTime(hour: number, minute: number): string {
  return `${twoDigits(hour)}:${twoDigits(minute)}`
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const yyyy = date.getFullYear()
  const mm = twoDigits(date.getMonth() + 1)
  const dd = twoDigits(date.getDate())
  const hh = twoDigits(date.getHours())
  const min = twoDigits(date.getMinutes())
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export function extractTimeParts(timestamp: number): { hour: number; minute: number } {
  const date = new Date(timestamp)
  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
  }
}

export function makeTimeSeed(hour: number, minute: number): number {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

export function nextRoundedTimestamp(): number {
  const now = new Date()
  now.setSeconds(0, 0)
  now.setMinutes(Math.ceil((now.getMinutes() + 1) / 5) * 5)
  return now.getTime()
}

function startOfYear(year: number): Date {
  return new Date(year, 0, 1, 0, 0, 0, 0)
}

function endOfYear(year: number): Date {
  return new Date(year + 1, 0, 1, 0, 0, 0, 0)
}

function daysInYear(year: number): number {
  return Math.round((endOfYear(year).getTime() - startOfYear(year).getTime()) / 86400000)
}

function formatWeekdays(weekdays: number[]): string {
  const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
  return weekdays
    .map((weekday) => labels[(weekday - 1 + 7) % 7] ?? `周${weekday}`)
    .join("、")
}

export function displayTime(record: AlarmRecord): string {
  switch (record.repeatRule.kind) {
    case "once": {
      const { hour, minute } = extractTimeParts(record.repeatRule.timestamp)
      return formatTime(hour, minute)
    }
    case "daily":
    case "weekly":
    case "monthly":
    case "holiday":
    case "custom":
      return formatTime(record.repeatRule.hour, record.repeatRule.minute)
    default:
      return "--:--"
  }
}

export function displaySubtitle(
  record: AlarmRecord,
  sourceMap: Map<string, HolidayCalendarSource>
): string {
  switch (record.repeatRule.kind) {
    case "once":
      return formatDateTime(record.repeatRule.timestamp)
    case "daily":
      return "每天"
    case "weekly":
      return formatWeekdays(record.repeatRule.weekdays)
    case "monthly":
      return `每月 ${record.repeatRule.dayOfMonth} 日`
    case "holiday": {
      const source = sourceMap.get(record.repeatRule.sourceId)
      const modeLabel = record.repeatRule.matchMode === "holiday" ? "休息日" : "工作日"
      return `${modeLabel} · ${source?.title || "未配置节假日日历"}`
    }
    case "custom":
      return `自定义 · 响 ${record.repeatRule.ringDays} 天，停 ${record.repeatRule.skipDays} 天`
    default:
      return ""
  }
}

function buildAttributes(
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
    tintColor: "#FF9500",
    metadata: {
      source: "custom-alarm",
      logicalAlarmId,
    },
  })

  if (!attributes) throw new Error("闹钟展示属性创建失败")
  return attributes
}

function buildSound(soundName: string | null): AlarmManager.Sound {
  const normalizedSoundName = String(soundName ?? "").trim()
  return normalizedSoundName
    ? AlarmManager.Sound.named(normalizedSoundName)
    : AlarmManager.Sound.default()
}

function buildConfiguration(
  systemAlarmId: string,
  logicalAlarmId: string,
  title: string,
  schedule: AlarmManager.Schedule,
  snoozeMinutes: number,
  soundName: string | null
): AlarmManager.Configuration {
  const configuration = AlarmManager.Configuration.alarm({
    schedule,
    attributes: buildAttributes(title, logicalAlarmId, snoozeMinutes),
    sound: buildSound(soundName),
    secondaryIntent: snoozeMinutes > 0 ? SnoozeCustomAlarmIntent({
      alarmId: systemAlarmId,
      logicalAlarmId,
      title,
      snoozeMinutes,
      soundName,
    }) as any : null,
  })
  if (!configuration) throw new Error("闹钟配置创建失败")
  return configuration
}

async function cancelSystemAlarmIds(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await AlarmManager.stop(id)
    } catch {}
    try {
      await AlarmManager.cancel(id)
    } catch {}
  }
}

function dateKey(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = twoDigits(date.getMonth() + 1)
  const dd = twoDigits(date.getDate())
  return `${yyyy}-${mm}-${dd}`
}

function startOfToday(): Date {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function effectiveOccurrenceLimit(rule: LimitedRepeatRule): number | null {
  const limit = Number(rule.occurrenceLimit)
  if (!Number.isFinite(limit) || limit <= 0) return null
  return Math.max(1, Math.floor(limit))
}

function hasOccurrenceLimit(record: AlarmRecord): boolean {
  switch (record.repeatRule.kind) {
    case "daily":
    case "weekly":
    case "monthly":
    case "custom":
      return effectiveOccurrenceLimit(record.repeatRule) !== null
    default:
      return false
  }
}

function buildHolidaySets(
  source: HolidayCalendarSource,
  year?: number
): { offSet: Set<string>; workSet: Set<string> } {
  // 先把节假日日历整理成休/班两个集合，后面无论是统计还是排期都走同一套口径。
  const dayMap = buildHolidayDayMap(source)
  const offSet = new Set<string>()
  const workSet = new Set<string>()

  for (const [key, info] of dayMap.entries()) {
    if (typeof year === "number" && !key.startsWith(`${year}-`)) continue
    if (info.kind === "off") offSet.add(key)
    else if (info.kind === "work") workSet.add(key)
  }

  return { offSet, workSet }
}

function shouldRingForHolidayMode(
  key: string,
  weekday: number,
  matchMode: Extract<AlarmRepeatRule, { kind: "holiday" }>["matchMode"],
  offSet: Set<string>,
  workSet: Set<string>
): boolean {
  // 优先尊重日历里明确标记的休/班；只有没标记时，才退回到周一到周五上班、周末休息的默认规则。
  if (offSet.has(key)) return matchMode === "holiday"
  if (workSet.has(key)) return matchMode === "nonHoliday"

  const isRegularWeekday = weekday >= 1 && weekday <= 5
  return matchMode === "nonHoliday" ? isRegularWeekday : !isRegularWeekday
}

function buildHolidayTimestamps(
  rule: Extract<AlarmRepeatRule, { kind: "holiday" }>,
  source: HolidayCalendarSource,
  now = Date.now()
): number[] {
  const today = startOfToday()
  const end = new Date(today.getTime())
  end.setDate(end.getDate() + HOLIDAY_HORIZON_DAYS)
  const { offSet, workSet } = buildHolidaySets(source)
  const timestamps: number[] = []

  const cursor = new Date(today.getTime())
  while (cursor.getTime() < end.getTime()) {
    const key = dateKey(cursor)
    const weekday = cursor.getDay()
    const shouldRing = shouldRingForHolidayMode(key, weekday, rule.matchMode, offSet, workSet)
    if (shouldRing) {
      const fireDate = new Date(cursor.getTime())
      fireDate.setHours(rule.hour, rule.minute, 0, 0)
      if (fireDate.getTime() > now) timestamps.push(fireDate.getTime())
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return timestamps
}

function buildDailyTimestamps(
  rule: Extract<AlarmRepeatRule, { kind: "daily" }>,
  now = Date.now()
): number[] {
  const limit = effectiveOccurrenceLimit(rule)
  if (!limit) return []

  const timestamps: number[] = []
  const cursor = new Date(now)
  cursor.setSeconds(0, 0)
  cursor.setHours(rule.hour, rule.minute, 0, 0)
  if (cursor.getTime() <= now) cursor.setDate(cursor.getDate() + 1)

  while (timestamps.length < limit) {
    // 有限次数的重复闹钟会展开成固定实例，这样到次数上限后就会自然停止。
    timestamps.push(cursor.getTime())
    cursor.setDate(cursor.getDate() + 1)
    cursor.setHours(rule.hour, rule.minute, 0, 0)
  }

  return timestamps
}

function buildWeeklyTimestamps(
  rule: Extract<AlarmRepeatRule, { kind: "weekly" }>,
  now = Date.now()
): number[] {
  const limit = effectiveOccurrenceLimit(rule)
  if (!limit) return []

  const timestamps: number[] = []
  const weekdays = new Set(rule.weekdays)
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)

  while (timestamps.length < limit) {
    const weekday = cursor.getDay() + 1
    if (weekdays.has(weekday)) {
      const fireDate = new Date(cursor.getTime())
      fireDate.setHours(rule.hour, rule.minute, 0, 0)
      if (fireDate.getTime() > now) timestamps.push(fireDate.getTime())
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return timestamps
}

function buildMonthlyTimestamps(
  rule: Extract<AlarmRepeatRule, { kind: "monthly" }>,
  now = Date.now()
): number[] {
  const timestamps: number[] = []
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)

  const limit = effectiveOccurrenceLimit(rule)
  for (
    let monthOffset = 0;
    limit ? timestamps.length < limit : monthOffset < 18;
    monthOffset += 1
  ) {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + monthOffset, 1)
    const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()
    const targetDay = Math.min(rule.dayOfMonth, lastDay)
    const fireDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), targetDay, rule.hour, rule.minute, 0, 0)
    if (fireDate.getTime() > now) timestamps.push(fireDate.getTime())
  }

  return timestamps
}

function buildCustomTimestamps(
  rule: Extract<AlarmRepeatRule, { kind: "custom" }>,
  now = Date.now()
): number[] {
  const timestamps: number[] = []
  const cycleDays = rule.skipDays + rule.ringDays
  if (cycleDays <= 0) return timestamps
  const limit = effectiveOccurrenceLimit(rule)

  const startDate = new Date(rule.startDateTimestamp)
  startDate.setHours(0, 0, 0, 0)

  const cursor = new Date(startDate.getTime())
  const end = limit
    ? null
    : (() => {
        const value = new Date(startDate.getTime())
        value.setDate(value.getDate() + EXPANDED_RULE_HORIZON_DAYS)
        return value
      })()

  while (limit ? timestamps.length < limit : cursor.getTime() < end!.getTime()) {
    const diffDays = Math.floor((cursor.getTime() - startDate.getTime()) / 86400000)
    const cyclePosition = diffDays % cycleDays
    if (cyclePosition < rule.ringDays) {
      const fireDate = new Date(cursor.getTime())
      fireDate.setHours(rule.hour, rule.minute, 0, 0)
      if (fireDate.getTime() > now) timestamps.push(fireDate.getTime())
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return timestamps
}

export function countExpectedRingsInYear(
  record: AlarmRecord,
  holidaySourceMap: Map<string, HolidayCalendarSource>,
  year = new Date().getFullYear()
): number {
  // 状态页统一按“本年应响次数”统计，而不是按当前已经注册出去的实例数统计。
  if (!record.enabled) return 0

  const yearStart = startOfYear(year)
  const yearEnd = endOfYear(year)

  switch (record.repeatRule.kind) {
    case "once": {
      const fireDate = new Date(record.repeatRule.timestamp)
      return fireDate.getFullYear() === year ? 1 : 0
    }
    case "daily":
      return effectiveOccurrenceLimit(record.repeatRule)
        ? buildDailyTimestamps(record.repeatRule)
            .filter((timestamp) => new Date(timestamp).getFullYear() === year)
            .length
        : daysInYear(year)
    case "weekly": {
      if (effectiveOccurrenceLimit(record.repeatRule)) {
        return buildWeeklyTimestamps(record.repeatRule)
          .filter((timestamp) => new Date(timestamp).getFullYear() === year)
          .length
      }
      let count = 0
      const weekdays = new Set(record.repeatRule.weekdays)
      const cursor = new Date(yearStart.getTime())
      while (cursor.getTime() < yearEnd.getTime()) {
        const weekday = cursor.getDay() + 1
        if (weekdays.has(weekday)) count += 1
        cursor.setDate(cursor.getDate() + 1)
      }
      return count
    }
    case "monthly":
      return effectiveOccurrenceLimit(record.repeatRule)
        ? buildMonthlyTimestamps(record.repeatRule)
            .filter((timestamp) => new Date(timestamp).getFullYear() === year)
            .length
        : 12
    case "holiday": {
      const source = holidaySourceMap.get(record.repeatRule.sourceId)
      if (!source) return 0
      const { offSet, workSet } = buildHolidaySets(source, year)

      let count = 0
      const cursor = new Date(yearStart.getTime())
      while (cursor.getTime() < yearEnd.getTime()) {
        const key = dateKey(cursor)
        const weekday = cursor.getDay()
        const shouldRing = shouldRingForHolidayMode(key, weekday, record.repeatRule.matchMode, offSet, workSet)
        if (shouldRing) count += 1
        cursor.setDate(cursor.getDate() + 1)
      }
      return count
    }
    case "custom": {
      if (effectiveOccurrenceLimit(record.repeatRule)) {
        return buildCustomTimestamps(record.repeatRule)
          .filter((timestamp) => new Date(timestamp).getFullYear() === year)
          .length
      }
      let count = 0
      const cycleDays = record.repeatRule.skipDays + record.repeatRule.ringDays
      if (cycleDays <= 0) return 0
      const startDate = new Date(record.repeatRule.startDateTimestamp)
      startDate.setHours(0, 0, 0, 0)
      const cursor = new Date(yearStart.getTime())
      while (cursor.getTime() < yearEnd.getTime()) {
        if (cursor.getTime() >= startDate.getTime()) {
          const diffDays = Math.floor((cursor.getTime() - startDate.getTime()) / 86400000)
          const cyclePosition = diffDays % cycleDays
          if (cyclePosition < record.repeatRule.ringDays) count += 1
        }
        cursor.setDate(cursor.getDate() + 1)
      }
      return count
    }
    default:
      return 0
  }
}

export async function disableAlarm(record: AlarmRecord): Promise<AlarmRecord> {
  await cancelSystemAlarmIds(record.systemAlarmIds)
  return {
    ...record,
    enabled: false,
    systemAlarmIds: [],
    updatedAt: Date.now(),
  }
}

export async function deleteAlarm(record: AlarmRecord): Promise<void> {
  await cancelSystemAlarmIds(record.systemAlarmIds)
}

export async function scheduleAlarm(
  record: AlarmRecord,
  holidaySourceMap: Map<string, HolidayCalendarSource>
): Promise<AlarmRecord> {
  if (!record.enabled) {
    await cancelSystemAlarmIds(record.systemAlarmIds)
    return {
      ...record,
      systemAlarmIds: [],
      updatedAt: Date.now(),
    }
  }

  const createdIds: string[] = []
  const scheduledAt = Date.now()

  try {
    switch (record.repeatRule.kind) {
      case "once": {
        if (record.repeatRule.timestamp <= scheduledAt) {
          throw new Error("单次闹钟时间已过，请重新选择时间。")
        }
        const systemId = UUID.string()
        const configuration = buildConfiguration(
          systemId,
          record.id,
          record.title,
          AlarmManager.Schedule.fixed(new Date(record.repeatRule.timestamp)),
          record.snoozeMinutes,
          record.soundName
        )
        await AlarmManager.schedule(systemId, configuration)
        createdIds.push(systemId)
        break
      }
      case "daily": {
        const timestamps = buildDailyTimestamps(record.repeatRule, scheduledAt)
        if (timestamps.length) {
          for (const timestamp of timestamps) {
            const systemId = UUID.string()
            const configuration = buildConfiguration(
              systemId,
              record.id,
              record.title,
              AlarmManager.Schedule.fixed(new Date(timestamp)),
              record.snoozeMinutes,
              record.soundName
            )
            await AlarmManager.schedule(systemId, configuration)
            createdIds.push(systemId)
          }
        } else {
          const systemId = UUID.string()
          const configuration = buildConfiguration(
            systemId,
            record.id,
            record.title,
            AlarmManager.Schedule.relative(record.repeatRule.hour, record.repeatRule.minute),
            record.snoozeMinutes,
            record.soundName
          )
          await AlarmManager.schedule(systemId, configuration)
          createdIds.push(systemId)
        }
        break
      }
      case "weekly": {
        const timestamps = buildWeeklyTimestamps(record.repeatRule, scheduledAt)
        if (timestamps.length) {
          for (const timestamp of timestamps) {
            const systemId = UUID.string()
            const configuration = buildConfiguration(
              systemId,
              record.id,
              record.title,
              AlarmManager.Schedule.fixed(new Date(timestamp)),
              record.snoozeMinutes,
              record.soundName
            )
            await AlarmManager.schedule(systemId, configuration)
            createdIds.push(systemId)
          }
        } else {
          const systemId = UUID.string()
          const configuration = buildConfiguration(
            systemId,
            record.id,
            record.title,
            AlarmManager.Schedule.weekly(
              record.repeatRule.hour,
              record.repeatRule.minute,
              record.repeatRule.weekdays
            ),
            record.snoozeMinutes,
            record.soundName
          )
          await AlarmManager.schedule(systemId, configuration)
          createdIds.push(systemId)
        }
        break
      }
      case "monthly": {
        const timestamps = buildMonthlyTimestamps(record.repeatRule, scheduledAt)
        if (!timestamps.length) throw new Error("未来 18 个月内没有可安排的每月闹钟。")
        for (const timestamp of timestamps) {
          const systemId = UUID.string()
          const configuration = buildConfiguration(
            systemId,
            record.id,
            record.title,
            AlarmManager.Schedule.fixed(new Date(timestamp)),
            record.snoozeMinutes,
            record.soundName
          )
          await AlarmManager.schedule(systemId, configuration)
          createdIds.push(systemId)
        }
        break
      }
      case "holiday": {
        const source = holidaySourceMap.get(record.repeatRule.sourceId)
        if (!source) throw new Error("未找到对应的节假日日历。")
        if (!source.lastSyncedAt && !source.holidayItems.length && !source.holidayDates.length) {
          throw new Error("节假日日历还没有同步到本地，请先打开日历设置进行同步。")
        }
        const timestamps = buildHolidayTimestamps(record.repeatRule, source, scheduledAt)
        if (!timestamps.length) {
          throw new Error("未来 120 天内没有可安排的班休日闹钟。")
        }
        for (const timestamp of timestamps) {
          const systemId = UUID.string()
          const configuration = buildConfiguration(
            systemId,
            record.id,
            record.title,
            AlarmManager.Schedule.fixed(new Date(timestamp)),
            record.snoozeMinutes,
            record.soundName
          )
          await AlarmManager.schedule(systemId, configuration)
          createdIds.push(systemId)
        }
        break
      }
      case "custom": {
        const timestamps = buildCustomTimestamps(record.repeatRule, scheduledAt)
        if (!timestamps.length) throw new Error("未来一年内没有可安排的自定义周期闹钟。")
        for (const timestamp of timestamps) {
          const systemId = UUID.string()
          const configuration = buildConfiguration(
            systemId,
            record.id,
            record.title,
            AlarmManager.Schedule.fixed(new Date(timestamp)),
            record.snoozeMinutes,
            record.soundName
          )
          await AlarmManager.schedule(systemId, configuration)
          createdIds.push(systemId)
        }
        break
      }
      default:
        throw new Error("未知的闹钟类型。")
    }
  } catch (error) {
    await cancelSystemAlarmIds(createdIds)
    throw error
  }

  await cancelSystemAlarmIds(record.systemAlarmIds.filter((id) => !createdIds.includes(id)))

  return {
    ...record,
    systemAlarmIds: createdIds,
    lastScheduledAt: scheduledAt,
    updatedAt: Date.now(),
  }
}

export function reconcileAlarmRecords(
  records: AlarmRecord[],
  systemAlarmMap: Map<string, AlarmManager.Alarm>
): AlarmRecord[] {
  let changed = false
  const now = Date.now()

  const next = records.flatMap((record) => {
    const activeIds = record.systemAlarmIds.filter((id) => systemAlarmMap.has(id))
    let updated = record

    if (activeIds.length !== record.systemAlarmIds.length) {
      updated = {
        ...updated,
        systemAlarmIds: activeIds,
      }
      changed = true
    }

    if (
      updated.repeatRule.kind === "once"
      && updated.repeatRule.timestamp <= now
      && activeIds.length === 0
    ) {
      changed = true
      return []
    }

    if (
      updated.enabled
      && hasOccurrenceLimit(updated)
      && record.systemAlarmIds.length > 0
      && activeIds.length === 0
    ) {
      // 最后一个固定实例响完并消失后，会把有限次数闹钟标记为关闭，避免首页还显示成开启状态。
      changed = true
      updated = {
        ...updated,
        enabled: false,
        updatedAt: now,
      }
    }

    return [updated]
  })

  return changed ? next : records
}
