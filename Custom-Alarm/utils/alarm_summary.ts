import type { AlarmRecord, AlarmRepeatRule } from "../types"

export const ALARM_TYPE_SYMBOLS: Record<AlarmRepeatRule["kind"], string> = {
  once: "clock",
  daily: "arrow.clockwise",
  weekly: "calendar",
  monthly: "calendar.circle",
  holiday: "calendar.badge.clock",
  custom: "repeat",
}

type AlarmSummary = {
  record: AlarmRecord
  timestamp: number
}

export function nextAlarmForDisplay(
  records: AlarmRecord[],
  registered: ReadonlyMap<string, AlarmManager.Alarm>,
  resolveRule: (record: AlarmRecord) => number | null,
  now: number
): AlarmSummary | null {
  let next: AlarmSummary | null = null

  for (const record of records) {
    if (!record.enabled) continue

    for (const id of record.systemAlarmIds) {
      const alarm = registered.get(id)
      if (alarm && alarm.state !== "scheduled") continue
      const schedule = alarm?.schedule
      // 系统实例仍有效时，首页显示实际登记的日期。
      let timestamp: number | null = null
      if (schedule?.type === "fixed") {
        if (schedule.date) timestamp = new Date(schedule.date).getTime()
      } else if (schedule?.type === "relative" || !alarm) {
        timestamp = resolveRule(record)
      }

      if (timestamp !== null && timestamp > now && (!next || timestamp < next.timestamp)) {
        next = { record, timestamp }
      }
    }
  }

  return next
}
