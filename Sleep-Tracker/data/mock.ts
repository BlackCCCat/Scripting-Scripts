import { Widget } from "scripting"
import type { DailyHealthMetrics, SleepNight, SleepSegment, SleepTrackerSnapshot } from "../types"
import { addDays, clamp, dateKeyFromDate, startOfDay } from "../utils"

const MOCK_CACHE_KEY = "sleep_tracker.mock_snapshot.v1"
export const MOCK_HISTORY_DAYS = 120
export const DAILY_AROUND_TODAY_DAYS = 15

function splitRounded(total: number, ratios: number[]) {
  const raw = ratios.map((ratio) => total * ratio)
  const rounded = raw.map((value) => Math.max(1, Math.floor(value)))
  let remainder = total - rounded.reduce((sum, value) => sum + value, 0)

  for (let index = 0; remainder > 0; index = (index + 1) % rounded.length) {
    rounded[index] += 1
    remainder -= 1
  }

  return rounded
}

function buildSegments(nightKey: string, bedtime: Date, totalSleepMinutes: number, awakeMinutes: number): SleepSegment[] {
  const segments: SleepSegment[] = []
  const [core1, deep1, core2, rem1, core3, deep2, rem2] = splitRounded(totalSleepMinutes, [
    0.18, 0.14, 0.17, 0.12, 0.21, 0.08, 0.10,
  ])
  const [awake1, awake2, awake3] = splitRounded(Math.max(3, awakeMinutes), [0.34, 0.28, 0.38])

  const blocks: Array<{ stage: SleepSegment["stage"]; minutes: number }> = [
    { stage: "asleepCore", minutes: core1 },
    { stage: "asleepDeep", minutes: deep1 },
    { stage: "asleepCore", minutes: core2 },
    { stage: "awake", minutes: awake1 },
    { stage: "asleepREM", minutes: rem1 },
    { stage: "asleepCore", minutes: core3 },
    { stage: "awake", minutes: awake2 },
    { stage: "asleepDeep", minutes: deep2 },
    { stage: "asleepREM", minutes: rem2 },
    { stage: "awake", minutes: awake3 },
  ]

  let cursor = new Date(bedtime)
  blocks.forEach((block, index) => {
    const end = new Date(cursor.getTime() + block.minutes * 60 * 1000)
    segments.push({
      id: `${nightKey}-${index}`,
      nightKey,
      stage: block.stage,
      startISO: cursor.toISOString(),
      endISO: end.toISOString(),
      minutes: block.minutes,
    })
    cursor = end
  })

  return segments
}

function buildMockDay(date: Date, offsetFromToday: number): { daily: DailyHealthMetrics; night: SleepNight } {
  const index = offsetFromToday + MOCK_HISTORY_DAYS
  const weekday = date.getDay()
  const weekend = weekday === 0 || weekday === 6

  const bedtimeMinutes = Math.round(
    clamp(
      23 * 60 +
        4 +
        Math.sin(index * 0.31) * 26 +
        Math.cos(index * 0.13) * 18 +
        (weekend ? 18 : -6) +
        offsetFromToday * 0.25,
      22 * 60 + 5,
      24 * 60 + 18
    )
  )
  const totalSleepMinutes = Math.round(
    clamp(450 + Math.sin(index * 0.39) * 34 + Math.cos(index * 0.16) * 22 + (weekend ? 16 : 0), 372, 540)
  )
  const awakeMinutes = Math.round(clamp(18 + Math.cos(index * 0.44) * 7 + (weekend ? 4 : 0), 8, 38))
  const totalInBedMinutes = totalSleepMinutes + awakeMinutes + Math.round(clamp(8 + Math.sin(index * 0.21) * 4, 3, 14))

  const deepMinutes = Math.round(clamp(totalSleepMinutes * (0.2 + Math.sin(index * 0.27) * 0.025), 72, 130))
  const remMinutes = Math.round(clamp(totalSleepMinutes * (0.23 + Math.cos(index * 0.19) * 0.03), 80, 145))
  const coreMinutes = Math.max(120, totalSleepMinutes - deepMinutes - remMinutes)

  const wakeDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const bedtimeBaseDate = addDays(wakeDate, bedtimeMinutes >= 24 * 60 ? 0 : -1)
  const bedtime = new Date(
    bedtimeBaseDate.getFullYear(),
    bedtimeBaseDate.getMonth(),
    bedtimeBaseDate.getDate(),
    Math.floor((bedtimeMinutes % (24 * 60)) / 60),
    bedtimeMinutes % 60
  )
  const wake = new Date(bedtime.getTime() + totalInBedMinutes * 60 * 1000)

  const nightKey = dateKeyFromDate(date)
  const segments = buildSegments(nightKey, bedtime, totalSleepMinutes, awakeMinutes)

  const night: SleepNight = {
    nightKey,
    bedtimeISO: bedtime.toISOString(),
    wakeISO: wake.toISOString(),
    totalSleepMinutes,
    totalInBedMinutes,
    awakeMinutes,
    efficiency: totalSleepMinutes / Math.max(1, totalInBedMinutes),
    stages: {
      inBed: totalInBedMinutes,
      awake: awakeMinutes,
      asleepUnspecified: 0,
      asleepCore: coreMinutes,
      asleepDeep: deepMinutes,
      asleepREM: remMinutes,
    },
    segments,
  }

  const daily: DailyHealthMetrics = {
    dateKey: nightKey,
    dateISO: startOfDay(date).toISOString(),
    sleepNightKey: nightKey,
    bedtimeISO: bedtime.toISOString(),
    wakeISO: wake.toISOString(),
    totalSleepMinutes,
    totalInBedMinutes,
    awakeMinutes,
    napMinutes: 0,
    napCount: 0,
    sleepStages: { ...night.stages },
    stepCount: Math.round(clamp(7800 + Math.sin(index * 0.25) * 2100, 4200, 13200)),
    activeEnergyKcal: Math.round(clamp(460 + Math.cos(index * 0.28) * 90, 260, 720)),
    moveGoalKcal: 500,
    exerciseMinutes: Math.round(clamp(26 + Math.sin(index * 0.31) * 12, 8, 52)),
    exerciseGoalMinutes: 30,
    standHours: Math.round(clamp(10 + Math.cos(index * 0.4) * 2, 6, 13)),
    standGoalHours: 12,
    daylightMinutes: Math.round(clamp(42 + Math.sin(index * 0.23) * 18, 15, 90)),
    mindfulMinutes: Math.round(clamp(7 + Math.cos(index * 0.35) * 4, 0, 18)),
    apneaEvents: Math.max(0, Math.round(1 + Math.cos(index * 0.42) * 2)),
    avgHeartRate: Math.round(clamp(59 + Math.cos(index * 0.22) * 4, 53, 68)),
    restingHeartRate: Math.round(clamp(56 + Math.sin(index * 0.17) * 3, 50, 63)),
    hrvMs: Math.round(clamp(49 + Math.cos(index * 0.12) * 11, 28, 74)),
    respiratoryRate: Math.round(clamp(14 + Math.sin(index * 0.21) * 1.4, 11, 17)),
    oxygenSaturationPercent: Math.round(clamp(97 + Math.cos(index * 0.16) * 1.1, 94, 99)),
    wristTemperatureCelsius: Math.round((36.45 + Math.sin(index * 0.11) * 0.18) * 10) / 10,
  }

  return { daily, night }
}

export function generateMockSleepTrackerSnapshot(queryDays = MOCK_HISTORY_DAYS): SleepTrackerSnapshot {
  const today = startOfDay(new Date())
  const startOffset = -(queryDays - 1)
  const endOffset = DAILY_AROUND_TODAY_DAYS
  const daily: DailyHealthMetrics[] = []
  const nights: SleepNight[] = []

  for (let offset = startOffset; offset <= endOffset; offset += 1) {
    const date = addDays(today, offset)
    const item = buildMockDay(date, offset)
    daily.push(item.daily)
    nights.push(item.night)
  }

  return {
    generatedAtISO: new Date().toISOString(),
    queryDays,
    daily,
    nights,
  }
}

export function loadMockSleepTrackerSnapshot(): SleepTrackerSnapshot | null {
  const raw = Storage.get<any>(MOCK_CACHE_KEY)
  if (!raw || typeof raw !== "object") return null
  if (!Array.isArray(raw.daily) || !Array.isArray(raw.nights)) return null
  return raw as SleepTrackerSnapshot
}

export async function refreshMockSleepTrackerSnapshot(queryDays = MOCK_HISTORY_DAYS): Promise<SleepTrackerSnapshot> {
  const snapshot = generateMockSleepTrackerSnapshot(queryDays)
  Storage.set(MOCK_CACHE_KEY, snapshot)
  if (typeof Widget.reloadAll === "function") {
    await Widget.reloadAll()
  }
  return snapshot
}
