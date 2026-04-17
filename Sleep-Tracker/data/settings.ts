import type { SleepTrackerSettings, WidgetStyle } from "../types"

const SETTINGS_KEY = "sleep_tracker.settings.v2"

const VALID_WIDGET_STYLES: WidgetStyle[] = ["score", "duration", "stages", "schedule", "efficiency", "overview", "regularity"]

const DEFAULT_SETTINGS: SleepTrackerSettings = {
  sleepGoalMinutes: 8 * 60,
  widgetStyleSmall: "score",
  widgetStyleMedium: "duration",
  widgetStyleLarge: "duration",
  useMockData: false,
}

function normalizeSettings(raw: any): SleepTrackerSettings {
  const sleepGoalMinutes = Number(raw?.sleepGoalMinutes)
  // backward compat: migrate old single `widgetStyle` into all three sizes
  const validSmallStyles = ["score", "schedule"] as const
  const validTrendStyles = ["duration", "stages", "regularity"] as const

  const legacyStyle: WidgetStyle = VALID_WIDGET_STYLES.includes(raw?.widgetStyle) ? raw.widgetStyle : "score"
  const widgetStyleSmall: WidgetStyle = validSmallStyles.includes(raw?.widgetStyleSmall) ? raw.widgetStyleSmall : (validSmallStyles.includes(legacyStyle as any) ? legacyStyle : "score")
  const widgetStyleMedium: WidgetStyle = validTrendStyles.includes(raw?.widgetStyleMedium) ? raw.widgetStyleMedium : (validTrendStyles.includes(legacyStyle as any) ? legacyStyle : "duration")
  const widgetStyleLarge: WidgetStyle = validTrendStyles.includes(raw?.widgetStyleLarge) ? raw.widgetStyleLarge : (validTrendStyles.includes(legacyStyle as any) ? legacyStyle : "duration")
  const useMockData = typeof raw?.useMockData === "boolean" ? raw.useMockData : DEFAULT_SETTINGS.useMockData
  if (!Number.isFinite(sleepGoalMinutes)) return { ...DEFAULT_SETTINGS, widgetStyleSmall, widgetStyleMedium, widgetStyleLarge, useMockData }
  return {
    sleepGoalMinutes: Math.min(10 * 60, Math.max(6 * 60, Math.round(sleepGoalMinutes))),
    widgetStyleSmall,
    widgetStyleMedium,
    widgetStyleLarge,
    useMockData,
  }
}

export function loadSleepTrackerSettings(): SleepTrackerSettings {
  const raw = Storage.get<any>(SETTINGS_KEY)
  if (raw == null) return DEFAULT_SETTINGS
  if (typeof raw === "string") {
    try {
      return normalizeSettings(JSON.parse(raw))
    } catch {
      return DEFAULT_SETTINGS
    }
  }
  return normalizeSettings(raw)
}

export function saveSleepTrackerSettings(settings: SleepTrackerSettings): SleepTrackerSettings {
  const normalized = normalizeSettings(settings)
  Storage.set(SETTINGS_KEY, normalized)
  return normalized
}

export const SLEEP_GOAL_OPTIONS = [
  6 * 60,
  6.5 * 60,
  7 * 60,
  7.5 * 60,
  8 * 60,
  8.5 * 60,
  9 * 60,
  9.5 * 60,
  10 * 60,
].map((value) => Math.round(value))

export const WIDGET_STYLE_OPTIONS_SMALL: Array<{ key: WidgetStyle; label: string; hint: string }> = [
  { key: "score", label: "睡眠评分", hint: "评分、时长、效率与深睡" },
  { key: "schedule", label: "作息时间", hint: "入睡起床时间与规律性" },
]

export const WIDGET_STYLE_OPTIONS_MEDIUM: Array<{ key: WidgetStyle; label: string; hint: string }> = [
  { key: "duration", label: "睡眠时长", hint: "近期时长趋势图表" },
  { key: "stages", label: "睡眠阶段", hint: "近期阶段分布图表" },
  { key: "regularity", label: "睡眠规律", hint: "近期入睡规律图表" },
]

export const WIDGET_STYLE_OPTIONS_LARGE: Array<{ key: WidgetStyle; label: string; hint: string }> = [
  { key: "duration", label: "睡眠时长", hint: "近期时长趋势图表" },
  { key: "stages", label: "睡眠阶段", hint: "近期阶段分布图表" },
  { key: "regularity", label: "睡眠规律", hint: "近期入睡规律图表" },
]
