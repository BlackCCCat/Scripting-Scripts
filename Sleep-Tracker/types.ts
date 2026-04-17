export type RangeValue = number

export type SleepStageKey =
  | "inBed"
  | "awake"
  | "asleepUnspecified"
  | "asleepCore"
  | "asleepDeep"
  | "asleepREM"

export type SleepStageTotals = Record<SleepStageKey, number>

export type SleepSegment = {
  id: string
  nightKey: string
  stage: SleepStageKey
  startISO: string
  endISO: string
  minutes: number
}

export type SleepNight = {
  nightKey: string
  bedtimeISO: string
  wakeISO: string
  totalSleepMinutes: number
  totalInBedMinutes: number
  awakeMinutes: number
  efficiency: number
  stages: SleepStageTotals
  segments: SleepSegment[]
}

export type DailyHealthMetrics = {
  dateKey: string
  dateISO: string
  sleepNightKey: string | null
  bedtimeISO: string | null
  wakeISO: string | null
  totalSleepMinutes: number | null
  totalInBedMinutes: number | null
  awakeMinutes: number | null
  napMinutes: number | null
  napCount: number
  sleepStages: SleepStageTotals
  stepCount: number | null
  activeEnergyKcal: number | null
  moveGoalKcal: number | null
  exerciseMinutes: number | null
  exerciseGoalMinutes: number | null
  standHours: number | null
  standGoalHours: number | null
  daylightMinutes: number | null
  mindfulMinutes: number | null
  apneaEvents: number
  avgHeartRate: number | null
  restingHeartRate: number | null
  hrvMs: number | null
  respiratoryRate: number | null
  oxygenSaturationPercent: number | null
  wristTemperatureCelsius: number | null
}

export type SleepTrackerSnapshot = {
  generatedAtISO: string
  queryDays: number
  nights: SleepNight[]
  daily: DailyHealthMetrics[]
}

export type WidgetStyle = "score" | "duration" | "stages" | "schedule" | "efficiency" | "overview" | "regularity"

export type SleepTrackerSettings = {
  sleepGoalMinutes: number
  widgetStyleSmall: WidgetStyle
  widgetStyleMedium: WidgetStyle
  widgetStyleLarge: WidgetStyle
  useMockData: boolean
}
