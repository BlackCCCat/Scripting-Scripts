import { Button, Divider, HStack, Picker, ScrollView, Text, VStack, useEffect, useState } from "scripting"
import { accounts, records, type RequestRecord } from "../local/store"
import { CacheOutcomeChart, RequestOutcomeChart, UsageChart, UsageTrend, type Usage } from "./DataCharts"
import { Hint, Metric, PageBackdrop, pageMargins, Panel } from "./Shared"

type Group = "account" | "model" | "region"
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)

export function DataPage({ revision }: { revision: number }) {
  const [entries, setEntries] = useState<RequestRecord[]>(records)
  const [days, setDays] = useState(-1)
  const [group, setGroup] = useState<Group>("account")
  useEffect(() => { setEntries(records()) }, [revision])
  const now = Date.now()
  const todayStart = new Date(now).setHours(0, 0, 0, 0)
  const from = days === -1 ? todayStart : days > 0 ? now - days * 86_400_000
    : Math.min(now, ...entries.map(item => item.at))
  const filtered = entries.filter(item => item.at >= from && item.at <= now)
  const successes = filtered.filter(item => item.ok)
  const tokens = successes.reduce((sum, item) => sum + item.tokens, 0)
  const spentSamples = filtered.filter(item => Number.isFinite(item.creditsSpent))
  const creditsSpent = spentSamples.reduce((sum, item) => sum + (item.creditsSpent ?? 0), 0)
  let cacheHit = 0
  let cacheMiss = 0
  for (const { cacheHitTokens: hit, cacheMissTokens: miss } of filtered) {
    if (hit == null || miss == null || !Number.isFinite(hit) || !Number.isFinite(miss) || hit < 0 || miss < 0) continue
    cacheHit += hit
    cacheMiss += miss
  }
  const cacheTotal = cacheHit + cacheMiss
  const failures = filtered.length - successes.length
  const timed = filtered.filter(item => item.durationMs != null)
  const averageLatency = timed.length ? `${(timed.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) / timed.length / 1000).toFixed(1)}s` : "—"
  const span = days > 0 ? days : days === -1 ? 1 : Math.max(1, Math.ceil((now - from) / 86_400_000))
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
  const periodTitle = days === -1 ? "今日用量" : days ? `近 ${days} 天用量` : "累计用量"
  return <ScrollView navigationTitle="数据" navigationBarTitleDisplayMode="large" background={<PageBackdrop />} contentMargins={pageMargins}
    toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" action={() => setEntries(records())} /> }}>
    <VStack alignment="leading" spacing={14} padding={{ horizontal: 16 }}>
      <Picker title="时间区间" pickerStyle="segmented" value={days} onChanged={setDays}>
        <Text tag={3}>3天</Text><Text tag={7}>7天</Text><Text tag={30}>30天</Text><Text tag={-1}>今天</Text><Text tag={0}>总计</Text>
      </Picker>
      <Panel hero>
        <Hint>{periodTitle}</Hint>
        <HStack alignment="firstTextBaseline" spacing={8}>
          <Text font="largeTitle" fontWeight="bold" monospacedDigit>{tokens.toLocaleString("zh-CN")}</Text>
          <Hint>Token</Hint>
        </HStack>
        <Divider />
        <HStack alignment="top" spacing={10}>
          <Metric label="请求数" value={String(filtered.length)} compact valueFirst />
          <Metric label="积分消耗" value={spentSamples.length ? creditsSpent.toFixed(1) : "—"} compact valueFirst />
          <Metric label="错误数" value={String(failures)} compact valueFirst />
        </HStack>
        <Divider />
        <HStack alignment="top" spacing={10}>
          <Metric label="平均延迟" value={averageLatency} compact />
          <Metric label="缓存命中" value={cacheTotal ? `${Math.round(cacheHit / cacheTotal * 100)}%` : "—"} compact />
          <Metric label={days === -1 ? "小时均 Token" : "日均 Token"} value={compact(Math.round(averageTokens))} compact />
        </HStack>
      </Panel>
      <Panel>
        <Text font="headline">{`请求数分布 · ${groupTitle}`}</Text>
        <Picker title="分组方式" pickerStyle="segmented" value={group} onChanged={(value: string) => setGroup(value as Group)}>
          <Text tag="account">按账号</Text><Text tag="model">按模型</Text><Text tag="region">按域</Text>
        </Picker>
        <UsageChart items={usage} />
        <Hint>本机请求记录 · 最近最多 200 次</Hint>
      </Panel>
      {!!filtered.length && <UsageTrend entries={filtered} from={from} now={now} hourly={days === -1} />}
      {!!filtered.length && <RequestOutcomeChart successes={successes.length} failures={failures} />}
      {!!filtered.length && <CacheOutcomeChart hit={cacheHit} miss={cacheMiss} />}
    </VStack>
  </ScrollView>
}
