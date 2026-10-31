import { BarChart, Button, Chart, Circle, HStack, Picker, ScrollView, Spacer, Text, VStack, useEffect, useState, type Color, type DynamicShapeStyle } from "scripting"
import { accounts, records, type RequestRecord } from "../local/store"
import { Hint } from "./Shared"

type Usage = { key: string; label: string; value: number }
type Group = "account" | "model" | "region"
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
const barColors = ["systemBlue", "systemPurple", "systemGreen", "systemOrange", "systemTeal", "systemPink", "systemIndigo", "systemRed", "systemMint", "systemCyan", "systemBrown", "systemYellow"] as const

function barColor(index: number): Color | DynamicShapeStyle {
  if (index < barColors.length) return barColors[index]
  const hue = Math.round(index * 137.508) % 360
  return { light: `hsl(${hue},65%,42%)`, dark: `hsl(${hue},65%,65%)` }
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <VStack alignment="leading" spacing={8} padding={14} frame={{ maxWidth: "infinity", alignment: "leading" }} background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 18 } }}>
    <Hint>{label}</Hint><Text font="title3" fontWeight="semibold" monospacedDigit foregroundStyle={accent ? "systemPurple" : undefined}>{value}</Text>
  </VStack>
}

function UsageChart({ items }: { items: Usage[] }) {
  if (!items.length) return <Hint>暂无请求记录</Hint>
  const colors = new Map([...items].map(item => item.key).sort((a, b) => a.localeCompare(b)).map((key, index) => [key, barColor(index)]))
  const visible = items.slice(0, 8)
  const maximum = visible[0].value
  return <VStack alignment="leading" spacing={16} frame={{ maxWidth: "infinity", alignment: "leading" }}>
    {visible.map((item, index) => <VStack key={item.key} alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack spacing={7} frame={{ maxWidth: "infinity" }}>
        <Circle fill={colors.get(item.key)} frame={{ width: 8, height: 8 }} />
        <Text lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>{item.label}</Text>
        <Text foregroundStyle="secondaryLabel" monospacedDigit>{`${item.value.toLocaleString("zh-CN")} 次`}</Text>
      </HStack>
      <Chart frame={{ height: index === visible.length - 1 ? 48 : 28, maxWidth: "infinity" }}
        chartXAxis={index === visible.length - 1 ? { values: { type: "automatic", desiredCount: 4, roundLowerBound: true }, valueLabel: { format: "number" } } : "hidden"}
        chartYAxis="hidden" chartLegend="hidden"
        chartXScale={{ domain: { from: 0, to: maximum }, type: "linear" }}>
        <BarChart labelOnYAxis marks={[{ label: item.key, value: item.value, foregroundStyle: colors.get(item.key) }]} />
      </Chart>
    </VStack>)}
    {items.length > visible.length && <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Hint>{`其他 ${items.length - visible.length} 个分组`}</Hint>
      {items.slice(visible.length).map(item => <HStack key={item.key} spacing={7} frame={{ maxWidth: "infinity" }}>
        <Circle fill={colors.get(item.key)} frame={{ width: 8, height: 8 }} />
        <Text lineLimit={1}>{item.label}</Text>
        <Spacer />
        <Text foregroundStyle="secondaryLabel" monospacedDigit>{`${item.value.toLocaleString("zh-CN")} 次`}</Text>
      </HStack>)}
    </VStack>}
  </VStack>
}

export function DataPage({ revision }: { revision: number }) {
  const [entries, setEntries] = useState<RequestRecord[]>(records)
  const [days, setDays] = useState(0)
  const [group, setGroup] = useState<Group>("account")
  useEffect(() => { setEntries(records()) }, [revision])
  const now = Date.now()
  const todayStart = new Date(now).setHours(0, 0, 0, 0)
  const filtered = days === -1 ? entries.filter(item => item.at >= todayStart)
    : days ? entries.filter(item => item.at >= now - days * 86_400_000) : entries
  const successes = filtered.filter(item => item.ok)
  const tokens = successes.reduce((sum, item) => sum + item.tokens, 0)
  const spentSamples = filtered.filter(item => item.creditsSpent != null)
  const creditsSpent = spentSamples.reduce((sum, item) => sum + (item.creditsSpent ?? 0), 0)
  const cacheHit = filtered.reduce((sum, item) => sum + (item.cacheHitTokens ?? 0), 0)
  const cacheTotal = filtered.reduce((sum, item) => sum + (item.cacheHitTokens ?? 0) + (item.cacheMissTokens ?? 0), 0)
  const failures = filtered.length - successes.length
  const timed = filtered.filter(item => item.durationMs != null)
  const averageLatency = timed.length ? `${(timed.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) / timed.length / 1000).toFixed(1)}s` : "—"
  const span = days > 0 ? days : days === -1 ? 1 : Math.max(1, Math.ceil((now - Math.min(now, ...filtered.map(item => item.at))) / 86_400_000))
  const averageTokens = days === -1 ? tokens / Math.max(1, (now - todayStart) / 3_600_000) : tokens / span
  const known = new Map(accounts().map(account => [account.uid, account]))
  const nameCount = new Map<string, number>()
  for (const account of known.values()) nameCount.set(account.nickname, (nameCount.get(account.nickname) ?? 0) + 1)
  const groups = new Map<string, Usage>()
  for (const item of filtered) {
    const account = known.get(item.uid)
    let key: string, label: string
    if (group === "model") {
      key = label = item.model
    } else if (group === "region") {
      key = !account ? "removed" : account.site === "cn" ? "cn" : "global"
      label = key === "removed" ? "已移除账号" : key === "cn" ? "国内版" : "国际版"
    } else {
      key = item.uid
      label = !account ? `已移除 · ${item.uid.slice(0, 8)}` :
        (nameCount.get(account.nickname) ?? 0) > 1 ? `${account.nickname} · ${item.uid.slice(0, 8)}` : account.nickname
    }
    const current = groups.get(key)
    groups.set(key, { key, label, value: (current?.value ?? 0) + 1 })
  }
  const usage = [...groups.values()].sort((a, b) => b.value - a.value)
  const groupTitle = group === "account" ? "账号" : group === "model" ? "模型" : "区域"
  return <ScrollView navigationTitle="数据" navigationBarTitleDisplayMode="large" toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" action={() => setEntries(records())} /> }}>
    <VStack alignment="leading" spacing={18} padding={{ horizontal: 16, top: 16, bottom: 30 }}>
      <Picker title="时间区间" pickerStyle="segmented" value={days} onChanged={setDays}>
        <Text tag={3}>3天</Text><Text tag={7}>7天</Text><Text tag={30}>30天</Text><Text tag={-1}>今天</Text><Text tag={0}>总计</Text>
      </Picker>
      <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="headline">区间消耗</Text>
        <Hint>{days === -1 ? "今天 00:00 至今 · 仅统计本机保留的请求" : days ? `最近 ${days} 天 · 仅统计本机保留的请求` : "有记录以来 · 本机最多保留 200 次请求"}</Hint>
        <VStack alignment="leading" spacing={14} padding={18} frame={{ maxWidth: "infinity", alignment: "leading" }} background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 18 } }}>
          <HStack spacing={5}><Text font="largeTitle" fontWeight="bold" monospacedDigit>{compact(tokens)}</Text><Hint>tokens</Hint></HStack>
          <HStack spacing={18}><VStack alignment="leading"><Text font="headline" monospacedDigit>{compact(filtered.length)}</Text><Hint>请求</Hint></VStack><VStack alignment="leading"><Text font="headline" monospacedDigit>{spentSamples.length ? creditsSpent.toFixed(1) : "—"}</Text><Hint>积分</Hint></VStack><VStack alignment="leading"><Text font="headline" monospacedDigit>{compact(Math.round(averageTokens))}</Text><Hint>{days === -1 ? "小时均 Token" : "日均 Token"}</Hint></VStack></HStack>
        </VStack>
      </VStack>
      <Picker title="分组方式" pickerStyle="segmented" value={group} onChanged={(value: string) => setGroup(value as Group)}>
        <Text tag="account">按账号</Text><Text tag="model">按模型</Text><Text tag="region">按域</Text>
      </Picker>
      <HStack spacing={10}><Stat label="请求数" value={compact(filtered.length)} /><Stat label="总 Token" value={compact(tokens)} /></HStack>
      <HStack spacing={10}><Stat label="积分消耗" value={spentSamples.length ? creditsSpent.toFixed(1) : "—"} accent /><Stat label="错误数" value={compact(failures)} /></HStack>
      <HStack spacing={10}><Stat label="平均延迟" value={averageLatency} /><Stat label="缓存命中" value={cacheTotal ? `${Math.round(cacheHit / cacheTotal * 100)}%` : "—"} /></HStack>
      <VStack alignment="leading" spacing={10} padding={14} frame={{ maxWidth: "infinity", alignment: "leading" }} background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 18 } }}>
        <Text font="headline">{`请求数 · ${groupTitle}`}</Text>
        <UsageChart items={usage} />
      </VStack>
      <Hint>统计包括 API 与任务内对话；上游未返回 Token 用量时记为 0。积分、缓存命中和延迟只统计有对应字段的请求。</Hint>
    </VStack>
  </ScrollView>
}
