export type HolidayMatchMode = "holiday" | "nonHoliday"

export type AlarmRepeatRule =
  | {
      kind: "once"
      timestamp: number
    }
  | {
      kind: "daily"
      hour: number
      minute: number
      occurrenceLimit?: number | null
    }
  | {
      kind: "weekly"
      hour: number
      minute: number
      weekdays: number[]
      occurrenceLimit?: number | null
    }
  | {
      kind: "monthly"
      hour: number
      minute: number
      dayOfMonth: number
      occurrenceLimit?: number | null
    }
  | {
      kind: "holiday"
      hour: number
      minute: number
      sourceId: string
      matchMode: HolidayMatchMode
    }
  | {
      kind: "custom"
      hour: number
      minute: number
      startDateTimestamp: number
      skipDays: number
      ringDays: number
      occurrenceLimit?: number | null
    }

export type AlarmRecord = {
  id: string
  title: string
  enabled: boolean
  snoozeMinutes: number
  repeatRule: AlarmRepeatRule
  systemAlarmIds: string[]
  lastScheduledAt: number | null
  createdAt: number
  updatedAt: number
}

export type HolidayCalendarSource = {
  id: string
  title: string
  url: string
  holidayDates: string[]
  holidayItems: Array<{
    id: string
    dateKey: string
    title: string
    kind: "off" | "work" | "unknown"
  }>
  lastSyncedAt: number | null
}

export type AlarmDraft = {
  title: string
  snoozeMinutes: number
  repeatRule: AlarmRepeatRule
}

export type CustomAlarmState = {
  alarms: AlarmRecord[]
  holidaySources: HolidayCalendarSource[]
}
