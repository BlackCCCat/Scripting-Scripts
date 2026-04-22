import { stageColor } from "../theme"
import type {
  DailyHealthMetrics,
  RangeValue,
  SleepStageTotals,
  SleepTrackerSettings,
  SleepTrackerSnapshot,
} from "../types"
import {
  addDays,
  average,
  clamp,
  formatShortDateFromKey,
  formatUpdatedAt,
  normalizePercentValue,
  parseDateKey,
  sleepEfficiencyPercent,
  sleepEfficiencyRatio,
  startOfDay,
} from "../utils"

export type DashboardDay = DailyHealthMetrics & {
  sleepScore: number | null
}

export type DashboardBundle = {
  days: DashboardDay[]
  latestDay: DashboardDay | null
  averageSleepMinutes: number
  averageScore: number
  averageEfficiency: number
  stageTotals: SleepStageTotals
  scoreTrendMarks: Array<{ label: string; value: number; foregroundStyle: string }>
  durationTrendMarks: Array<{ label: string; value: number; foregroundStyle: string }>
  stageStackMarks: Array<{ label: string; category: string; value: number; foregroundStyle: string }>
  restingHeartRateMarks: Array<{ label: string; value: number; foregroundStyle: string }>
  oxygenMarks: Array<{ label: string; value: number; foregroundStyle: string }>
  activityMarks: Array<{ label: string; value: number; foregroundStyle: string }>
  scoreCalendar: DashboardDay[]
  scoreSummaryBars: Array<{ label: string; value: number; foregroundStyle: string }>
  longestSleepMinutes: number
  shortestSleepMinutes: number
  totalNapMinutes: number
  napDays: number
  lastUpdatedLabel: string
  goalHours: number
}

function emptyStageTotals(): SleepStageTotals {
  return {
    inBed: 0,
    awake: 0,
    asleepUnspecified: 0,
    asleepCore: 0,
    asleepDeep: 0,
    asleepREM: 0,
  }
}

function filterDays(snapshot: SleepTrackerSnapshot, rangeDays: RangeValue): DailyHealthMetrics[] {
  const today = startOfDay(new Date())
  const start = addDays(today, -(rangeDays - 1))
  return snapshot.daily.filter((item) => {
    const d = parseDateKey(item.dateKey)
    return d >= start && d <= today
  })
}

export function computeSleepScore(day: DailyHealthMetrics, settings: SleepTrackerSettings): number | null {
  if (day.totalSleepMinutes == null || day.totalSleepMinutes <= 0) return null

  const goal = Math.max(1, settings.sleepGoalMinutes)
  const durationRatio = day.totalSleepMinutes / goal
  const durationComponent =
    durationRatio <= 1
      ? clamp(durationRatio * 100, 0, 100)
      : clamp(100 - (durationRatio - 1) * 38, 72, 100)

  const efficiency = sleepEfficiencyRatio(day.totalSleepMinutes, day.totalInBedMinutes)
  const efficiencyComponent = clamp(efficiency * 100, 0, 100)

  const restorative =
    (day.sleepStages.asleepDeep + day.sleepStages.asleepREM) / Math.max(1, day.totalSleepMinutes)
  const restorativeComponent = clamp((restorative / 0.35) * 100, 0, 100)

  const awakeMinutes = Math.max(0, day.awakeMinutes ?? 0)
  const awakeComponent = clamp(100 - awakeMinutes * 2.2, 0, 100)

  const score =
    durationComponent * 0.42 +
    efficiencyComponent * 0.28 +
    restorativeComponent * 0.18 +
    awakeComponent * 0.12

  return Math.round(clamp(score, 0, 100))
}

function buildStageTotals(days: DashboardDay[]): SleepStageTotals {
  const totals = emptyStageTotals()
  for (const day of days) {
    totals.inBed += day.sleepStages.inBed
    totals.awake += day.sleepStages.awake
    totals.asleepUnspecified += day.sleepStages.asleepUnspecified
    totals.asleepCore += day.sleepStages.asleepCore
    totals.asleepDeep += day.sleepStages.asleepDeep
    totals.asleepREM += day.sleepStages.asleepREM
  }
  return totals
}

function durationTone(score: number | null): string {
  if (score == null) return "#CCD2E4"
  if (score >= 85) return "#33C7B2"
  if (score >= 75) return "#4D7BF3"
  if (score >= 65) return "#F3B548"
  return "#FF7B7B"
}

function buildStageStackMarks(days: DashboardDay[]) {
  return days
    .filter((day) => (day.totalSleepMinutes ?? 0) > 0)
    .flatMap((day) => [
      {
        label: formatShortDateFromKey(day.dateKey),
        category: "深度",
        value: day.sleepStages.asleepDeep / 60,
        foregroundStyle: stageColor("asleepDeep"),
      },
      {
        label: formatShortDateFromKey(day.dateKey),
        category: "核心",
        value: day.sleepStages.asleepCore / 60,
        foregroundStyle: stageColor("asleepCore"),
      },
      {
        label: formatShortDateFromKey(day.dateKey),
        category: "眼动",
        value: day.sleepStages.asleepREM / 60,
        foregroundStyle: stageColor("asleepREM"),
      },
      {
        label: formatShortDateFromKey(day.dateKey),
        category: "清醒",
        value: (day.awakeMinutes ?? day.sleepStages.awake) / 60,
        foregroundStyle: stageColor("awake"),
      },
    ])
    .filter((item) => item.value > 0)
}

function buildScoreSummaryBars(days: DashboardDay[], settings: SleepTrackerSettings) {
  const sleepDays = days.filter((day) => day.sleepScore != null)
  const averageGoalHit = average(
    sleepDays.map((day) =>
      clamp(((day.totalSleepMinutes ?? 0) / Math.max(1, settings.sleepGoalMinutes)) * 100, 0, 100)
    )
  )
  const averageEfficiency = average(
    sleepDays.map((day) => sleepEfficiencyPercent(day.totalSleepMinutes, day.totalInBedMinutes))
  )
  const restorativeRatio = average(
    sleepDays.map((day) =>
      ((day.sleepStages.asleepDeep + day.sleepStages.asleepREM) / Math.max(1, day.totalSleepMinutes ?? 1)) * 100
    )
  )
  const activeDays = average(
    sleepDays.map((day) => clamp(((day.exerciseMinutes ?? 0) / 30) * 100, 0, 100))
  )

  return [
    { label: "时长达标", value: averageGoalHit, foregroundStyle: "#33C7B2" },
    { label: "睡眠效率", value: averageEfficiency, foregroundStyle: "#4D7BF3" },
    { label: "恢复性睡眠", value: restorativeRatio, foregroundStyle: "#5C59D0" },
    { label: "日间活动", value: activeDays, foregroundStyle: "#F3B548" },
  ]
}

export function buildDashboardBundle(
  snapshot: SleepTrackerSnapshot | null,
  settings: SleepTrackerSettings,
  rangeDays: RangeValue
): DashboardBundle | null {
  if (!snapshot) return null

  const days = filterDays(snapshot, rangeDays).map((day) => ({
    ...day,
    sleepScore: computeSleepScore(day, settings),
  }))

  const sleepDays = days.filter((day) => day.sleepScore != null)
  const latestDay = [...days].reverse().find((day) => (day.totalSleepMinutes ?? 0) > 0) ?? null
  const averageSleepMinutes = average(sleepDays.map((day) => day.totalSleepMinutes ?? 0))
  const averageScore = average(sleepDays.map((day) => day.sleepScore ?? 0))
  const averageEfficiency = average(
    sleepDays.map((day) => sleepEfficiencyRatio(day.totalSleepMinutes, day.totalInBedMinutes))
  )
  const longestSleepMinutes = sleepDays.reduce((max, day) => Math.max(max, day.totalSleepMinutes ?? 0), 0)
  const shortestSleepMinutes = sleepDays.reduce((min, day) => {
    const duration = day.totalSleepMinutes ?? 0
    return duration > 0 ? Math.min(min, duration) : min
  }, Number.POSITIVE_INFINITY)

  return {
    days,
    latestDay,
    averageSleepMinutes: Math.round(averageSleepMinutes),
    averageScore: Math.round(averageScore),
    averageEfficiency,
    stageTotals: buildStageTotals(sleepDays),
    scoreTrendMarks: sleepDays.map((day) => ({
      label: formatShortDateFromKey(day.dateKey),
      value: day.sleepScore ?? 0,
      foregroundStyle: durationTone(day.sleepScore),
    })),
    durationTrendMarks: sleepDays.map((day) => ({
      label: formatShortDateFromKey(day.dateKey),
      value: Math.round(((day.totalSleepMinutes ?? 0) / 60) * 10) / 10,
      foregroundStyle: durationTone(day.sleepScore),
    })),
    stageStackMarks: buildStageStackMarks(sleepDays),
    restingHeartRateMarks: sleepDays
      .filter((day) => day.restingHeartRate != null)
      .map((day) => ({
        label: formatShortDateFromKey(day.dateKey),
        value: Math.round(day.restingHeartRate ?? 0),
        foregroundStyle: "#5C59D0",
      })),
    oxygenMarks: sleepDays
      .filter((day) => day.oxygenSaturationPercent != null)
      .map((day) => ({
        label: formatShortDateFromKey(day.dateKey),
        value: Math.round(normalizePercentValue(day.oxygenSaturationPercent) ?? 0),
        foregroundStyle: "#33C7B2",
      })),
    activityMarks: sleepDays.map((day) => ({
      label: formatShortDateFromKey(day.dateKey),
      value: Math.round((day.exerciseMinutes ?? 0) / 5),
      foregroundStyle: "#F3B548",
    })),
    scoreCalendar: sleepDays.slice(-35),
    scoreSummaryBars: buildScoreSummaryBars(sleepDays, settings),
    longestSleepMinutes,
    shortestSleepMinutes: Number.isFinite(shortestSleepMinutes) ? shortestSleepMinutes : 0,
    totalNapMinutes: days.reduce((sum, day) => sum + (day.napMinutes ?? 0), 0),
    napDays: days.filter((day) => (day.napMinutes ?? 0) > 0).length,
    lastUpdatedLabel: formatUpdatedAt(snapshot.generatedAtISO),
    goalHours: Math.round((settings.sleepGoalMinutes / 60) * 10) / 10,
  }
}
