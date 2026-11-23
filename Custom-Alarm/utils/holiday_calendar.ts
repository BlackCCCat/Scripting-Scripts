import type { AlarmRepeatRule, HolidayCalendarSource } from "../types"

declare const fetch: typeof import("scripting").fetch

type HolidayRule = Extract<AlarmRepeatRule, { kind: "holiday" }>
const officialDayMarker = /[（(]\s*([休班])\s*[）)]/

export type HolidayDayInfo = {
  kind: "off" | "work" | "unknown"
  title: string
  label: string
}

function unfoldIcsLines(text: string): string[] {
  const source = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const rawLines = source.split("\n")
  const lines: string[] = []

  for (const rawLine of rawLines) {
    if (!rawLine) continue
    if ((rawLine.startsWith(" ") || rawLine.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += rawLine.slice(1)
    } else {
      lines.push(rawLine)
    }
  }

  return lines
}

function decodeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
}

function extractPropertyValue(line: string, property: string): string | null {
  const match = line.match(new RegExp(`^${property}(?:;[^:]+)?:([\\s\\S]*)$`, "i"))
  return match ? match[1] ?? null : null
}

function parseDateValue(value: string): Date | null {
  const compact = String(value ?? "").trim()
  const match = compact.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day, 0, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

export function classifyHolidayKind(summary: string): "off" | "work" | "unknown" {
  const text = String(summary).trim()
  if (!text) return "unknown"
  const marker = text.match(officialDayMarker)?.[1]
  if (marker) return marker === "休" ? "off" : "work"
  if (/(补班|上班|调班|工作日|值班|班)/.test(text)) return "work"
  if (/(放假|休假|休息|假期|除夕|元旦|春节|清明节?|劳动节?|五一|端午节?|中秋节?|国庆节?)/.test(text)) {
    return "off"
  }
  return "unknown"
}

function dateKey(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function eachDateKeyInRange(start: Date, endExclusive: Date): string[] {
  const result: string[] = []
  const cursor = new Date(start.getTime())
  cursor.setHours(0, 0, 0, 0)

  while (cursor.getTime() < endExclusive.getTime()) {
    result.push(dateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return result
}

export function parseHolidayCalendarSource(
  source: HolidayCalendarSource,
  rawIcs: string
): HolidayCalendarSource {
  const lines = unfoldIcsLines(rawIcs)
  const holidayDateSet = new Set<string>()
  const holidayItems: HolidayCalendarSource["holidayItems"] = []
  let discoveredTitle: string | null = null
  let inEvent = false
  let eventLines: string[] = []

  for (const line of lines) {
    const nameValue = extractPropertyValue(line, "X-WR-CALNAME")
    if (nameValue && !discoveredTitle) discoveredTitle = decodeIcsText(nameValue).trim()

    if (line === "BEGIN:VEVENT") {
      inEvent = true
      eventLines = []
      continue
    }

    if (line === "END:VEVENT") {
      inEvent = false
      const dtStart = eventLines
        .map((eventLine) => extractPropertyValue(eventLine, "DTSTART"))
        .find(Boolean)
      const dtEnd = eventLines
        .map((eventLine) => extractPropertyValue(eventLine, "DTEND"))
        .find(Boolean)

      const startDate = dtStart ? parseDateValue(dtStart) : null
      const endDate = dtEnd ? parseDateValue(dtEnd) : null
      const summaryValue = eventLines
        .map((eventLine) => extractPropertyValue(eventLine, "SUMMARY"))
        .find(Boolean)
      const summary = decodeIcsText(String(summaryValue ?? "节假日")).trim() || "节假日"
      const kind = classifyHolidayKind(summary)

      if (startDate && endDate && endDate.getTime() > startDate.getTime()) {
        for (const key of eachDateKeyInRange(startDate, endDate)) {
          if (kind === "off") holidayDateSet.add(key)
          holidayItems.push({
            id: `${key}-${summary}`,
            dateKey: key,
            title: summary,
            kind,
          })
        }
      } else if (startDate) {
        const key = dateKey(startDate)
        if (kind === "off") holidayDateSet.add(key)
        holidayItems.push({
          id: `${key}-${summary}`,
          dateKey: key,
          title: summary,
          kind,
        })
      }

      eventLines = []
      continue
    }

    if (inEvent) eventLines.push(line)
  }

  return {
    ...source,
    title: discoveredTitle || source.title,
    holidayDates: Array.from(holidayDateSet).sort((a, b) => a.localeCompare(b)),
    holidayItems,
    lastSyncedAt: Date.now(),
  }
}

export async function syncHolidayCalendarSource(
  source: HolidayCalendarSource,
  timeout?: number
): Promise<HolidayCalendarSource> {
  const response = await fetch(source.url, { timeout })
  if (!response.ok) {
    throw new Error(`节假日日历下载失败：HTTP ${response.status}`)
  }
  const calendar = parseHolidayCalendarSource(source, await response.text())
  if (!calendar.holidayItems.length) throw new Error("节假日日历未返回可用条目")
  return calendar
}

export function nextHolidayOccurrence(
  rule: HolidayRule,
  source: HolidayCalendarSource,
  after: number,
  currentYear: number
): number | null {
  // 远期的节日名称不代表班休安排已经发布。
  const publishedYears = new Set(source.holidayItems
    .filter((item) => officialDayMarker.test(item.title))
    .map((item) => Number(item.dateKey.slice(0, 4))))
  const cursor = new Date(after)
  cursor.setHours(0, 0, 0, 0)
  const days = buildHolidayDayMap(source)
  while (cursor.getFullYear() <= currentYear + 1) {
    if (!publishedYears.has(cursor.getFullYear())) return null
    const kind = days.get(dateKey(cursor))?.kind
    const weekday = cursor.getDay()
    const isWorkday = kind === "work" || kind !== "off" && weekday >= 1 && weekday <= 5
    if (isWorkday === (rule.matchMode === "nonHoliday")) {
      const fireDate = new Date(cursor)
      fireDate.setHours(rule.hour, rule.minute, 0, 0)
      if (fireDate.getTime() > after) return fireDate.getTime()
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return null
}

export async function resolveHolidayOccurrence(
  rule: HolidayRule,
  source: HolidayCalendarSource,
  now: () => number = Date.now,
  sync = syncHolidayCalendarSource
): Promise<{ timestamp: number | null; source: HolidayCalendarSource }> {
  const next = (calendar: HolidayCalendarSource) => {
    const after = now()
    return nextHolidayOccurrence(rule, calendar, after, new Date(after).getFullYear())
  }
  const cached = next(source)
  if (cached !== null) return { timestamp: cached, source }

  const refreshed = await sync(source, 8)
  return { timestamp: next(refreshed), source: refreshed }
}

function holidayKindPriority(kind: "off" | "work" | "unknown"): number {
  switch (kind) {
    case "off":
      return 2
    case "work":
      return 1
    default:
      return 0
  }
}

export function shortHolidayLabel(title: string, kind: "off" | "work" | "unknown"): string {
  if (kind === "work") return "班"
  const cleaned = String(title)
    .replace(/放假/g, "")
    .replace(/休假/g, "")
    .replace(/休息/g, "")
    .replace(/调休/g, "")
    .replace(/补班/g, "")
    .replace(/假期/g, "")
    .replace(/快乐/g, "")
    .trim()
  if (!cleaned) return kind === "off" ? "休" : ""
  return cleaned.length <= 2 ? cleaned : cleaned.slice(0, 2)
}

export function buildHolidayDayMap(source: HolidayCalendarSource): Map<string, HolidayDayInfo> {
  const map = new Map<string, HolidayDayInfo>()

  for (const item of source.holidayItems) {
    const kind = item.kind === "unknown" ? classifyHolidayKind(item.title) : item.kind
    if (kind === "unknown") continue
    const candidate: HolidayDayInfo = {
      kind,
      title: item.title,
      label: shortHolidayLabel(item.title, kind),
    }
    const current = map.get(item.dateKey)
    if (
      !current
      || holidayKindPriority(candidate.kind) > holidayKindPriority(current.kind)
      || (!current.label && Boolean(candidate.label))
      || (!current.title && Boolean(candidate.title))
    ) {
      map.set(item.dateKey, candidate)
    }
  }

  for (const key of source.holidayDates) {
    const current = map.get(key)
    if (!current || current.kind === "unknown") {
      map.set(key, {
        kind: "off",
        title: current?.title ?? "",
        label: current?.label || "休",
      })
    }
  }

  return map
}
