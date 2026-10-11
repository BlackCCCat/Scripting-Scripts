import type { AlarmRecord } from "../types"

export function canSkipAlarm(record: AlarmRecord): boolean {
  const rule = record.repeatRule
  if (rule.kind === "once") return false
  if (rule.kind === "daily" || rule.kind === "weekly") {
    return typeof rule.occurrenceLimit === "number"
      && Number.isFinite(rule.occurrenceLimit)
      && rule.occurrenceLimit > 0
  }
  return true
}

export function pendingSkippedOccurrences(record: AlarmRecord, now: number): number[] {
  return (record.skippedOccurrences ?? []).filter((timestamp) => timestamp > now)
}

export function nextSearchStart(record: AlarmRecord, now: number): number {
  return pendingSkippedOccurrences(record, now).at(-1) ?? now
}

export function skipOccurrence(record: AlarmRecord, timestamp: number, now: number): AlarmRecord {
  // 跳过占用一次重复额度，撤销时再归还。
  return {
    ...record,
    completedOccurrences: (record.completedOccurrences ?? 0) + 1,
    skippedOccurrences: [...pendingSkippedOccurrences(record, now), timestamp],
    updatedAt: now,
  }
}

export function undoSkippedOccurrence(record: AlarmRecord, now: number): AlarmRecord | null {
  const pending = pendingSkippedOccurrences(record, now)
  if (!pending.length) return null
  return {
    ...record,
    completedOccurrences: Math.max(0, (record.completedOccurrences ?? 0) - 1),
    skippedOccurrences: pending.slice(0, -1),
    updatedAt: now,
  }
}
