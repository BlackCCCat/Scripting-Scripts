import type {
  DailyHealthMetrics,
  SleepNight,
  SleepSegment,
  SleepStageKey,
  SleepStageTotals,
  SleepTrackerSnapshot,
} from "../types"
import { addDays, dateKeyFromDate, startOfDay } from "../utils"

const CACHE_KEY = "sleep_tracker.snapshot.v3"
const NOON_HOUR = 12
const SESSION_BREAK_MINUTES = 120
const NAP_MAX_MINUTES = 240

export const DEFAULT_QUERY_DAYS = 365

type SleepSessionDraft = {
  bedtime: Date
  wake: Date
  stages: SleepStageTotals
  segments: SleepSegment[]
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

function emptyDailyMetric(date: Date): DailyHealthMetrics {
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
    sleepStages: emptyStageTotals(),
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
  }
}

function buildDailyMap(queryDays: number): Map<string, DailyHealthMetrics> {
  const map = new Map<string, DailyHealthMetrics>()
  const today = startOfDay(new Date())
  const start = addDays(today, -(queryDays - 1))
  let cursor = start
  while (cursor <= today) {
    map.set(dateKeyFromDate(cursor), emptyDailyMetric(cursor))
    cursor = addDays(cursor, 1)
  }
  return map
}

function sleepStageFromValue(value: number): SleepStageKey | null {
  switch (value) {
    case HealthCategoryValueSleepAnalysis.inBed:
      return "inBed"
    case HealthCategoryValueSleepAnalysis.awake:
      return "awake"
    case HealthCategoryValueSleepAnalysis.asleepCore:
      return "asleepCore"
    case HealthCategoryValueSleepAnalysis.asleepDeep:
      return "asleepDeep"
    case HealthCategoryValueSleepAnalysis.asleepREM:
      return "asleepREM"
    case HealthCategoryValueSleepAnalysis.asleepUnspecified:
      return "asleepUnspecified"
    default:
      return null
  }
}

function buildNightAnchor(date: Date): Date {
  const local = new Date(date)
  if (local.getHours() < NOON_HOUR) {
    local.setDate(local.getDate() - 1)
  }
  return startOfDay(local)
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
}

function cloneSessionDraft(start: Date, end: Date): SleepSessionDraft {
  return {
    bedtime: start,
    wake: end,
    stages: emptyStageTotals(),
    segments: [],
  }
}

function totalSleepMinutes(stages: SleepStageTotals): number {
  return (
    stages.asleepUnspecified +
    stages.asleepCore +
    stages.asleepDeep +
    stages.asleepREM
  )
}

function isNapSession(session: SleepSessionDraft): boolean {
  const sleepMinutes = totalSleepMinutes(session.stages)
  const durationMinutes = Math.max(sleepMinutes, minutesBetween(session.bedtime, session.wake))
  const bedtimeHour = session.bedtime.getHours() + session.bedtime.getMinutes() / 60
  const midpoint = new Date((session.bedtime.getTime() + session.wake.getTime()) / 2)
  const midpointHour = midpoint.getHours() + midpoint.getMinutes() / 60
  const daytimeStart = bedtimeHour >= 9 && bedtimeHour < 19
  const daytimeMidpoint = midpointHour >= 10 && midpointHour < 20

  return durationMinutes <= NAP_MAX_MINUTES && (daytimeStart || daytimeMidpoint)
}

function buildSleepData(samples: HealthCategorySample[]): {
  nights: SleepNight[]
  napMap: Map<string, { minutes: number; count: number }>
} {
  const normalizedSegments = samples
    .map((sample, index) => {
      const stage = sleepStageFromValue(sample.value)
      const start = sample.startDate
      const end = sample.endDate
      if (!stage || !(start instanceof Date) || !(end instanceof Date) || end <= start) return null
      return {
        id: `segment-${index}-${start.getTime()}`,
        stage,
        start,
        end,
        minutes: minutesBetween(start, end),
      }
    })
    .filter((item): item is NonNullable<typeof item> => item != null)
    .sort((left, right) => left.start.getTime() - right.start.getTime())

  const sessions: SleepSessionDraft[] = []
  let currentSession: SleepSessionDraft | null = null

  for (const segment of normalizedSegments) {
    const gapMinutes =
      currentSession == null ? Number.POSITIVE_INFINITY : minutesBetween(currentSession.wake, segment.start)

    if (currentSession == null || gapMinutes > SESSION_BREAK_MINUTES) {
      currentSession = cloneSessionDraft(segment.start, segment.end)
      sessions.push(currentSession)
    }

    if (segment.start < currentSession.bedtime) currentSession.bedtime = segment.start
    if (segment.end > currentSession.wake) currentSession.wake = segment.end

    currentSession.stages[segment.stage] += segment.minutes
    currentSession.segments.push({
      id: segment.id,
      nightKey: "",
      stage: segment.stage,
      startISO: segment.start.toISOString(),
      endISO: segment.end.toISOString(),
      minutes: segment.minutes,
    })
  }

  const nightDrafts = new Map<string, SleepSessionDraft>()
  const napMap = new Map<string, { minutes: number; count: number }>()

  for (const session of sessions) {
    const sleepMinutes = totalSleepMinutes(session.stages)
    const inBedMinutes = session.stages.inBed
    const totalMinutes = Math.max(sleepMinutes, inBedMinutes, minutesBetween(session.bedtime, session.wake))
    if (totalMinutes <= 0) continue

    if (isNapSession(session)) {
      const key = dateKeyFromDate(startOfDay(session.bedtime))
      const existing = napMap.get(key) ?? { minutes: 0, count: 0 }
      existing.minutes += sleepMinutes > 0 ? sleepMinutes : totalMinutes
      existing.count += 1
      napMap.set(key, existing)
      continue
    }

    const nightKey = dateKeyFromDate(buildNightAnchor(session.bedtime))
    const draft = nightDrafts.get(nightKey) ?? cloneSessionDraft(session.bedtime, session.wake)

    if (session.bedtime < draft.bedtime) draft.bedtime = session.bedtime
    if (session.wake > draft.wake) draft.wake = session.wake

    draft.stages.inBed += session.stages.inBed
    draft.stages.awake += session.stages.awake
    draft.stages.asleepUnspecified += session.stages.asleepUnspecified
    draft.stages.asleepCore += session.stages.asleepCore
    draft.stages.asleepDeep += session.stages.asleepDeep
    draft.stages.asleepREM += session.stages.asleepREM
    draft.segments.push(
      ...session.segments.map((segment) => ({
        ...segment,
        nightKey,
      }))
    )
    nightDrafts.set(nightKey, draft)
  }

  const nights = [...nightDrafts.entries()]
    .map<SleepNight>(([nightKey, draft]) => {
      const sleepMinutes = totalSleepMinutes(draft.stages)
      const inBedMinutes = draft.stages.inBed
      const baseMinutes =
        inBedMinutes > 0
          ? Math.max(inBedMinutes, sleepMinutes)
          : Math.max(sleepMinutes, minutesBetween(draft.bedtime, draft.wake))

      return {
        nightKey,
        bedtimeISO: draft.bedtime.toISOString(),
        wakeISO: draft.wake.toISOString(),
        totalSleepMinutes: sleepMinutes,
        totalInBedMinutes: inBedMinutes,
        awakeMinutes: draft.stages.awake,
        efficiency: baseMinutes > 0 ? sleepMinutes / baseMinutes : 0,
        stages: draft.stages,
        segments: draft.segments.sort((left, right) => left.startISO.localeCompare(right.startISO)),
      }
    })
    .filter((night) => night.totalSleepMinutes > 0)
    .sort((left, right) => left.bedtimeISO.localeCompare(right.bedtimeISO))

  return { nights, napMap }
}

function mergeSleepIntoDaily(dailyMap: Map<string, DailyHealthMetrics>, nights: SleepNight[]) {
  for (const night of nights) {
    const wakeDate = new Date(night.wakeISO)
    const targetKey = dateKeyFromDate(startOfDay(wakeDate))
    const target = dailyMap.get(targetKey)
    if (!target) continue
    target.sleepNightKey = night.nightKey
    target.bedtimeISO = night.bedtimeISO
    target.wakeISO = night.wakeISO
    target.totalSleepMinutes = night.totalSleepMinutes
    target.totalInBedMinutes = night.totalInBedMinutes
    target.awakeMinutes = night.awakeMinutes
    target.sleepStages = night.stages
  }
}

function mergeNapIntoDaily(
  dailyMap: Map<string, DailyHealthMetrics>,
  napMap: Map<string, { minutes: number; count: number }>
) {
  for (const [key, nap] of napMap.entries()) {
    const target = dailyMap.get(key)
    if (!target) continue
    target.napMinutes = nap.minutes
    target.napCount = nap.count
  }
}

async function safeQueryCategorySamples(
  type: HealthCategoryType,
  startDate: Date,
  endDate: Date
): Promise<HealthCategorySample[]> {
  try {
    return await Health.queryCategorySamples(type, {
      startDate,
      endDate,
      sortDescriptors: [{ key: "startDate", order: "forward" }],
    })
  } catch {
    return []
  }
}

async function queryDailyStatisticsMap(
  quantityType: HealthQuantityType,
  options: {
    statisticsOptions: HealthStatisticsOptions | HealthStatisticsOptions[]
    valueGetter: (stat: HealthStatistics) => number | null
    startDate: Date
    endDate: Date
  }
): Promise<Map<string, number>> {
  try {
    const collection = await Health.queryStatisticsCollection(quantityType, {
      startDate: options.startDate,
      endDate: options.endDate,
      anchorDate: startOfDay(options.startDate),
      intervalComponents: new DateComponents({ day: 1 }),
      statisticsOptions: options.statisticsOptions,
    })

    const map = new Map<string, number>()
    for (const stat of collection.statistics()) {
      const value = options.valueGetter(stat)
      if (value == null || !Number.isFinite(value)) continue
      map.set(dateKeyFromDate(stat.startDate), value)
    }
    return map
  } catch {
    return new Map()
  }
}

function mergeMetricMap(
  dailyMap: Map<string, DailyHealthMetrics>,
  metricMap: Map<string, number>,
  apply: (target: DailyHealthMetrics, value: number) => void
) {
  for (const [key, value] of metricMap.entries()) {
    const target = dailyMap.get(key)
    if (!target) continue
    apply(target, value)
  }
}

async function queryMindfulMinutes(startDate: Date, endDate: Date) {
  const samples = await safeQueryCategorySamples("mindfulSession", startDate, endDate)
  const map = new Map<string, number>()
  for (const sample of samples) {
    const key = dateKeyFromDate(sample.startDate)
    map.set(key, (map.get(key) ?? 0) + minutesBetween(sample.startDate, sample.endDate))
  }
  return map
}

async function queryApneaCounts(startDate: Date, endDate: Date) {
  const samples = await safeQueryCategorySamples("sleepApneaEvent", startDate, endDate)
  const map = new Map<string, number>()
  for (const sample of samples) {
    const key = dateKeyFromDate(buildNightAnchor(sample.startDate))
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
}

async function queryActivitySummaries(startDate: Date, endDate: Date) {
  try {
    const summaries = await Health.queryActivitySummaries({
      start: DateComponents.fromDate(startDate),
      end: DateComponents.fromDate(endDate),
    })
    return summaries
  } catch {
    return []
  }
}

function normalizeSnapshot(raw: any): SleepTrackerSnapshot | null {
  if (!raw || typeof raw !== "object") return null
  if (!Array.isArray(raw.nights) || !Array.isArray(raw.daily) || typeof raw.generatedAtISO !== "string") {
    return null
  }

  return {
    generatedAtISO: raw.generatedAtISO,
    queryDays: typeof raw.queryDays === "number" ? raw.queryDays : DEFAULT_QUERY_DAYS,
    nights: raw.nights,
    daily: raw.daily.map((item: DailyHealthMetrics) => ({
      ...item,
      napMinutes: item.napMinutes ?? null,
      napCount: item.napCount ?? 0,
    })),
  }
}

export async function refreshSleepTrackerSnapshot(queryDays = DEFAULT_QUERY_DAYS): Promise<SleepTrackerSnapshot> {
  if (!Health.isHealthDataAvailable) {
    throw new Error("当前设备不支持 Health 数据读取。")
  }

  const today = startOfDay(new Date())
  const startDate = addDays(today, -(queryDays - 1))
  const endDate = new Date()
  const dailyMap = buildDailyMap(queryDays)

  const [
    sleepSamples,
    mindfulMap,
    apneaMap,
    activitySummaries,
    stepMap,
    energyMap,
    exerciseMap,
    daylightMap,
    averageHeartRateMap,
    restingHeartRateMap,
    hrvMap,
    respiratoryRateMap,
    oxygenMap,
    wristTemperatureMap,
  ] = await Promise.all([
    safeQueryCategorySamples("sleepAnalysis", addDays(startDate, -1), endDate),
    queryMindfulMinutes(startDate, endDate),
    queryApneaCounts(startDate, endDate),
    queryActivitySummaries(startDate, endDate),
    queryDailyStatisticsMap("stepCount", {
      startDate,
      endDate,
      statisticsOptions: ["cumulativeSum"],
      valueGetter: (stat) => stat.sumQuantity(HealthUnit.count()),
    }),
    queryDailyStatisticsMap("activeEnergyBurned", {
      startDate,
      endDate,
      statisticsOptions: ["cumulativeSum"],
      valueGetter: (stat) => stat.sumQuantity(HealthUnit.kilocalorie()),
    }),
    queryDailyStatisticsMap("appleExerciseTime", {
      startDate,
      endDate,
      statisticsOptions: ["cumulativeSum"],
      valueGetter: (stat) => stat.sumQuantity(HealthUnit.minute()),
    }),
    queryDailyStatisticsMap("timeInDaylight", {
      startDate,
      endDate,
      statisticsOptions: ["cumulativeSum"],
      valueGetter: (stat) => stat.sumQuantity(HealthUnit.minute()),
    }),
    queryDailyStatisticsMap("heartRate", {
      startDate,
      endDate,
      statisticsOptions: ["discreteAverage"],
      valueGetter: (stat) => stat.averageQuantity(HealthUnit.count().divided(HealthUnit.minute())),
    }),
    queryDailyStatisticsMap("restingHeartRate", {
      startDate,
      endDate,
      statisticsOptions: ["discreteAverage"],
      valueGetter: (stat) => stat.averageQuantity(HealthUnit.count().divided(HealthUnit.minute())),
    }),
    queryDailyStatisticsMap("heartRateVariabilitySDNN", {
      startDate,
      endDate,
      statisticsOptions: ["discreteAverage"],
      valueGetter: (stat) => stat.averageQuantity(HealthUnit.secondUnit(HealthMetricPrefix.milli)),
    }),
    queryDailyStatisticsMap("respiratoryRate", {
      startDate,
      endDate,
      statisticsOptions: ["discreteAverage"],
      valueGetter: (stat) => stat.averageQuantity(HealthUnit.count().divided(HealthUnit.minute())),
    }),
    queryDailyStatisticsMap("oxygenSaturation", {
      startDate,
      endDate,
      statisticsOptions: ["discreteAverage"],
      valueGetter: (stat) => stat.averageQuantity(HealthUnit.percent()),
    }),
    queryDailyStatisticsMap("appleSleepingWristTemperature", {
      startDate,
      endDate,
      statisticsOptions: ["discreteAverage"],
      valueGetter: (stat) => stat.averageQuantity(HealthUnit.degreeCelsius()),
    }),
  ])

  const { nights, napMap } = buildSleepData(sleepSamples)

  mergeSleepIntoDaily(dailyMap, nights)
  mergeNapIntoDaily(dailyMap, napMap)
  mergeMetricMap(dailyMap, mindfulMap, (target, value) => {
    target.mindfulMinutes = value
  })
  mergeMetricMap(dailyMap, apneaMap, (target, value) => {
    target.apneaEvents = Math.round(value)
  })
  mergeMetricMap(dailyMap, stepMap, (target, value) => {
    target.stepCount = value
  })
  mergeMetricMap(dailyMap, energyMap, (target, value) => {
    target.activeEnergyKcal = value
  })
  mergeMetricMap(dailyMap, exerciseMap, (target, value) => {
    target.exerciseMinutes = value
  })
  mergeMetricMap(dailyMap, daylightMap, (target, value) => {
    target.daylightMinutes = value
  })
  mergeMetricMap(dailyMap, averageHeartRateMap, (target, value) => {
    target.avgHeartRate = value
  })
  mergeMetricMap(dailyMap, restingHeartRateMap, (target, value) => {
    target.restingHeartRate = value
  })
  mergeMetricMap(dailyMap, hrvMap, (target, value) => {
    target.hrvMs = value
  })
  mergeMetricMap(dailyMap, respiratoryRateMap, (target, value) => {
    target.respiratoryRate = value
  })
  mergeMetricMap(dailyMap, oxygenMap, (target, value) => {
    target.oxygenSaturationPercent = value
  })
  mergeMetricMap(dailyMap, wristTemperatureMap, (target, value) => {
    target.wristTemperatureCelsius = value
  })

  for (const summary of activitySummaries) {
    const date = summary.dateComponents.date
    if (!date) continue
    const key = dateKeyFromDate(date)
    const target = dailyMap.get(key)
    if (!target) continue
    target.activeEnergyKcal = summary.activeEnergyBurned(HealthUnit.kilocalorie())
    target.moveGoalKcal = summary.activeEnergyBurnedGoal(HealthUnit.kilocalorie())
    target.exerciseMinutes = summary.appleExerciseTime(HealthUnit.minute())
    target.exerciseGoalMinutes = summary.appleExerciseTimeGoal(HealthUnit.minute())
    target.standHours = summary.appleStandHours(HealthUnit.count())
    target.standGoalHours = summary.appleStandHoursGoal(HealthUnit.count())
  }

  const snapshot: SleepTrackerSnapshot = {
    generatedAtISO: new Date().toISOString(),
    queryDays,
    nights,
    daily: [...dailyMap.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
  }

  Storage.set(CACHE_KEY, snapshot)
  return snapshot
}

export function loadCachedSleepTrackerSnapshot(): SleepTrackerSnapshot | null {
  const raw = Storage.get<any>(CACHE_KEY)
  if (raw == null) return null
  if (typeof raw === "string") {
    try {
      return normalizeSnapshot(JSON.parse(raw))
    } catch {
      return null
    }
  }
  return normalizeSnapshot(raw)
}
