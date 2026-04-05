import type {
  AlarmRecord,
  AlarmRepeatRule,
  CustomAlarmState,
  HolidayCalendarSource,
  HolidayMatchMode,
} from "../types"

export const DEFAULT_HOLIDAY_SOURCE_ID = "cn-holiday-calendar"
export const DEFAULT_HOLIDAY_URL = "https://calendars.icloud.com/holidays/cn_zh.ics"

const STORAGE_KEY = "custom_alarm_state_v2"
export const DEFAULT_SNOOZE_MINUTES = 5

function getStorage(): any {
  return (globalThis as any).Storage
}

function readStorage(key: string): string | null {
  const storage = getStorage()
  if (!storage) return null
  if (typeof storage.get === "function") return storage.get(key)
  if (typeof storage.getString === "function") return storage.getString(key)
  return null
}

function writeStorage(key: string, value: string): void {
  const storage = getStorage()
  if (!storage) return
  if (typeof storage.set === "function") storage.set(key, value)
  else if (typeof storage.setString === "function") storage.setString(key, value)
}

function defaultHolidaySource(): HolidayCalendarSource {
  return {
    id: DEFAULT_HOLIDAY_SOURCE_ID,
    title: "中国节假日",
    url: DEFAULT_HOLIDAY_URL,
    holidayDates: [],
    holidayItems: [],
    lastSyncedAt: null,
  }
}

function clampHour(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return 8
  return Math.min(23, Math.max(0, Math.floor(num)))
}

function clampMinute(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.min(59, Math.max(0, Math.floor(num)))
}

function clampPositiveInteger(value: unknown, fallback: number, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(1, Math.floor(num)))
}

function normalizeOccurrenceLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.min(99, Math.max(1, Math.floor(num)))
}

function clampSnoozeMinutes(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return DEFAULT_SNOOZE_MINUTES
  return Math.min(60, Math.max(1, Math.floor(num)))
}

function normalizeSoundName(value: unknown): string | null {
  const soundName = String(value ?? "").trim()
  return soundName ? soundName : null
}

function normalizeWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const deduped = Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7)
    )
  )
  return deduped.sort((a, b) => a - b)
}

function normalizeRepeatRule(value: any): AlarmRepeatRule | null {
  if (!value || typeof value !== "object") return null

  // 读取旧数据时统一收口规则格式，这样升级字段后也能尽量兼容之前保存的内容。
  switch (value.kind) {
    case "once": {
      const timestamp = Number(value.timestamp)
      if (!Number.isFinite(timestamp) || timestamp <= 0) return null
      return {
        kind: "once",
        timestamp,
      }
    }
    case "daily":
      return {
        kind: "daily",
        hour: clampHour(value.hour),
        minute: clampMinute(value.minute),
        occurrenceLimit: normalizeOccurrenceLimit(value.occurrenceLimit),
      }
    case "weekly": {
      const weekdays = normalizeWeekdays(value.weekdays)
      if (!weekdays.length) return null
      return {
        kind: "weekly",
        hour: clampHour(value.hour),
        minute: clampMinute(value.minute),
        weekdays,
        occurrenceLimit: normalizeOccurrenceLimit(value.occurrenceLimit),
      }
    }
    case "monthly":
      return {
        kind: "monthly",
        hour: clampHour(value.hour),
        minute: clampMinute(value.minute),
        dayOfMonth: Math.min(31, Math.max(1, Math.floor(Number(value.dayOfMonth) || 1))),
        occurrenceLimit: normalizeOccurrenceLimit(value.occurrenceLimit),
      }
    case "holiday":
      return {
        kind: "holiday",
        hour: clampHour(value.hour),
        minute: clampMinute(value.minute),
        sourceId: DEFAULT_HOLIDAY_SOURCE_ID,
        matchMode: normalizeHolidayMatchMode(value.matchMode),
      }
    case "custom": {
      const startDateTimestamp = Number(value.startDateTimestamp)
      if (!Number.isFinite(startDateTimestamp) || startDateTimestamp <= 0) return null
      return {
        kind: "custom",
        hour: clampHour(value.hour),
        minute: clampMinute(value.minute),
        startDateTimestamp,
        skipDays: clampPositiveInteger(value.skipDays, 1, 50),
        ringDays: clampPositiveInteger(value.ringDays, 1, 50),
        occurrenceLimit: normalizeOccurrenceLimit(value.occurrenceLimit),
      }
    }
    default:
      return null
  }
}

function normalizeHolidayMatchMode(value: unknown): HolidayMatchMode {
  return value === "nonHoliday" ? "nonHoliday" : "holiday"
}

function normalizeHolidayItemKind(value: unknown): "off" | "work" | "unknown" {
  switch (value) {
    case "off":
    case "work":
      return value
    default:
      return "unknown"
  }
}

function inferHolidayItemKind(title: string): "off" | "work" | "unknown" {
  if (/(补班|上班|调班|工作日|值班|班)/.test(title)) return "work"
  if (/(放假|休假|休息|假期|除夕|元旦|春节|清明节?|劳动节?|五一|端午节?|中秋节?|国庆节?)/.test(title)) {
    return "off"
  }
  return "unknown"
}

function normalizeRecord(value: any): AlarmRecord | null {
  if (!value || typeof value !== "object") return null
  const id = String(value.id ?? "").trim()
  const title = String(value.title ?? "").trim()
  const repeatRule = normalizeRepeatRule(value.repeatRule)
  if (!id || !title || !repeatRule) return null

  return {
    id,
    title,
    enabled: Boolean(value.enabled ?? true),
    snoozeMinutes: clampSnoozeMinutes(value.snoozeMinutes),
    soundName: normalizeSoundName(value.soundName),
    repeatRule,
    systemAlarmIds: Array.isArray(value.systemAlarmIds)
      ? (value.systemAlarmIds as unknown[]).map((item: unknown) => String(item)).filter(Boolean)
      : [],
    lastScheduledAt: Number.isFinite(Number(value.lastScheduledAt))
      ? Number(value.lastScheduledAt)
      : null,
    createdAt: Number(value.createdAt) || Date.now(),
    updatedAt: Number(value.updatedAt) || Number(value.createdAt) || Date.now(),
  }
}

function normalizeHolidaySource(value: any): HolidayCalendarSource | null {
  if (!value || typeof value !== "object") return null
  const id = String(value.id ?? "").trim()
  const url = String(value.url ?? "").trim()
  if (!id || !url) return null

  const holidayItems = Array.isArray(value.holidayItems)
    ? (value.holidayItems as unknown[])
        .map((item: unknown): HolidayCalendarSource["holidayItems"][number] | null => {
          if (!item || typeof item !== "object") return null
          const dateKey = String((item as any).dateKey ?? "").trim()
          const title = String((item as any).title ?? "").trim()
          if (!dateKey) return null
          const kind: "off" | "work" | "unknown" = (() => {
            const explicit = normalizeHolidayItemKind((item as any).kind)
            const inferred = inferHolidayItemKind(title)
            if (inferred !== "unknown") return inferred
            return explicit === "work" ? "work" : "unknown"
          })()
          return {
            id: String((item as any).id ?? `${dateKey}-${title}`),
            dateKey,
            title: title || "节假日",
            kind,
          }
        })
        .filter((item: HolidayCalendarSource["holidayItems"][number] | null): item is HolidayCalendarSource["holidayItems"][number] => Boolean(item))
    : []
  const holidayDates = holidayItems.length
    ? Array.from(
        new Set(
          holidayItems
            .filter((item: HolidayCalendarSource["holidayItems"][number]) => item.kind === "off")
            .map((item: HolidayCalendarSource["holidayItems"][number]) => item.dateKey)
        )
      ).sort((a: string, b: string) => a.localeCompare(b))
    : Array.isArray(value.holidayDates)
      ? (value.holidayDates as unknown[]).map((item: unknown) => String(item)).filter(Boolean)
      : []

  return {
    id,
    title: id === DEFAULT_HOLIDAY_SOURCE_ID ? "中国节假日" : String(value.title ?? "").trim(),
    url: id === DEFAULT_HOLIDAY_SOURCE_ID ? DEFAULT_HOLIDAY_URL : url,
    holidayDates,
    holidayItems,
    lastSyncedAt: Number.isFinite(Number(value.lastSyncedAt))
      ? Number(value.lastSyncedAt)
      : null,
  }
}

export function loadCustomAlarmState(): CustomAlarmState {
  const raw = readStorage(STORAGE_KEY)
  if (!raw) {
    return {
      alarms: [],
      holidaySources: [defaultHolidaySource()],
    }
  }

  try {
    const data = JSON.parse(raw)
    const alarms = Array.isArray(data?.alarms)
      ? data.alarms
          .map((item: unknown) => normalizeRecord(item))
          .filter((item: AlarmRecord | null): item is AlarmRecord => Boolean(item))
      : []

    const normalizedSources = Array.isArray(data?.holidaySources)
      ? data.holidaySources
          .map((item: unknown) => normalizeHolidaySource(item))
          .filter((item: HolidayCalendarSource | null): item is HolidayCalendarSource => Boolean(item))
      : []

    const builtinSource = normalizedSources.find((item: HolidayCalendarSource) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? defaultHolidaySource()
    const holidaySources = [builtinSource]

    return {
      alarms,
      holidaySources,
    }
  } catch {
    return {
      alarms: [],
      holidaySources: [defaultHolidaySource()],
    }
  }
}

export function saveCustomAlarmState(state: CustomAlarmState): void {
  const builtinSource = state.holidaySources.find((item: HolidayCalendarSource) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? defaultHolidaySource()
  writeStorage(
    STORAGE_KEY,
    JSON.stringify({
      alarms: state.alarms,
      holidaySources: [builtinSource],
    }, null, 2)
  )
}
