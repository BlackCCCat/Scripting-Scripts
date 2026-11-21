import { AreaChart, BarChart, Chart, DisclosureGroup, DonutChart, HStack, LineChart, Picker, Spacer, Text, VStack, useState, type Color, type DynamicShapeStyle } from "scripting"
import type { RequestRecord } from "../local/store"
import { accent, barFill, Hint, Panel, StatusDot } from "./Shared"

export type Usage = { key: string; label: string; value: number }
const barColors = ["systemTeal", "systemBlue", "systemOrange", "systemGreen", "systemPink", "systemIndigo", "systemRed", "systemMint", "systemCyan", "systemBrown", "systemYellow"] as const

function barColor(index: number): Color | DynamicShapeStyle {
  if (index === 0) return barFill
  if (index <= barColors.length) return barColors[index - 1]
  const hue = Math.round(index * 137.508) % 360
  return { light: `hsl(${hue},65%,42%)`, dark: `hsl(${hue},65%,65%)` }
}

function UsageLabel({ item, color }: { item: Usage; color: Color | DynamicShapeStyle }) {
  return <HStack spacing={7}>
    <StatusDot color={color} />
    <Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" }}>{item.label}</Text>
    <Text font="caption" foregroundStyle="secondaryLabel" monospacedDigit>{`${item.value} 次`}</Text>
  </HStack>
}

export function UsageChart({ items }: { items: Usage[] }) {
  if (!items.length) return <Hint>暂无请求记录</Hint>
  const colors = new Map(items.map(item => item.key).sort((a, b) => a.localeCompare(b)).map((key, index) => [key, barColor(index)]))
  const colorFor = (item: Usage) => colors.get(item.key) ?? "systemGray"
  const visible = items.slice(0, 8)
  const maximum = visible[0].value
  return <VStack alignment="leading" spacing={11}>
    {visible.map((item, index) => {
      const last = index === visible.length - 1
      return <VStack key={item.key} alignment="leading" spacing={5}>
        <UsageLabel item={item} color={colorFor(item)} />
        <Chart frame={{ height: last ? 38 : 14, maxWidth: "infinity" }} chartYAxis="hidden" chartLegend="hidden"
          chartXAxis={last ? { values: { type: "automatic", desiredCount: 4, roundLowerBound: true }, valueLabel: { format: "number" } } : "hidden"}
          chartXScale={{ domain: { from: 0, to: maximum }, type: "linear" }}>
          <BarChart labelOnYAxis marks={[{ label: item.key, value: item.value, foregroundStyle: colorFor(item),
            cornerRadius: 3, height: { type: "fixed", value: 8 }, accessibilityLabel: item.label, accessibilityValue: `${item.value} 次` }]} />
        </Chart>
      </VStack>
    })}
    {items.length > visible.length && <DisclosureGroup title={`其他 ${items.length - visible.length} 个分组`}>
      {items.slice(visible.length).map(item => <UsageLabel key={item.key} item={item} color={colorFor(item)} />)}
    </DisclosureGroup>}
  </VStack>
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
type TrendMetric = "requests" | "tokens"

function trendBuckets(entries: RequestRecord[], from: number, now: number, hourly: boolean) {
  const date = new Date(Math.min(from, now))
  if (hourly) date.setMinutes(0, 0, 0)
  else date.setHours(0, 0, 0, 0)
  const dayStep = Math.max(1, Math.ceil((now - date.getTime()) / (31 * DAY)))
  const buckets: Array<{ label: Date; requests: number; tokens: number }> = []
  while (date.getTime() <= now) {
    buckets.push({ label: new Date(date), requests: 0, tokens: 0 })
    if (hourly) date.setTime(date.getTime() + HOUR)
    else date.setDate(date.getDate() + dayStep)
  }
  for (const entry of entries) {
    const bucket = buckets.findLast(item => item.label.getTime() <= entry.at)
    if (!bucket) continue
    bucket.requests++
    if (entry.ok) bucket.tokens += entry.tokens
  }
  return { buckets, dayStep }
}

export function UsageTrend({ entries, from, now, hourly }: { entries: RequestRecord[]; from: number; now: number; hourly: boolean }) {
  const [metric, setMetric] = useState<TrendMetric>("requests")
  const { buckets, dayStep } = trendBuckets(entries, from, now, hourly)
  const marks = buckets.map(bucket => ({ label: bucket.label, value: bucket[metric] }))
  const unit = hourly ? "每小时" : dayStep === 1 ? "每日" : `每 ${dayStep} 天汇总`
  return <Panel>
    <Text font="headline">用量趋势</Text>
    <Picker title="趋势指标" pickerStyle="segmented" value={metric} onChanged={(value: string) => {
      if (value === "requests" || value === "tokens") setMetric(value)
    }}>
      <Text tag="requests">请求数</Text><Text tag="tokens">Token</Text>
    </Picker>
    <Hint>{`${unit} · ${metric === "tokens" ? "成功请求的 Token" : "本机请求记录"}`}</Hint>
    <Chart frame={{ height: 155, maxWidth: "infinity" }} chartLegend="hidden"
      chartXAxis={{ values: { type: "automatic", desiredCount: 4 }, valueLabel: { format: hourly ? "time" : "date", collisionResolution: "greedy" } }}
      chartYAxis={{ values: { type: "automatic", desiredCount: 3 }, valueLabel: { format: "number" } }}>
      {marks.length > 1 ? <AreaChart marks={marks.map(mark => ({ ...mark, foregroundStyle: barFill, opacity: 0.24 }))} /> : null}
      {marks.length > 1 ? <LineChart marks={marks.map(mark => ({ ...mark, foregroundStyle: accent }))} />
        : <BarChart marks={marks.map(mark => ({ ...mark, unit: hourly ? "hour" : "day", foregroundStyle: barFill, width: { type: "fixed", value: 16 } }))} />}
    </Chart>
  </Panel>
}

export function RequestOutcomeChart({ successes, failures }: { successes: number; failures: number }) {
  const total = successes + failures
  if (!total) return null
  const outcomes = [
    { category: "成功", value: successes, foregroundStyle: "systemGreen" },
    { category: "失败", value: failures, foregroundStyle: "systemRed" },
  ] as const
  const marks = outcomes.filter(item => item.value > 0)
  return <Panel>
    <Text font="headline">请求结果</Text>
    <HStack spacing={14}>
      <Chart frame={{ width: 96, height: 96 }} chartLegend="hidden">
        <DonutChart marks={marks.map(item => ({ ...item, innerRadius: { type: "ratio", value: 0.7 }, angularInset: marks.length > 1 ? 1 : 0 }))} />
      </Chart>
      <VStack alignment="leading" spacing={9} frame={{ maxWidth: "infinity" }}>
        {outcomes.map(item => <HStack key={item.category} spacing={6}>
          <StatusDot color={item.foregroundStyle} />
          <Text font="subheadline">{item.category}</Text><Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel" monospacedDigit>
            {`${item.value} 次 · ${(item.value / total * 100).toFixed(1)}%`}
          </Text>
        </HStack>)}
      </VStack>
    </HStack>
  </Panel>
}
