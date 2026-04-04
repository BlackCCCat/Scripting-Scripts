import {
  Button,
  Form,
  HStack,
  Image,
  NavigationStack,
  Section,
  Spacer,
  Text,
  VStack,
  useState,
} from "scripting"

import type { HolidayCalendarSource } from "../types"
import { buildHolidayDayMap } from "../utils/holiday_calendar"

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"]

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
  const map = new Map<number, { kind: "off" | "work" | "unknown"; label: string }>()
  const dayMap = buildHolidayDayMap(source)
  for (const [dateKey, info] of dayMap.entries()) {
    const date = parseDateKey(dateKey)
    if (!date || date.getFullYear() !== year || date.getMonth() + 1 !== month) continue
    map.set(date.getDate(), {
      kind: info.kind,
      label: info.label,
    })
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

function DayCell(props: { day: number | null; kind: "off" | "work" | "unknown" | null; label: string }) {
  const isOff = props.kind === "off"
  const isWork = props.kind === "work"
  return (
    <VStack
      spacing={2}
      frame={{ maxWidth: "infinity", minHeight: 48, alignment: "top" as any }}
      padding={{ top: 4, bottom: 4 }}
      background={isOff
        ? { style: "#FFF2E8", shape: { type: "rect", cornerRadius: 10 } }
        : isWork
          ? { style: "#EFF6FF", shape: { type: "rect", cornerRadius: 10 } }
          : undefined}
    >
      <Text
        font="caption"
        foregroundStyle={isOff ? "#C2410C" : isWork ? "#1D4ED8" : "secondaryLabel"}
        frame={{ maxWidth: "infinity", alignment: "center" as any }}
      >
        {props.day == null ? "" : String(props.day)}
      </Text>
      <Text
        font="caption2"
        foregroundStyle={isOff ? "#EA580C" : isWork ? "#2563EB" : "clear"}
        frame={{ maxWidth: "infinity", alignment: "center" as any }}
      >
        {props.label}
      </Text>
    </VStack>
  )
}

export function HolidayCalendarMonthView(props: {
  source: HolidayCalendarSource
}) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const cells = buildCells(props.source, year, month)
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) => {
    return cells.slice(index * 7, index * 7 + 7)
  })

  function step(offset: number) {
    const next = shiftMonth(year, month, offset)
    setYear(next.year)
    setMonth(next.month)
  }

  function jumpToCurrentMonth() {
    setYear(currentYear)
    setMonth(currentMonth)
  }

  return (
    <VStack
      spacing={12}
      padding={{ top: 6, bottom: 4 }}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
    >
      <HStack
        spacing={12}
        padding={{ top: 6, bottom: 6, leading: 4, trailing: 4 }}
      >
        <Button
          title=""
          systemImage="chevron.left"
          buttonStyle="plain"
          action={() => step(-1)}
        />
        <Spacer />
        <VStack spacing={2}>
          <Text font="headline">{monthTitle(year, month)}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">
            仅显示休息日与调班日
          </Text>
        </VStack>
        <Spacer />
        <Button
          title=""
          systemImage="chevron.right"
          buttonStyle="plain"
          action={() => step(1)}
        />
      </HStack>

      {(year !== currentYear || month !== currentMonth) && (
        <HStack padding={{ leading: 4, trailing: 4 }}>
          <Spacer />
          <Button
            title="回到本月"
            buttonStyle="plain"
            action={jumpToCurrentMonth}
          />
        </HStack>
      )}

      <VStack
        spacing={10}
        padding={{ top: 12, bottom: 12, leading: 12, trailing: 12 }}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        background={{
          style: "secondarySystemBackground",
          shape: { type: "rect", cornerRadius: 18 },
        }}
      >
        <HStack spacing={0}>
          {WEEKDAY_LABELS.map((label) => (
            <Text
              key={`${year}-${month}-${label}`}
              font="caption"
              foregroundStyle="secondaryLabel"
              frame={{ maxWidth: "infinity", alignment: "center" as any }}
            >
              {label}
            </Text>
          ))}
        </HStack>

        <VStack spacing={6}>
          {weeks.map((week, index) => (
            <HStack key={`${year}-${month}-week-${index}`} spacing={0}>
              {week.map((cell, cellIndex) => (
                <DayCell
                  key={`${year}-${month}-${index}-${cellIndex}-${cell.day ?? "empty"}`}
                  day={cell.day}
                  kind={cell.kind}
                  label={cell.label}
                />
              ))}
            </HStack>
          ))}
        </VStack>
      </VStack>

      <HStack
        spacing={16}
        padding={{ top: 2, leading: 4, trailing: 4 }}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      >
        <HStack spacing={6}>
          <Image systemName="circle.fill" foregroundStyle="#EA580C" font="caption2" />
          <Text font="caption" foregroundStyle="secondaryLabel">休息日</Text>
        </HStack>
        <HStack spacing={6}>
          <Image systemName="circle.fill" foregroundStyle="#2563EB" font="caption2" />
          <Text font="caption" foregroundStyle="secondaryLabel">调班日</Text>
        </HStack>
      </HStack>
    </VStack>
  )
}

export function HolidayPreviewView(props: {
  source: HolidayCalendarSource
}) {
  return (
    <NavigationStack>
      <Form
        navigationTitle={props.source.title || "未命名日历"}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
      >
        <Section footer={<Text>这里只显示休息日和调班工作日。橙色是休息日，蓝色是调班工作日；其他普通节日不会显示，也不会影响闹钟触发。</Text>}>
          <HolidayCalendarMonthView source={props.source} />
        </Section>
      </Form>
    </NavigationStack>
  )
}
