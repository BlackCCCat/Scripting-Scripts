import { HStack, Image, Rectangle, Text, VStack, type VirtualNode } from "scripting"

import type { AlarmRepeatRule } from "../types"
import { formatTime } from "../utils/alarm_runtime"
import { ALARM_TYPE_SYMBOLS } from "../utils/alarm_summary"

const REPEAT_TITLES: Record<Exclude<AlarmRepeatRule["kind"], "holiday">, string> = {
  once: "单次",
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
  custom: "自定义",
}

function relativeDateLabel(date: Date, now: number): string {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  const year = date.getFullYear() !== today.getFullYear() ? `${date.getFullYear()}年` : ""
  const label = day.getTime() === today.getTime() ? "今天"
    : day.getTime() === tomorrow.getTime() ? "明天"
    : `${year}${date.getMonth() + 1}月${date.getDate()}日`
  const weekday = "日一二三四五六"[date.getDay()]
  return `${label} · 周${weekday}`
}

export function HeaderAlarmActionLabel(props: {
  title: string
  accented?: boolean
  menuSurface?: "glass" | "standard"
}) {
  return (
    <Text
      font="subheadline"
      fontWeight="semibold"
      foregroundStyle={props.accented ? { light: "#8A360A", dark: "#FFD08D" } : "label"}
      frame={props.menuSurface ? { minWidth: 104, minHeight: 44 } : { minWidth: 72 }}
      glassEffect={props.menuSurface === "glass" ? { glass: UIGlass.regular().interactive(), shape: "capsule" } : undefined}
      background={props.menuSurface === "standard" ? { style: "secondarySystemFill", shape: "capsule" } : undefined}
      contentShape="capsule"
    >
      {props.title}
    </Text>
  )
}

export function NextAlarmHeader(props: {
  alarm: { timestamp: number; rule: AlarmRepeatRule } | null
  now: number
  actions?: VirtualNode
}) {
  const date = props.alarm ? new Date(props.alarm.timestamp) : null
  const rule = props.alarm?.rule
  const repeatTitle = rule?.kind === "holiday"
    ? rule.matchMode === "holiday" ? "休息日" : "工作日"
    : rule ? REPEAT_TITLES[rule.kind] : null

  return (
    <HStack
      spacing={10}
      frame={{ maxWidth: "infinity", minHeight: 182, alignment: "leading" }}
      padding={{ top: 8, bottom: 14, leading: 22, trailing: 20 }}
      listRowInsets={{ top: 0, bottom: 0, leading: 0, trailing: 0 }}
      listRowBackground={<Rectangle fill="clear" />}
      listRowSeparator="hidden"
      background={rule ? {
        alignment: "trailing",
        content: (
          <Image
            systemName={ALARM_TYPE_SYMBOLS[rule.kind]}
            font={178}
            foregroundStyle={{
              light: { colors: ["rgba(246,145,19,0.64)", "rgba(245,153,40,0.02)"], startPoint: "top", endPoint: "bottom" },
              dark: { colors: ["rgba(255,166,40,0.72)", "rgba(255,147,20,0.04)"], startPoint: "top", endPoint: "bottom" },
            }}
            offset={{ x: 42, y: 8 }}
            allowsHitTesting={false}
            accessibilityHidden
          />
        ),
      } : undefined}
      clipped
    >
      <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <HStack spacing={8}>
          <Image systemName="alarm" foregroundStyle="systemOrange" accessibilityHidden />
          <Text font="subheadline" fontWeight="semibold">下一次响铃</Text>
        </HStack>
        {date ? (
          <Text font={80} fontWeight="heavy" monospacedDigit lineLimit={1} minScaleFactor={0.6}>
            {formatTime(date.getHours(), date.getMinutes())}
          </Text>
        ) : (
          <Text font="largeTitle" fontWeight="semibold">暂无已排定的闹钟</Text>
        )}
        {date && repeatTitle ? (
          <HStack spacing={7}>
            <HStack spacing={5}>
              <Image systemName="calendar" accessibilityHidden />
              <Text font={props.actions ? "subheadline" : "body"}>{relativeDateLabel(date, props.now)}</Text>
            </HStack>
            <Text
              font="caption"
              fontWeight="semibold"
              lineLimit={1}
              minScaleFactor={0.8}
              foregroundStyle={{ light: "#91400D", dark: "#FFD18C" }}
              padding={{ leading: 7, trailing: 7, top: 4, bottom: 4 }}
              background={{
                style: { light: "rgba(255,149,0,0.18)", dark: "rgba(255,149,0,0.22)" },
                shape: "capsule",
              }}
            >
              {repeatTitle}
            </Text>
          </HStack>
        ) : (
          <Text font="subheadline" foregroundStyle="secondaryLabel">
            已安排的响铃时间会显示在这里。
          </Text>
        )}
      </VStack>
      {props.actions}
    </HStack>
  )
}
