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
type TrendMetric = "requests" | "tokens" | "credits"
const compactTokens = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

function tokenAxis(peak: number) {
  if (peak >= 1e9) return { divisor: 1e9, label: "B Token" }
  if (peak >= 1e6) return { divisor: 1e6, label: "M Token" }
  if (peak >= 1e3) return { divisor: 1e3, label: "K Token" }
  return { divisor: 1, label: "Token" }
}

function trendBuckets(entries: RequestRecord[], from: number, now: number, hourly: boolean) {
  const date = new Date(Math.min(from, now))
  if (hourly) date.setMinutes(0, 0, 0)
  else date.setHours(0, 0, 0, 0)
  const dayStep = Math.max(1, Math.ceil((now - date.getTime()) / (31 * DAY)))
  const buckets: Array<{ label: Date; requests: number; tokens: number; credits: number | null }> = []
  while (date.getTime() <= now) {
    buckets.push({ label: new Date(date), requests: 0, tokens: 0, credits: null })
    if (hourly) date.setTime(date.getTime() + HOUR)
    else date.setDate(date.getDate() + dayStep)
  }
  for (const entry of entries) {
    const bucket = buckets.findLast(item => item.label.getTime() <= entry.at)
    if (!bucket) continue
    bucket.requests++
    if (entry.ok) bucket.tokens += entry.tokens
    if (entry.creditsSpent != null && Number.isFinite(entry.creditsSpent)) {
      bucket.credits = (bucket.credits ?? 0) + entry.creditsSpent
    }
  }
  return { buckets, dayStep, end: date }
}

export function UsageTrend({ entries, from, now, hourly }: { entries: RequestRecord[]; from: number; now: number; hourly: boolean }) {
  const [metric, setMetric] = useState<TrendMetric>("requests")
  const { buckets, dayStep, end } = trendBuckets(entries, from, now, hourly)
  const axis = metric === "tokens" ? tokenAxis(Math.max(0, ...buckets.map(bucket => bucket.tokens))) : null
  const marks = buckets.flatMap(bucket => {
    const value = bucket[metric]
    return value === null ? [] : [{
      label: bucket.label,
      value: value / (axis?.divisor ?? 1),
      ...(metric === "tokens" ? { accessibilityValue: `${value.toLocaleString("zh-CN")} Token` } : {}),
    }]
  })
  const useBars = metric === "credits" || marks.length === 1
  const unit = hourly ? "每小时" : dayStep === 1 ? "每日" : `每 ${dayStep} 天汇总`
  const source = metric === "credits" ? "仅统计上游返回的积分" : metric === "tokens" ? "成功请求的 Token" : "本机请求记录"
  return <Panel>
    <HStack spacing={8}>
      <Text font="headline">用量趋势</Text><Spacer />
      {axis && <Hint>{`纵轴 · ${axis.label}`}</Hint>}
    </HStack>
    <Picker title="趋势指标" pickerStyle="segmented" value={metric} onChanged={(value: string) => {
      if (value === "requests" || value === "tokens" || value === "credits") setMetric(value)
    }}>
      <Text tag="requests">请求数</Text><Text tag="tokens">Token</Text><Text tag="credits">积分消耗</Text>
    </Picker>
    <Hint>{`${unit} · ${source}`}</Hint>
    {!marks.length ? <Hint>当前区间暂无积分消耗记录</Hint> : <Chart frame={{ height: 155, maxWidth: "infinity" }} chartLegend="hidden"
      chartXAxis={{ values: { type: "automatic", desiredCount: 4 }, valueLabel: { format: hourly ? "time" : "date", collisionResolution: "greedy" } }}
      chartXScale={metric === "credits" ? { from: buckets[0].label, to: end } : undefined}
      chartYAxis={{ values: { type: "automatic", desiredCount: 3 }, valueLabel: { format: "number" } }}>
      {!useBars ? <AreaChart marks={marks.map(mark => ({ ...mark, foregroundStyle: barFill, opacity: 0.24 }))} /> : null}
      {!useBars ? <LineChart marks={marks.map(mark => ({ ...mark, foregroundStyle: accent }))} />
        : <BarChart marks={marks.map(mark => ({ ...mark, unit: hourly ? "hour" : "day", foregroundStyle: barFill, width: { type: "fixed", value: 16 } }))} />}
    </Chart>}
  </Panel>
}

type Outcome = { category: string; value: number; foregroundStyle: Color | DynamicShapeStyle }

function OutcomeDonut({ title, outcomes, tokenCounts = false }: { title: string; outcomes: Outcome[]; tokenCounts?: boolean }) {
  const total = outcomes.reduce((sum, item) => sum + item.value, 0)
  if (!total) return tokenCounts ? <Panel>
    <Text font="headline">{title}</Text>
    <Hint>当前区间暂无可计算的缓存 Token</Hint>
  </Panel> : null
  const marks = outcomes.filter(item => item.value > 0)
  return <Panel>
    <Text font="headline">{title}</Text>
    <HStack spacing={14}>
      <Chart frame={{ width: 96, height: 96 }} chartLegend="hidden">
        <DonutChart marks={marks.map(item => ({ ...item, innerRadius: { type: "ratio", value: 0.7 }, angularInset: marks.length > 1 ? 1 : 0 }))} />
      </Chart>
      <VStack alignment="leading" spacing={9} frame={{ maxWidth: "infinity" }}>
        {outcomes.map(item => <HStack key={item.category} spacing={6}>
          <StatusDot color={item.foregroundStyle} />
          <Text font="subheadline">{item.category}</Text><Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel" monospacedDigit>
            {`${tokenCounts ? `${compactTokens.format(item.value)} Token` : `${item.value} 次`} · ${(item.value / total * 100).toFixed(1)}%`}
          </Text>
        </HStack>)}
      </VStack>
    </HStack>
  </Panel>
}

export function RequestOutcomeChart({ successes, failures }: { successes: number; failures: number }) {
  return <OutcomeDonut title="请求结果" outcomes={[
    { category: "成功", value: successes, foregroundStyle: "systemGreen" },
    { category: "失败", value: failures, foregroundStyle: "systemRed" },
  ]} />
}

export function CacheOutcomeChart({ hit, miss }: { hit: number; miss: number }) {
  return <OutcomeDonut title="缓存命中" tokenCounts outcomes={[
    { category: "命中", value: hit, foregroundStyle: accent },
    { category: "未命中", value: miss, foregroundStyle: "systemGray" },
  ]} />
}
