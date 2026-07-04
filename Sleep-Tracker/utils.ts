export function pad2(value: number): string {
  return `${value}`.padStart(2, "0")
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset)
}

export function dateKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value))
  return new Date(year, month - 1, day)
}

export function formatHours(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "-"
  return `${Math.round((minutes / 60) * 10) / 10}h`
}

export function formatHoursMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "-"
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const remainder = total % 60
  if (hours <= 0) return `${remainder}m`
  if (remainder <= 0) return `${hours}h`
  return `${hours}h ${remainder}m`
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "-"
  return `${Math.round(minutes)} min`
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-"
  const normalized = value <= 1.5 ? value * 100 : value
  return `${Math.round(normalized)}%`
}

export function sleepEfficiencyRatio(
  totalSleepMinutes: number | null | undefined,
  totalInBedMinutes: number | null | undefined
): number {
  const sleep = Math.max(0, totalSleepMinutes ?? 0)
  const inBed = effectiveInBedMinutes(totalSleepMinutes, totalInBedMinutes, 0)
  const denominator = Math.max(1, sleep, inBed)
  return clamp(sleep / denominator, 0, 1)
}

export function sleepEfficiencyPercent(
  totalSleepMinutes: number | null | undefined,
  totalInBedMinutes: number | null | undefined
): number {
  return sleepEfficiencyRatio(totalSleepMinutes, totalInBedMinutes) * 100
}

export function normalizePercentValue(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return value <= 1.5 ? value * 100 : value
}

export function effectiveInBedMinutes(
  totalSleepMinutes: number | null | undefined,
  totalInBedMinutes: number | null | undefined,
  awakeMinutes: number | null | undefined
): number {
  const sleep = Math.max(0, totalSleepMinutes ?? 0)
  const inBed = Math.max(0, totalInBedMinutes ?? 0)
  const awake = Math.max(0, awakeMinutes ?? 0)
  return Math.max(inBed, sleep + awake)
}

export function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function formatClockFromISO(iso: string | null | undefined): string {
  if (!iso) return "-"
  return formatClock(new Date(iso))
}

export function formatShortDateFromKey(dateKey: string): string {
  const date = parseDateKey(dateKey)
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`
}

export function formatMonthDayFromKey(dateKey: string): string {
  const date = parseDateKey(dateKey)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function weekdayLabelFromKey(dateKey: string): string {
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"]
  return `周${weekdays[parseDateKey(dateKey).getDay()]}`
}

export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso)
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function isOlderThan(iso: string, thresholdMs: number): boolean {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return true
  return Date.now() - time > thresholdMs
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
