import {
  BarChart,
  BarStackChart,
  Chart,
  GeometryReader,
  HStack,
  NavigationStack,
  Picker,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useState,
} from "scripting"
import { buildDashboardBundle, type DashboardDay } from "../data/dashboard"
import { MetricTile, SoftCard } from "../components/common"
import { palette, scoreEmoji, scoreLabel, scoreTone, stageColor } from "../theme"
import type { SleepTrackerSettings, SleepTrackerSnapshot } from "../types"
import {
  addDays,
  average,
  clamp,
  dateKeyFromDate,
  formatClockFromISO,
  formatHoursMinutes,
  formatMonthDayFromKey,
  pad2,
  parseDateKey,
  sleepEfficiencyPercent,
  startOfDay,
} from "../utils"

type TrendMode = "week" | "month" | "year" | "all"
type StageFilter = "全部" | "清醒" | "眼动" | "核心" | "深度" | "恢复性"
type TrendBucket = { key: string; label: string; days: DashboardDay[] }

const MODE_OPTIONS: Array<{ key: TrendMode; label: string }> = [
  { key: "week", label: "周" },
  { key: "month", label: "月" },
  { key: "year", label: "年" },
  { key: "all", label: "全部" },
]

const STAGE_FILTERS: StageFilter[] = ["全部", "清醒", "眼动", "核心", "深度", "恢复性"]

function startOfWeek(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = copy.getDay()
  const offset = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + offset)
  return copy
}

function endOfWeek(date: Date): Date {
  const start = startOfWeek(date)
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999)
}

function shiftMonth(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1)
}

function emptyStages() {
  return {
    inBed: 0,
    awake: 0,
    asleepUnspecified: 0,
    asleepCore: 0,
    asleepDeep: 0,
    asleepREM: 0,
  }
}

function placeholderDay(date: Date): DashboardDay {
  return {
    dateKey: dateKeyFromDate(date),
    dateISO: startOfDay(date).toISOString(),
    sleepNightKey: null,
    bedtimeISO: null,
    wakeISO: null,
    totalSleepMinutes: null,
    totalInBedMinutes: null,
    awakeMinutes: null,
    napMinutes: null,
    napCount: 0,
    sleepStages: emptyStages(),
    stepCount: null,
    activeEnergyKcal: null,
    moveGoalKcal: null,
    exerciseMinutes: null,
    exerciseGoalMinutes: null,
    standHours: null,
    standGoalHours: null,
    daylightMinutes: null,
    mindfulMinutes: null,
    apneaEvents: 0,
    avgHeartRate: null,
    restingHeartRate: null,
    hrvMs: null,
    respiratoryRate: null,
    oxygenSaturationPercent: null,
    wristTemperatureCelsius: null,
    sleepScore: null,
  }
}

function buildPlaceholderDays(count: number): DashboardDay[] {
  const today = startOfDay(new Date())
  return new Array(count).fill(null).map((_, index) => placeholderDay(addDays(today, -(count - 1 - index))))
}

function periodBounds(mode: TrendMode, allDays: DashboardDay[]) {
  const now = new Date()

  if (mode === "all") {
    return {
      start: allDays[0] ? parseDateKey(allDays[0].dateKey) : new Date(now.getFullYear(), 0, 1),
      end: allDays[allDays.length - 1] ? parseDateKey(allDays[allDays.length - 1].dateKey) : now,
      label: "全部",
      secondary: `${allDays.length}天`,
    }
  }

  if (mode === "week") {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return {
      start: startOfWeek(target),
      end: endOfWeek(target),
      label: "本周",
      secondary: `${target.getMonth() + 1}月`,
    }
  }

  if (mode === "month") {
    const monthStart = shiftMonth(now, 0)
    return {
      start: monthStart,
      end: new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999),
      label: "本月",
      secondary: `${monthStart.getMonth() + 1}月`,
    }
  }

  const year = now.getFullYear()
  return {
    start: new Date(year, 0, 1),
    end: new Date(year, 11, 31, 23, 59, 59, 999),
    label: "今年",
    secondary: `${year}`,
  }
}

function periodDays(allDays: DashboardDay[], mode: TrendMode) {
  const bounds = periodBounds(mode, allDays)
  const filtered =
    mode === "all"
      ? allDays
      : allDays.filter((day) => {
          const current = parseDateKey(day.dateKey)
          return current >= bounds.start && current <= bounds.end
        })
  return { bounds, filtered }
}

function buildTrendBuckets(days: DashboardDay[], mode: TrendMode): TrendBucket[] {
  if (mode === "week" || mode === "month") {
    return days.map((day) => ({
      key: day.dateKey,
      label: day.dateKey.slice(-2),
      days: [day],
    }))
  }

  const buckets = new Map<string, TrendBucket>()
  for (const day of days) {
    const date = parseDateKey(day.dateKey)
    const key = mode === "year" ? `${date.getFullYear()}-${pad2(date.getMonth() + 1)}` : `${date.getFullYear()}`
    const label = mode === "year" ? pad2(date.getMonth() + 1) : `${date.getFullYear()}`
    const existing = buckets.get(key)
    if (existing) {
      existing.days.push(day)
      continue
    }
    buckets.set(key, { key, label, days: [day] })
  }
  return [...buckets.values()]
}

function buildDurationBuckets(days: DashboardDay[], mode: TrendMode): TrendBucket[] {
  const now = startOfDay(new Date())

  if (mode === "week" || mode === "month") {
    const dayMap = new Map(days.map((day) => [day.dateKey, day]))
    const start = mode === "week" ? startOfWeek(now) : new Date(now.getFullYear(), now.getMonth(), 1)
    const count = mode === "week" ? 7 : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

    return new Array(count).fill(null).map((_, index) => {
      const date = addDays(start, index)
      const key = dateKeyFromDate(date)
      const existing = dayMap.get(key)
      return {
        key,
        label: key.slice(-2),
        days: existing ? [existing] : [],
      }
    })
  }

  if (mode === "year") {
    const year = now.getFullYear()
    const groups = new Map<string, DashboardDay[]>()
    for (const day of days) {
      const date = parseDateKey(day.dateKey)
      const key = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
      const list = groups.get(key) ?? []
      list.push(day)
      groups.set(key, list)
    }

    return new Array(12).fill(null).map((_, index) => {
      const key = `${year}-${pad2(index + 1)}`
      return {
        key,
        label: pad2(index + 1),
        days: groups.get(key) ?? [],
      }
    })
  }

  const currentYear = now.getFullYear()
  const startYear = days.length
    ? Math.min(...days.map((day) => parseDateKey(day.dateKey).getFullYear()))
    : currentYear
  const groups = new Map<string, DashboardDay[]>()
  for (const day of days) {
    const yearKey = `${parseDateKey(day.dateKey).getFullYear()}`
    const list = groups.get(yearKey) ?? []
    list.push(day)
    groups.set(yearKey, list)
  }

  return new Array(currentYear - startYear + 1).fill(null).map((_, index) => {
    const year = startYear + index
    const key = `${year}`
    return {
      key,
      label: key,
      days: groups.get(key) ?? [],
    }
  })
}

function currentDurationBucketKey(mode: TrendMode): string {
  const now = startOfDay(new Date())
  if (mode === "year") return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
  if (mode === "all") return `${now.getFullYear()}`
  return dateKeyFromDate(now)
}

function wrappedMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null
  const date = new Date(iso)
  let minutes = date.getHours() * 60 + date.getMinutes()
  if (minutes < 12 * 60) minutes += 24 * 60
  return minutes
}

function formatWrappedClock(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "-"
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440
  const hour = Math.floor(normalized / 60)
  const minute = normalized % 60
  return `${pad2(hour)}:${pad2(minute)}`
}

function regularityScore(values: number[]): number {
  if (!values.length) return 0
  const mean = average(values)
  const deviation = average(values.map((value) => Math.abs(value - mean)))
  return Math.round(clamp(100 - deviation * 0.9, 0, 100))
}

function buildStageMarks(days: DashboardDay[], filter: StageFilter) {
  if (filter === "全部") {
    return days
      .filter((day) => (day.totalSleepMinutes ?? 0) > 0)
      .flatMap((day) => [
        { label: day.dateKey, category: "深度", value: day.sleepStages.asleepDeep / 60, foregroundStyle: stageColor("asleepDeep") },
        { label: day.dateKey, category: "核心", value: day.sleepStages.asleepCore / 60, foregroundStyle: stageColor("asleepCore") },
        { label: day.dateKey, category: "眼动", value: day.sleepStages.asleepREM / 60, foregroundStyle: stageColor("asleepREM") },
        { label: day.dateKey, category: "清醒", value: (day.awakeMinutes ?? 0) / 60, foregroundStyle: stageColor("awake") },
      ])
      .filter((item) => item.value > 0)
  }

  const stageKey =
    filter === "清醒"
      ? "awake"
      : filter === "眼动"
        ? "asleepREM"
        : filter === "核心"
          ? "asleepCore"
          : filter === "深度"
            ? "asleepDeep"
            : null

  return days
    .filter((day) => (day.totalSleepMinutes ?? 0) > 0)
    .map((day) => ({
      label: day.dateKey,
      value:
        filter === "恢复性"
          ? (day.sleepStages.asleepDeep + day.sleepStages.asleepREM) / 60
          : ((stageKey ? day.sleepStages[stageKey] : 0) ?? 0) / 60,
      foregroundStyle:
        filter === "恢复性" ? palette.accent : stageKey ? stageColor(stageKey) : palette.sleepCore,
    }))
}

function buildStageSummary(days: DashboardDay[]) {
  const totalSleep = days.reduce((sum, day) => sum + (day.totalSleepMinutes ?? 0), 0)
  const totalInBed = days.reduce((sum, day) => sum + (day.totalInBedMinutes ?? 0), 0)
  const totals = {
    awake: days.reduce((sum, day) => sum + (day.awakeMinutes ?? 0), 0),
    rem: days.reduce((sum, day) => sum + day.sleepStages.asleepREM, 0),
    core: days.reduce((sum, day) => sum + day.sleepStages.asleepCore, 0),
    deep: days.reduce((sum, day) => sum + day.sleepStages.asleepDeep, 0),
    restorative: days.reduce((sum, day) => sum + day.sleepStages.asleepDeep + day.sleepStages.asleepREM, 0),
  }
  const effectiveInBed = Math.max(totalInBed, totalSleep + totals.awake)
  const awakeRatio = clamp(totals.awake / Math.max(1, effectiveInBed), 0, 1)

  return [
    { label: "清醒", minutes: totals.awake, ratio: awakeRatio, tone: stageColor("awake") },
    { label: "眼动", minutes: totals.rem, ratio: clamp(totals.rem / Math.max(1, totalSleep), 0, 1), tone: stageColor("asleepREM") },
    { label: "核心", minutes: totals.core, ratio: clamp(totals.core / Math.max(1, totalSleep), 0, 1), tone: stageColor("asleepCore") },
    { label: "深度", minutes: totals.deep, ratio: clamp(totals.deep / Math.max(1, totalSleep), 0, 1), tone: stageColor("asleepDeep") },
    { label: "恢复性", minutes: totals.restorative, ratio: clamp(totals.restorative / Math.max(1, totalSleep), 0, 1), tone: palette.accent },
  ]
}

function calendarScoreBackground(score: number | null): string {
  if (score == null) return "#D9DCE8"
  if (score >= 85) return "#80D9B8"
  if (score >= 75) return "#FDB44E"
  if (score >= 65) return "#FF9C7B"
  return "#FF7B7B"
}

function calendarBucketLabel(bucket: TrendBucket, mode: TrendMode): string {
  if (mode === "year" || mode === "all") return bucket.label
  return formatMonthDayFromKey(bucket.key).replace("月", "/").replace("日", "")
}

function buildCalendarItems(buckets: TrendBucket[], mode: TrendMode, placeholder = false) {
  const placeholderTimes = ["22:41", "23:14", "22:58", "23:37", "22:26", "23:05"]
  const placeholderScores = [92, 84, 77, 69, 88, 73]

  return buckets.map((bucket, index) => {
    if (placeholder) {
      return {
        key: bucket.key,
        label: calendarBucketLabel(bucket, mode),
        bedtime: null,
        emoji: null,
        background: calendarScoreBackground(null),
      }
    }

    const daysWithBedtime = bucket.days.filter((day) => day.bedtimeISO)
    const bedtimeValues = daysWithBedtime
      .map((day) => wrappedMinutes(day.bedtimeISO))
      .filter((value): value is number => value != null)
    const scores = daysWithBedtime
      .map((day) => day.sleepScore)
      .filter((value): value is number => value != null)
    const averageScore = scores.length ? average(scores) : null

    return {
      key: bucket.key,
      label: calendarBucketLabel(bucket, mode),
      bedtime:
        mode === "week" || mode === "month"
          ? formatClockFromISO(daysWithBedtime[0]?.bedtimeISO)
          : formatWrappedClock(bedtimeValues.length ? average(bedtimeValues) : null),
      emoji: scoreEmoji(averageScore),
      background: calendarScoreBackground(averageScore),
    }
  })
}

function placeholderDurationMarks(days: DashboardDay[]) {
  return days.slice(-31).map((day, index) => ({
    label: day.dateKey,
    value: 0,
    foregroundStyle: "#D9DCE8",
  }))
}

function placeholderStageMarks(days: DashboardDay[], filter: StageFilter) {
  if (filter === "全部") {
    return days.slice(-31).flatMap((day, index) => [
      { label: day.dateKey, category: "深度", value: 0, foregroundStyle: stageColor("asleepDeep") },
      { label: day.dateKey, category: "核心", value: 0, foregroundStyle: stageColor("asleepCore") },
      { label: day.dateKey, category: "眼动", value: 0, foregroundStyle: stageColor("asleepREM") },
      { label: day.dateKey, category: "清醒", value: 0, foregroundStyle: stageColor("awake") },
    ])
  }

  const tones: Record<string, string> = {
    清醒: stageColor("awake"),
    眼动: stageColor("asleepREM"),
    核心: stageColor("asleepCore"),
    深度: stageColor("asleepDeep"),
    恢复性: palette.accent,
  }
  return days.slice(-31).map((day, index) => ({
    label: day.dateKey,
    value: 0,
    foregroundStyle: tones[filter] || palette.line,
  }))
}

function placeholderStageSummary() {
  return [
    { label: "清醒", minutes: 0, ratio: 0, tone: stageColor("awake") },
    { label: "眼动", minutes: 0, ratio: 0, tone: stageColor("asleepREM") },
    { label: "核心", minutes: 0, ratio: 0, tone: stageColor("asleepCore") },
    { label: "深度", minutes: 0, ratio: 0, tone: stageColor("asleepDeep") },
    { label: "恢复性", minutes: 0, ratio: 0, tone: palette.accent },
  ]
}

function placeholderRegularityMarks(days: DashboardDay[]) {
  return days.slice(-31).map((day, index) => ({
    dateKey: day.dateKey,
    start: null,
    end: null,
    foregroundStyle: palette.sleepCore,
  }))
}

function chartWidth(total: number, mode: TrendMode): number {
  const unit = mode === "week" ? 36 : mode === "month" ? 22 : mode === "year" ? 20 : 28
  return Math.max(320, total * unit)
}

function buildDurationAxisValues(marks: Array<{ value: number }>) {
  const maxValue = Math.max(1, ...marks.map((item) => item.value))
  const step = maxValue >= 200 ? 10 : maxValue >= 100 ? 10 : maxValue >= 40 ? 5 : 1
  const roundUp = (value: number) => Math.ceil(value / step) * step
  const roundNearest = (value: number) => Math.round(value / step) * step
  const ceiling = Math.max(step, roundUp(maxValue))
  return [ceiling, Math.max(step, roundNearest((ceiling * 2) / 3)), Math.max(step, roundNearest(ceiling / 3)), 0]
}

function buildDurationChartMarks(buckets: TrendBucket[], mode: TrendMode, placeholder = false) {
  if (placeholder) {
    return buckets.map((bucket, index) => ({
      key: bucket.key,
      label: bucket.label,
      value: 0,
      foregroundStyle: palette.line,
    }))
  }
  return buckets.map((bucket) => {
    const sleepMinutes = bucket.days.map((day) => day.totalSleepMinutes ?? 0)
    const durationMinutes =
      mode === "year" || mode === "all"
        ? sleepMinutes.reduce((sum, value) => sum + value, 0)
        : bucket.days.length
          ? average(sleepMinutes)
          : 0
    const avgScore = bucket.days.length ? average(bucket.days.map((day) => day.sleepScore ?? 0)) : 0
    return {
      key: bucket.key,
      label: bucket.label,
      value: Math.round((durationMinutes / 60) * 10) / 10,
      foregroundStyle:
        bucket.days.length === 0
          ? palette.line
          : avgScore >= 85
            ? palette.accent
            : avgScore >= 75
              ? palette.sleepCore
              : avgScore >= 65
                ? palette.okay
                : palette.poor,
    }
  })
}

function buildDisplayStageMarks(buckets: TrendBucket[], fallbackDays: DashboardDay[], filter: StageFilter, placeholder = false) {
  if (placeholder) {
    return placeholderStageMarks(fallbackDays, filter).map((item) => ({
      ...item,
      label: item.label.slice(-2),
    }))
  }

  if (filter === "全部") {
    return buckets.flatMap((bucket) => {
      const days = bucket.days
      return [
        {
          label: bucket.label,
          category: "深度",
          value: average(days.map((day) => day.sleepStages.asleepDeep / 60)),
          foregroundStyle: stageColor("asleepDeep"),
        },
        {
          label: bucket.label,
          category: "核心",
          value: average(days.map((day) => day.sleepStages.asleepCore / 60)),
          foregroundStyle: stageColor("asleepCore"),
        },
        {
          label: bucket.label,
          category: "眼动",
          value: average(days.map((day) => day.sleepStages.asleepREM / 60)),
          foregroundStyle: stageColor("asleepREM"),
        },
        {
          label: bucket.label,
          category: "清醒",
          value: average(days.map((day) => (day.awakeMinutes ?? 0) / 60)),
          foregroundStyle: stageColor("awake"),
        },
      ]
    })
  }

  return buckets.map((bucket) => {
    const days = bucket.days
    const value =
      filter === "恢复性"
        ? average(days.map((day) => (day.sleepStages.asleepDeep + day.sleepStages.asleepREM) / 60))
        : filter === "清醒"
          ? average(days.map((day) => (day.awakeMinutes ?? 0) / 60))
          : filter === "眼动"
            ? average(days.map((day) => day.sleepStages.asleepREM / 60))
            : filter === "核心"
              ? average(days.map((day) => day.sleepStages.asleepCore / 60))
              : average(days.map((day) => day.sleepStages.asleepDeep / 60))
    return {
      label: bucket.label,
      value,
      foregroundStyle:
        filter === "恢复性"
          ? palette.accent
          : filter === "清醒"
            ? stageColor("awake")
            : filter === "眼动"
              ? stageColor("asleepREM")
              : filter === "核心"
                ? stageColor("asleepCore")
                : stageColor("asleepDeep"),
    }
  })
}

function buildStageAxisValues(marks: Array<{ label: string; value: number }>, filter: StageFilter) {
  if (!marks.length) return [1, 0.5, 0, 0]
  const values =
    filter === "全部"
      ? [...marks.reduce((map, item) => map.set(item.label, (map.get(item.label) ?? 0) + item.value), new Map<string, number>()).values()]
      : marks.map((item) => item.value)
  return buildDurationAxisValues(values.map((value) => ({ value })))
}

function buildRegularityColumns(buckets: TrendBucket[], placeholder = false) {
  if (placeholder) {
    return buckets.map((bucket, index) => ({
      dateKey: bucket.key,
      label: bucket.label,
      start: null,
      end: null,
      foregroundStyle: palette.sleepCore,
      hasData: false,
    }))
  }

  return buckets.map((bucket) => {
    const bedtimes = bucket.days.map((day) => wrappedMinutes(day.bedtimeISO)).filter((value): value is number => value != null)
    const wakeTimes = bucket.days.map((day) => wrappedMinutes(day.wakeISO)).filter((value): value is number => value != null)
    return {
      dateKey: bucket.key,
      label: bucket.label,
      start: bedtimes.length ? average(bedtimes) : null,
      end: bedtimes.length && wakeTimes.length ? average(wakeTimes) : null,
      foregroundStyle: palette.sleepCore,
      hasData: bedtimes.length > 0 && wakeTimes.length > 0,
    }
  })
}

function safeMin(values: number[], fallback = 0): number {
  return values.length ? Math.min(...values) : fallback
}

function safeMax(values: number[], fallback = 0): number {
  return values.length ? Math.max(...values) : fallback
}

function scrollAnchorForKey<T>(items: T[], currentKey: string, getKey: (item: T) => string) {
  if (items.length <= 1) return { x: 0, y: 0.5 }
  const index = items.findIndex((item) => getKey(item) === currentKey)
  if (index <= 0) return { x: 0, y: 0.5 }
  return { x: clamp(index / Math.max(1, items.length - 1), 0, 1), y: 0.5 }
}

export function TrendsTab(props: {
  isActive: boolean
  snapshot: SleepTrackerSnapshot | null
  settings: SleepTrackerSettings
}) {
  const [mode, setMode] = useState<TrendMode>("month")
  const [stageFilter, setStageFilter] = useState<StageFilter>("全部")

  const dashboard = buildDashboardBundle(props.snapshot, props.settings, props.snapshot?.queryDays ?? 365)
  const today = startOfDay(new Date())
  const sourceDays = (dashboard?.days.length ? dashboard.days : buildPlaceholderDays(120)).filter(
    (day) => parseDateKey(day.dateKey) <= today
  )
  const days = periodDays(sourceDays, mode).filtered
  const sleepDays = days.filter((day) => (day.totalSleepMinutes ?? 0) > 0)
  const hasRealData = sleepDays.length > 0
  const buckets = buildTrendBuckets(hasRealData ? sleepDays : days, mode)
  const durationBuckets = buildDurationBuckets(hasRealData ? sleepDays : days, mode)
  const stageBuckets = buildDurationBuckets(hasRealData ? sleepDays : days, mode)
  const averageScore = Math.round(average(sleepDays.map((day) => day.sleepScore ?? 0)))
  const averageSleep = Math.round(average(sleepDays.map((day) => day.totalSleepMinutes ?? 0)))
  const averageEfficiency = average(
    sleepDays.map((day) => sleepEfficiencyPercent(day.totalSleepMinutes, day.totalInBedMinutes))
  )
  const stageSummary = hasRealData ? buildStageSummary(sleepDays) : placeholderStageSummary()
  const durationChartMarks = buildDurationChartMarks(durationBuckets, mode, !hasRealData)
  const durationAxisValues = buildDurationAxisValues(durationChartMarks)
  const stageMarks = buildDisplayStageMarks(stageBuckets, days, stageFilter, !hasRealData)
  const stageAxisValues = buildStageAxisValues(stageMarks, stageFilter)
  const calendarItems = buildCalendarItems(durationBuckets, mode, !hasRealData)
  const bedtimes = sleepDays.map((day) => wrappedMinutes(day.bedtimeISO)).filter((value): value is number => value != null)
  const wakeTimes = sleepDays.map((day) => wrappedMinutes(day.wakeISO)).filter((value): value is number => value != null)
  const avgBedtime = hasRealData ? average(bedtimes) : null
  const avgWake = hasRealData ? average(wakeTimes) : null
  const earlyBedCount = sleepDays.filter((day) => {
    const bedtime = wrappedMinutes(day.bedtimeISO)
    return bedtime != null && bedtime <= 23 * 60
  }).length
  const regularityColumns = buildRegularityColumns(durationBuckets, !hasRealData)
  const bedtimeRegularity = hasRealData ? regularityScore(bedtimes) : null
  const wakeRegularity = hasRealData ? regularityScore(wakeTimes) : null
  const durationCurrentKey = currentDurationBucketKey(mode)
  const stageCurrentKey = currentDurationBucketKey(mode)
  const durationAnchor = scrollAnchorForKey(durationChartMarks, durationCurrentKey, (item) => item.key)
  const stageAnchor = scrollAnchorForKey(stageBuckets, stageCurrentKey, (item) => item.key)
  const calendarAnchor = scrollAnchorForKey(calendarItems, durationCurrentKey, (item) => item.key)
  const regularityAnchor = scrollAnchorForKey(regularityColumns, durationCurrentKey, (item) => item.dateKey)

  return (
    <NavigationStack>
      <ScrollView navigationTitle="趋势" navigationBarTitleDisplayMode="large">
        <VStack
          spacing={16}
          padding={16}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          background={{ style: palette.page } as any}
        >
          <SoftCard>
            <Picker
              title="趋势范围"
              pickerStyle="segmented"
              value={mode}
              onChanged={(value: any) => setMode(value as TrendMode)}
            >
              {MODE_OPTIONS.map((option) => (
                <Text key={option.key} tag={option.key}>
                  {option.label}
                </Text>
              ))}
            </Picker>
          </SoftCard>

          <SoftCard title="平均睡眠充能">
            <HStack alignment="bottom">
              <Text font={{ size: 72, weight: "light" } as any} foregroundStyle={scoreTone(hasRealData ? averageScore : null) as any}>
                {hasRealData ? `${averageScore}%` : "--"}
              </Text>
              <Spacer />
              <Text font="headline" foregroundStyle={scoreTone(hasRealData ? averageScore : null) as any}>
                {hasRealData ? scoreLabel(averageScore) : "等待健康数据"}
              </Text>
            </HStack>
            <ProgressView
              value={hasRealData ? clamp(averageScore / 100, 0, 1) : 0}
              total={1}
              progressViewStyle="linear"
              tint={(hasRealData ? scoreTone(averageScore) : palette.line) as any}
            />
            <HStack spacing={12}>
              <MetricTile label="平均时长" value={hasRealData ? formatHoursMinutes(averageSleep) : "--"} tone={palette.sleepCore} />
              <MetricTile label="平均效率" value={hasRealData ? `${Math.round(averageEfficiency)}%` : "--"} tone={palette.accentDeep} />
            </HStack>
          </SoftCard>

          <SoftCard title="睡眠时长">
            <VStack frame={{ width: "100%" as any, height: 286 }}>
              <GeometryReader>
                {({ size }: any) => {
                  const minChartWidth = chartWidth(durationChartMarks.length, mode)
                  const viewportWidth = Math.max(120, size.width - 56)
                  const contentWidth = Math.max(viewportWidth, minChartWidth)
                  const durationCellWidth = contentWidth / Math.max(1, durationChartMarks.length)

                  return (
                    <HStack alignment="top" spacing={8} frame={{ width: size.width, height: size.height }}>
                      <VStack spacing={0}>
                        {durationAxisValues.map((value) => (
                          <Text
                            key={`left-${value}`}
                            font="caption2"
                            foregroundStyle={palette.mutedInk}
                            lineLimit={1}
                            frame={{ width: 32, height: 60, alignment: "trailing" as any }}
                          >
                            {value}
                          </Text>
                        ))}
                      </VStack>

                      <ScrollView
                        key={`duration-${mode}`}
                        axes="horizontal"
                        scrollIndicator="hidden"
                        defaultScrollAnchor={durationAnchor as any}
                        scrollTargetBehavior="viewAligned"
                        frame={{ width: viewportWidth, height: size.height }}
                      >
                        <VStack spacing={8} padding={{ top: 10 }} scrollTargetlayout>
                          <Chart
                            frame={{ width: contentWidth, height: 240 }}
                            chartLegend="hidden"
                            chartXAxis="hidden"
                            chartYAxis="hidden"
                            chartYScale={{ from: 0, to: durationAxisValues[0] ?? 1 } as any}
                          >
                            <BarChart marks={durationChartMarks as any} />
                          </Chart>
                          <HStack alignment="top" spacing={0} frame={{ width: contentWidth }}>
                            {durationChartMarks.map((item) => (
                              <VStack
                                key={`duration-${item.key}`}
                                frame={{ width: durationCellWidth, alignment: "center" as any }}
                              >
                                <Text
                                  font="caption2"
                                  foregroundStyle={palette.mutedInk}
                                  lineLimit={1}
                                  frame={{ width: durationCellWidth, alignment: "center" as any }}
                                >
                                  {item.label}
                                </Text>
                              </VStack>
                            ))}
                          </HStack>
                        </VStack>
                      </ScrollView>

                      <VStack spacing={0}>
                        {durationAxisValues.map((value) => (
                          <Text
                            key={`right-${value}`}
                            font="caption2"
                            foregroundStyle={palette.mutedInk}
                            lineLimit={1}
                            frame={{ width: 32, height: 60, alignment: "leading" as any }}
                          >
                            {value}
                          </Text>
                        ))}
                      </VStack>
                    </HStack>
                  )
                }}
              </GeometryReader>
            </VStack>
            <HStack>
              <Text foregroundStyle={palette.accentDeep}>
                最长: {hasRealData ? formatHoursMinutes(safeMax(sleepDays.map((day) => day.totalSleepMinutes ?? 0))) : "--"}
              </Text>
              <Spacer />
              <Text foregroundStyle={palette.poor}>
                最短: {hasRealData ? formatHoursMinutes(safeMin(sleepDays.map((day) => day.totalSleepMinutes ?? 24 * 60), 24 * 60)) : "--"}
              </Text>
            </HStack>
          </SoftCard>

          <SoftCard title="睡眠阶段" subtitle={`睡眠效率 ${hasRealData ? Math.round(averageEfficiency) : "--"}${hasRealData ? "%" : ""}`}>
            <Picker
              title="睡眠阶段筛选"
              pickerStyle="segmented"
              value={stageFilter}
              onChanged={(value: any) => setStageFilter(value as StageFilter)}
            >
              {STAGE_FILTERS.map((filter) => (
                <Text key={filter} tag={filter}>
                  {filter}
                </Text>
              ))}
            </Picker>

            <VStack frame={{ width: "100%" as any, height: 266 }}>
              <GeometryReader>
                {({ size }: any) => {
                  const minChartWidth = chartWidth(stageBuckets.length, mode)
                  const viewportWidth = Math.max(120, size.width - 56)
                  const contentWidth = Math.max(viewportWidth, minChartWidth)
                  const stageCellWidth = contentWidth / Math.max(1, stageBuckets.length)

                  return (
                    <HStack alignment="top" spacing={8} frame={{ width: size.width, height: size.height }}>
                      <VStack spacing={0}>
                        {stageAxisValues.map((value) => (
                          <Text
                            key={`stage-left-${value}`}
                            font="caption2"
                            foregroundStyle={palette.mutedInk}
                            lineLimit={1}
                            frame={{ width: 32, height: 55, alignment: "trailing" as any }}
                          >
                            {value}
                          </Text>
                        ))}
                      </VStack>

                      <ScrollView
                        key={`stage-${mode}`}
                        axes="horizontal"
                        scrollIndicator="hidden"
                        defaultScrollAnchor={stageAnchor as any}
                        scrollTargetBehavior="viewAligned"
                        frame={{ width: viewportWidth, height: size.height }}
                      >
                        <VStack spacing={8} padding={{ top: 10 }} scrollTargetlayout>
                          <Chart
                            frame={{ width: contentWidth, height: 220 }}
                            chartLegend="hidden"
                            chartXAxis="hidden"
                            chartYAxis="hidden"
                            chartYScale={{ from: 0, to: stageAxisValues[0] ?? 1 } as any}
                          >
                            {stageFilter === "全部" ? (
                              <BarStackChart marks={stageMarks as any} />
                            ) : (
                              <BarChart marks={stageMarks as any} />
                            )}
                          </Chart>
                          <HStack alignment="top" spacing={0} frame={{ width: contentWidth }}>
                            {stageBuckets.map((bucket) => (
                              <VStack
                                key={`stage-${bucket.key}`}
                                frame={{ width: stageCellWidth, alignment: "center" as any }}
                              >
                                <Text
                                  font="caption2"
                                  foregroundStyle={palette.mutedInk}
                                  lineLimit={1}
                                  frame={{ width: stageCellWidth, alignment: "center" as any }}
                                >
                                  {bucket.label}
                                </Text>
                              </VStack>
                            ))}
                          </HStack>
                        </VStack>
                      </ScrollView>

                      <VStack spacing={0}>
                        {stageAxisValues.map((value) => (
                          <Text
                            key={`stage-right-${value}`}
                            font="caption2"
                            foregroundStyle={palette.mutedInk}
                            lineLimit={1}
                            frame={{ width: 32, height: 55, alignment: "leading" as any }}
                          >
                            {value}
                          </Text>
                        ))}
                      </VStack>
                    </HStack>
                  )
                }}
              </GeometryReader>
            </VStack>

            <VStack spacing={8}>
              <HStack
                spacing={0}
                frame={{ width: "100%" as any, height: 16 }}
                background={{ style: palette.cardSoft, shape: { type: "rect", cornerRadius: 999 } }}
              >
                {stageSummary.map((item) => (
                  <HStack
                    key={`distribution-${item.label}`}
                    frame={{ width: `${Math.max(6, item.ratio * 100)}%` as any, height: 16 }}
                    background={{ style: item.tone as any, shape: { type: "rect", cornerRadius: 999 } }}
                  />
                ))}
              </HStack>
            </VStack>

            {(stageSummary.map((item) => (
              <HStack
                key={item.label}
                spacing={10}
                alignment="center"
                frame={{ width: "100%" as any, maxWidth: "infinity" as any, alignment: "leading" as any }}
              >
                <GeometryReader frame={{ maxWidth: "infinity" as any, height: 28 }}>
                  {({ size }: any) => {
                    const fillWidth = Math.max(0, Math.min(size.width, size.width * item.ratio))

                    return (
                      <ZStack frame={{ width: size.width, height: 28, alignment: "leading" as any }}>
                        <HStack
                          frame={{ width: size.width, height: 28 }}
                          background={{ style: palette.cardSoft, shape: { type: "rect", cornerRadius: 999 } }}
                        >
                          <Spacer />
                        </HStack>
                        <HStack frame={{ width: size.width, height: 28 }}>
                          <HStack
                            frame={{ width: fillWidth, height: 28 }}
                            background={{ style: item.tone as any, shape: { type: "rect", cornerRadius: 999 } }}
                          >
                            <Spacer />
                          </HStack>
                          <Spacer />
                        </HStack>
                        <Text
                          font="body"
                          foregroundStyle={palette.ink}
                          padding={{ horizontal: 12 }}
                          lineLimit={1}
                          frame={{ width: size.width, alignment: "leading" as any }}
                        >
                          {`${item.label} ${formatHoursMinutes(item.minutes)}`}
                        </Text>
                      </ZStack>
                    )
                  }}
                </GeometryReader>
                <Text font="body" foregroundStyle={item.tone as any} frame={{ width: 52, height: 28, alignment: "trailing" as any }}>
                  {`${Math.round(item.ratio * 100)}%`}
                </Text>
              </HStack>
            )) as any)}
          </SoftCard>

          <SoftCard
            title="入睡时间"
            subtitle={`平均入睡 ${formatWrappedClock(avgBedtime)}`}
            trailing={
              <Text font="caption" foregroundStyle={palette.mutedInk}>
                23:00前 {hasRealData ? earlyBedCount : "--"}次
              </Text>
            }
          >
            <HStack spacing={12}>
              <MetricTile label="平均入睡" value={formatWrappedClock(avgBedtime)} tone={palette.sleepCore} />
              <MetricTile
                label="最早 / 最晚"
                value={hasRealData ? `${formatWrappedClock(safeMin(bedtimes))} / ${formatWrappedClock(safeMax(bedtimes))}` : "-- / --"}
                tone={palette.okay}
                valueFont="title3"
                valueLineLimit={1}
              />
            </HStack>

            <ScrollView
              key={`calendar-${mode}`}
              axes="horizontal"
              scrollIndicator="hidden"
              defaultScrollAnchor={calendarAnchor as any}
              scrollTargetBehavior="viewAligned"
              frame={{ maxWidth: "infinity" }}
            >
              <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }} scrollTargetlayout>
                {calendarItems.map((item) => (
                  <VStack
                    key={`calendar-${item.key}`}
                    spacing={4}
                    padding={8}
                    frame={{ width: 56, alignment: "center" as any }}
                  >
                    <Text font="caption2" foregroundStyle={palette.mutedInk}>
                      {item.label}
                    </Text>
                    <Text
                      font="title3"
                      frame={{ width: 40, height: 40, alignment: "center" as any }}
                      background={{ style: item.background as any, shape: { type: "rect", cornerRadius: 18 } }}
                    >
                      {item.emoji}
                    </Text>
                    <Text font="caption2" foregroundStyle={palette.mutedInk}>
                      {item.bedtime}
                    </Text>
                  </VStack>
                ))}
              </HStack>
            </ScrollView>
          </SoftCard>

          <SoftCard title="睡眠规律" subtitle={`平均入睡 ${formatWrappedClock(avgBedtime)} · 平均起床 ${formatWrappedClock(avgWake)}`}>
            <HStack spacing={12}>
              <MetricTile label="入睡规律" value={bedtimeRegularity == null ? "--" : `${bedtimeRegularity}%`} tone={palette.sleepCore} />
              <MetricTile label="起床规律" value={wakeRegularity == null ? "--" : `${wakeRegularity}%`} tone={palette.accentDeep} />
            </HStack>

            <HStack alignment="top" spacing={10}>
              <VStack spacing={0}>
                {["22:00", "00:00", "02:00", "04:00", "06:00", "08:00", "10:00"].map((label) => (
                  <Text
                    key={label}
                    font="caption2"
                    foregroundStyle={palette.mutedInk}
                    frame={{ height: 36, alignment: "trailing" as any }}
                  >
                    {label}
                  </Text>
                ))}
              </VStack>
              <ScrollView
                key={`regularity-${mode}`}
                axes="horizontal"
                scrollIndicator="hidden"
                defaultScrollAnchor={regularityAnchor as any}
                scrollTargetBehavior="viewAligned"
                frame={{ maxWidth: "infinity" }}
              >
                <HStack alignment="top" spacing={8} scrollTargetlayout>
                  {regularityColumns.map((item) => {
                    const startMinutes = Math.max(22 * 60, Math.min(34 * 60, item.start ?? 22 * 60))
                    const endMinutes = Math.max(startMinutes + 30, Math.min(34 * 60, item.end ?? startMinutes + 30))
                    const totalWindow = 12 * 60
                    const top = Math.round(((startMinutes - 22 * 60) / totalWindow) * 220)
                    const height = Math.max(18, Math.round(((endMinutes - startMinutes) / totalWindow) * 220))
                    return (
                      <VStack key={`regularity-${item.dateKey}`} spacing={6} frame={{ width: 28, alignment: "center" as any }}>
                        <VStack
                          frame={{ width: 18, height: 220 }}
                          background={{ style: palette.cardSoft, shape: { type: "rect", cornerRadius: 10 } }}
                        >
                          {item.hasData ? (
                            <VStack frame={{ width: 18, height: 220 }}>
                              <VStack frame={{ width: 18, height: top }} />
                              <VStack
                                frame={{ width: 18, height }}
                                background={{ style: item.foregroundStyle, shape: { type: "rect", cornerRadius: 10 } }}
                              />
                              <Spacer />
                            </VStack>
                          ) : (
                            <Spacer />
                          )}
                        </VStack>
                        <Text font="caption2" foregroundStyle={palette.mutedInk}>
                          {item.label}
                        </Text>
                      </VStack>
                    )
                  })}
                </HStack>
              </ScrollView>
            </HStack>

            <HStack>
              <Text foregroundStyle={palette.poor}>
                最晚入睡 {hasRealData ? formatWrappedClock(safeMax(bedtimes)) : "--"}
              </Text>
              <Spacer />
              <Text foregroundStyle={palette.accentDeep}>
                最早起床 {hasRealData ? formatWrappedClock(safeMin(wakeTimes)) : "--"}
              </Text>
            </HStack>
          </SoftCard>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}
