import {
  Button,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  useState,
} from "scripting"

import type { HolidayCalendarSource } from "../types"
import { buildHolidayDayMap, type HolidayDayInfo } from "../utils/holiday_calendar"
import { supportsLiquidGlass } from "./PageAppearance"

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"]
const HOLIDAY_CELL_COLORS = {
  off: { background: { light: "#FFE8BF", dark: "#4A2D14" }, text: { light: "#8A350B", dark: "#FFD392" } },
  work: { background: { light: "#D1EFE8", dark: "#173B36" }, text: { light: "#07594D", dark: "#9BE4D4" } },
} as const

function parseDateKey(key: string): Date | null {
  const match = String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

function monthTitle(year: number, month: number): string {
  return `${year}年${month}月`
}

function shiftMonth(year: number, month: number, offset: number): { year: number; month: number } {
  const date = new Date(year, month - 1 + offset, 1)
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
  }
}

function buildMonthMap(source: HolidayCalendarSource, year: number, month: number) {
  const map = new Map<number, HolidayDayInfo>()
  const dayMap = buildHolidayDayMap(source)
  for (const [dateKey, info] of dayMap.entries()) {
    const date = parseDateKey(dateKey)
    if (!date || date.getFullYear() !== year || date.getMonth() + 1 !== month) continue
    map.set(date.getDate(), info)
  }
  return map
}

function buildCells(source: HolidayCalendarSource, year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const leading = firstDay.getDay()
  const totalDays = lastDay.getDate()
  const monthMap = buildMonthMap(source, year, month)
  const cells: Array<{ day: number | null; kind: "off" | "work" | "unknown" | null; label: string }> = []

  for (let i = 0; i < leading; i += 1) {
    cells.push({ day: null, kind: null, label: "" })
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const tagged = monthMap.get(day)
    cells.push({
      day,
      kind: tagged?.kind ?? null,
      label: tagged?.label ?? "",
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({ day: null, kind: null, label: "" })
  }

  return cells
}

function DayCell(props: { day: number | null; kind: "off" | "work" | "unknown" | null; label: string; today: boolean }) {
  const colors = props.kind === "off" || props.kind === "work" ? HOLIDAY_CELL_COLORS[props.kind] : null
  const background = colors?.background ?? (props.today ? "secondarySystemFill" : undefined)
  return (
    <VStack
      spacing={2}
      frame={{ maxWidth: "infinity", minHeight: 37, alignment: "top" }}
      padding={{ top: 5, bottom: 3 }}
      background={background ? { style: background, shape: { type: "rect", cornerRadius: 10 } } : undefined}
    >
      <Text
        font="subheadline"
        fontWeight={props.today || colors ? "semibold" : "regular"}
        monospacedDigit
        foregroundStyle={colors?.text ?? "label"}
        frame={{ maxWidth: "infinity", alignment: "center" }}
      >
        {props.day == null ? "" : String(props.day)}
      </Text>
      <Text
        font="caption2"
        foregroundStyle={colors?.text ?? "clear"}
        lineLimit={1}
        minScaleFactor={0.7}
        frame={{ maxWidth: "infinity", alignment: "center" }}
      >
        {props.label}
      </Text>
    </VStack>
  )
}

export function HolidayCalendarMonthView(props: {
  source: HolidayCalendarSource
}) {
  const monthButtonStyle = supportsLiquidGlass ? "glass" : "bordered"
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const [{ year, month }, setVisibleMonth] = useState({ year: currentYear, month: currentMonth })
  const cells = buildCells(props.source, year, month)
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) => {
    return cells.slice(index * 7, index * 7 + 7)
  })
  const showingCurrentMonth = year === currentYear && month === currentMonth

  function step(offset: number) {
    setVisibleMonth((current) => shiftMonth(current.year, current.month, offset))
  }

  function jumpToCurrentMonth() {
    setVisibleMonth({ year: currentYear, month: currentMonth })
  }

  return (
    <VStack
      spacing={11}
      padding={{ top: 4, bottom: 5 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack spacing={8}>
        <Button
          buttonStyle={monthButtonStyle}
          buttonBorderShape="circle"
          accessibilityLabel="上个月"
          action={() => step(-1)}
        >
          <Image systemName="chevron.left" font="subheadline" fontWeight="semibold" frame={{ width: 24, height: 24 }} />
        </Button>
        <Spacer />
        <Text font="headline" monospacedDigit>{monthTitle(year, month)}</Text>
        <Spacer />
        <Button
          buttonStyle={monthButtonStyle}
          buttonBorderShape="circle"
          accessibilityLabel="下个月"
          action={() => step(1)}
        >
          <Image systemName="chevron.right" font="subheadline" fontWeight="semibold" frame={{ width: 24, height: 24 }} />
        </Button>
      </HStack>

      <VStack
        spacing={8}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <HStack spacing={0}>
          {WEEKDAY_LABELS.map((label) => (
            <Text
              key={`${year}-${month}-${label}`}
              font="caption"
              foregroundStyle="secondaryLabel"
              frame={{ maxWidth: "infinity", alignment: "center" }}
            >
              {label}
            </Text>
          ))}
        </HStack>

        <VStack spacing={3}>
          {weeks.map((week, index) => (
            <HStack key={`${year}-${month}-week-${index}`} spacing={3}>
              {week.map((cell, cellIndex) => (
                <DayCell
                  key={`${year}-${month}-${index}-${cellIndex}-${cell.day ?? "empty"}`}
                  day={cell.day}
                  kind={cell.kind}
                  label={cell.label}
                  today={showingCurrentMonth && cell.day === now.getDate()}
                />
              ))}
            </HStack>
          ))}
        </VStack>
      </VStack>

      <HStack
        spacing={10}
        padding={{ top: 2, leading: 4, trailing: 4 }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <HStack spacing={6}>
          <Image systemName="circle.fill" foregroundStyle="systemOrange" font="caption2" accessibilityHidden />
          <Text font="caption" foregroundStyle="secondaryLabel">休息日</Text>
        </HStack>
        <HStack spacing={6}>
          <Image systemName="circle.fill" foregroundStyle="systemTeal" font="caption2" accessibilityHidden />
          <Text font="caption" foregroundStyle="secondaryLabel">调班日</Text>
        </HStack>
        <Spacer />
        <Button
          title="回到本月"
          buttonStyle={monthButtonStyle}
          buttonBorderShape="capsule"
          tint="systemOrange"
          opacity={showingCurrentMonth ? 0 : 1}
          disabled={showingCurrentMonth}
          accessibilityHidden={showingCurrentMonth}
          action={jumpToCurrentMonth}
        />
      </HStack>
    </VStack>
  )
}
