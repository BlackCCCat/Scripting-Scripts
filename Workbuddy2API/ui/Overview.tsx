import { BarChart, Button, Chart, Divider, Gauge, HStack, ScrollView, Spacer, Text, Toggle, VStack, useEffect, useState, Script } from "scripting"
import { accounts, checkinStatusNeedsRefresh, modelLocks, records, todayInChina, type Account } from "../local/store"
import { checkin, refreshBalance, refreshCheckinStatus } from "../local/upstream"
import { gatewayState, serviceAddress, startGateway, stopGateway, subscribeGateway } from "../local/gateway"
import { accent, alertError, barFill, glass, Hint, insetSurface, Metric, PageBackdrop, pageMargins, Panel, StatusDot, SymbolTile } from "./Shared"

const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)

export function OverviewPage({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [items, setItems] = useState<Account[]>(accounts)
  const [locks, setLocks] = useState(modelLocks)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [statusFailed, setStatusFailed] = useState<string[]>([])
  const [service, setService] = useState(gatewayState)
  const [serviceBusy, setServiceBusy] = useState(false)
  useEffect(() => subscribeGateway(() => setService(gatewayState())), [])
  useEffect(() => {
    let active = true
    const current = accounts()
    setItems(current)
    setStatusFailed([])
    const due = current.filter(item => item.site === "cn" && !item.enterpriseId && checkinStatusNeedsRefresh(item.uid))
    if (!due.length) { setChecking(false); return }
    setChecking(true)
    void Promise.allSettled(due.map(item => refreshCheckinStatus(item.uid))).then(results => {
      if (active) {
        setStatusFailed(due.filter((_, index) => results[index].status === "rejected").map(item => item.uid))
        setItems(accounts()); setChecking(false)
      }
    })
    return () => { active = false }
  }, [revision])
  useEffect(() => { setLocks(modelLocks()); const timer = setInterval(() => setLocks(modelLocks()), 15_000); return () => clearInterval(timer) }, [revision])
  const recent = records()
  const today = new Date().toDateString()
  const todayTokens = recent.filter(item => new Date(item.at).toDateString() === today).reduce((sum, item) => sum + item.tokens, 0)
  const servingItems = items.filter(item => item.enabled !== false)
  const available = servingItems.filter(item => !item.error).length
  const disabled = items.length - servingItems.length
  const credits = items.reduce((sum, item) => sum + Math.max(0, item.credits ?? 0), 0)
  const successes = recent.filter(item => item.ok).length
  const cacheHit = recent.reduce((sum, item) => sum + (item.cacheHitTokens ?? 0), 0)
  const cacheTotal = recent.reduce((sum, item) => sum + (item.cacheHitTokens ?? 0) + (item.cacheMissTokens ?? 0), 0)
  const eligible = items.filter(item => item.site === "cn" && !item.enterpriseId)
  const checked = eligible.filter(item => item.checkedIn === todayInChina()).length
  const pendingCheckins = eligible.filter(item => item.checkedIn !== todayInChina() && (item.checkinActive !== false || statusFailed.includes(item.uid)))
  const uncertain = pendingCheckins.filter(item => statusFailed.includes(item.uid)).length
  const checkinColor = eligible.length && checked === eligible.length ? "systemBlue"
    : !checking && !busy && !uncertain && pendingCheckins.length ? "systemGreen" : "systemRed"
  const checkinStatus = !eligible.length ? "暂无可签到账号" : checking ? "正在确认签到…" : busy ? "正在签到…"
    : checked === eligible.length ? "今日已签到"
    : uncertain ? `${uncertain} 个状态待确认 · 轻点签到`
    : pendingCheckins.length ? `今日 ${checked}/${eligible.length} 已签 · 轻点签到`
    : "签到活动未开启"
  const lockRows = [...new Map(locks.filter(lock => servingItems.some(item => item.uid === lock.uid)).map(lock => {
    const site = servingItems.find(item => item.uid === lock.uid)?.site
    return [`${site === "cn" ? "cn" : "global"}:${lock.model}`, { realm: site === "cn" ? "国内版" : "国际版", model: lock.model }]
  })).values()].map(row => {
    const sameRealm = servingItems.filter(item => (item.site === "cn" ? "国内版" : "国际版") === row.realm)
    const affected = locks.filter(lock => lock.model === row.model && sameRealm.some(item => item.uid === lock.uid)).sort((a, b) => a.until - b.until)
    return { ...row, total: sameRealm.length, locked: affected.length, until: affected[0].until, reason: affected[0].reason, estimated: affected[0].estimated }
  })
  const lastUpdated = Math.max(0, ...items.map(item => item.updatedAt ?? 0))
  const hour = 3_600_000
  const firstHour = Math.floor(Date.now() / hour) * hour - 23 * hour
  const hourlyTokens = Array<number>(24).fill(0)
  for (const item of recent) {
    const index = Math.floor((item.at - firstHour) / hour)
    if (index >= 0 && index < 24) hourlyTokens[index] += item.tokens
  }
  const trend = hourlyTokens.map((value, index) => ({ label: new Date(firstHour + index * hour), value, unit: "hour" as const, foregroundStyle: barFill, cornerRadius: 3 }))

  async function run(kind: "balance" | "checkin") {
    if (busy) return
    setBusy(true)
    let failed = 0
    for (const item of items) {
      if (kind === "checkin" && !pendingCheckins.some(account => account.uid === item.uid)) continue
      try { if (kind === "checkin") await checkin(item.uid); else await refreshBalance(item.uid) }
      catch { failed++ }
    }
    setItems(accounts()); onChanged(); setBusy(false)
    if (failed) await Dialog.alert({ message: `${failed} 个账号操作失败，可在账号详情查看并重试` })
  }
  function tapCheckin() {
    if (busy || checking || !pendingCheckins.length) return
    HapticFeedback.lightImpact()
    void run("checkin").catch(alertError)
  }
  async function toggleService(enabled: boolean) {
    if (serviceBusy) return
    setServiceBusy(true)
    try { if (enabled) await startGateway(); else await stopGateway() }
    catch (error) { await alertError(error) }
    finally {
      setService(gatewayState())
      if (Script.supportsMinimization()) Script.enableMinimize(gatewayState().running)
      setServiceBusy(false)
    }
  }
  async function copyServiceAddress() {
    try {
      await Pasteboard.setString(serviceAddress())
      await Dialog.alert({ message: "已复制 HTTP API 地址" })
    } catch (error) { await alertError(error) }
  }
  return <ScrollView navigationTitle="概览" navigationBarTitleDisplayMode="large" background={<PageBackdrop />} contentMargins={pageMargins}
    toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" disabled={busy} action={() => void run("balance").catch(alertError)} /> }}>
    <VStack alignment="leading" spacing={14} padding={{ horizontal: 16 }}>
      <Panel hero>
        <HStack spacing={12}>
          <VStack alignment="leading" spacing={4}>
            <Text font="title2" fontWeight="bold">HTTP API</Text>
            <HStack spacing={6}>
              <StatusDot color={service.running ? "systemGreen" : "systemGray"} />
              <Hint>{serviceBusy ? "正在切换…" : service.running ? "运行中" : "已停止"}</Hint>
            </HStack>
          </VStack>
          <Spacer />
          <Toggle title="HTTP API 服务" labelsHidden value={service.running} disabled={serviceBusy}
            onChanged={value => void toggleService(value)} toggleStyle="switch" tint={accent} />
        </HStack>
        <HStack spacing={8} padding={{ leading: 12, trailing: 6, vertical: 2 }}
          background={{ style: insetSurface, shape: { type: "rect", cornerRadius: 12 } }}>
          <Text font="subheadline" fontDesign="monospaced" lineLimit={1} truncationMode="middle"
            frame={{ maxWidth: "infinity", alignment: "leading" }}>{serviceAddress()}</Text>
          <Button title="复制服务地址" systemImage="doc.on.doc" labelStyle="iconOnly"
            buttonStyle={glass ? "glass" : "bordered"} action={() => void copyServiceAddress()} />
        </HStack>
        <Divider />
        <Button buttonStyle="plain" action={tapCheckin}>
          <HStack spacing={14} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Gauge value={available} max={Math.max(1, servingItems.length)} label={<Text>账号池健康</Text>}
              currentValueLabel={<Text monospacedDigit>{`${available}/${servingItems.length}`}</Text>}
              gaugeStyle="accessoryCircularCapacity" tint={accent} scaleEffect={1.2} frame={{ width: 72, height: 72 }} />
            <VStack alignment="leading" spacing={5}>
              <Text font="headline">{items.length ? "账号池健康" : "等待添加账号"}</Text>
              <Hint>{`${available} 个可用 · ${servingItems.length - available} 个需检查${disabled ? ` · ${disabled} 个已停用` : ""}`}</Hint>
              <HStack spacing={6}><StatusDot color={checkinColor} /><Hint>{checkinStatus}</Hint></HStack>
            </VStack>
          </HStack>
        </Button>
      </Panel>
      <Panel>
        <HStack alignment="top" spacing={12}>
          <Metric label="剩余积分" value={compact(credits)} />
          <Divider frame={{ height: 40 }} />
          <Metric label="今日用量 · Token" value={compact(todayTokens)} />
        </HStack>
        <Divider />
        <HStack alignment="top" spacing={12}>
          <Metric label="请求成功率" value={recent.length ? `${Math.round(successes / recent.length * 100)}%` : "—"} />
          <Divider frame={{ height: 40 }} />
          <Metric label="缓存命中" value={cacheTotal ? `${Math.round(cacheHit / cacheTotal * 100)}%` : "—"} />
        </HStack>
        {lastUpdated > 0 && <Hint>{`余额更新于 ${new Date(lastUpdated).toLocaleString("zh-CN")}`}</Hint>}
        {items.some(item => item.credits === -1) && <Hint>不限量企业账号未计入积分合计。</Hint>}
      </Panel>
      <Panel>
        <VStack alignment="leading" spacing={3}>
          <Text font="headline">每小时用量</Text>
          <Hint>最近 24 小时 · 左右滑动查看</Hint>
        </VStack>
        {trend.some(item => item.value > 0) ? <Chart frame={{ height: 155 }} chartScrollableAxes="horizontal" chartXVisibleDomain={10 * 3600}
          chartScrollPositionX={trend[14].label} chartScrollTargetBehavior={{ matching: new DateComponents({ hour: 1 }) }}
          chartXAxis={{ values: { type: "strideDate", by: "hour", count: 2 }, valueLabel: { format: "time" } }}
          chartYAxis={{ values: { type: "automatic", desiredCount: 3 } }}><BarChart marks={trend} /></Chart> : <Hint>暂无本机 Token 用量</Hint>}
      </Panel>
      <Panel>
        <HStack spacing={10}>
          <SymbolTile symbol="lock" />
          <VStack alignment="leading" spacing={3}>
            <Text font="headline">模型锁池</Text>
            <Hint>{lockRows.length ? `${lockRows.length} 个模型分组暂时受限` : "当前无限流"}</Hint>
          </VStack>
        </HStack>
        {lockRows.map(row => <VStack key={`${row.realm}:${row.model}`} alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Divider />
          <Text font="subheadline" fontWeight="medium">{`${row.model} · ${row.realm}`}</Text>
          <Hint>{`${row.total - row.locked}/${row.total} 个账号未锁 · ${row.estimated ? "本机重试" : "上游重置"} ${new Date(row.until).toLocaleString("zh-CN")}`}</Hint>
          {!!row.reason && <Hint>{row.reason}</Hint>}
        </VStack>)}
      </Panel>
    </VStack>
  </ScrollView>
}
