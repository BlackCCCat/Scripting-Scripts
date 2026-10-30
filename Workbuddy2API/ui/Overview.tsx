import { BarChart, Button, Chart, Circle, Gauge, HStack, Image, ScrollView, Text, Toggle, VStack, useEffect, useState, Script } from "scripting"
import { accounts, checkinStatusNeedsRefresh, modelLocks, records, todayInChina, type Account } from "../local/store"
import { checkin, refreshBalance, refreshCheckinStatus } from "../local/upstream"
import { gatewayState, startGateway, stopGateway, subscribeGateway } from "../local/gateway"
import { alertError, Hint } from "./Shared"

const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)

function OverviewStat({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return <VStack alignment="leading" spacing={5} padding={14} frame={{ maxWidth: "infinity", alignment: "leading" }} background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 18 } }}>
    <Hint>{label}</Hint><Text font="title2" fontWeight="semibold" monospacedDigit foregroundStyle={accent ? "systemPurple" : undefined}>{value}</Text><Hint>{detail}</Hint>
  </VStack>
}

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
  const available = items.filter(item => !item.error).length
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
  const lockRows = [...new Map(locks.map(lock => {
    const site = items.find(item => item.uid === lock.uid)?.site
    return [`${site === "cn" ? "cn" : "global"}:${lock.model}`, { realm: site === "cn" ? "国内版" : "国际版", model: lock.model }]
  })).values()].map(row => {
    const sameRealm = items.filter(item => (item.site === "cn" ? "国内版" : "国际版") === row.realm)
    const affected = locks.filter(lock => lock.model === row.model && sameRealm.some(item => item.uid === lock.uid)).sort((a, b) => a.until - b.until)
    return { ...row, total: sameRealm.length, locked: affected.length, until: affected[0].until, reason: affected[0].reason, estimated: affected[0].estimated }
  })
  const lastUpdated = Math.max(0, ...items.map(item => item.updatedAt ?? 0))
  const firstHour = Math.floor(Date.now() / 3_600_000) * 3_600_000 - 23 * 3_600_000
  const trend = Array.from({ length: 8 }, (_, index) => {
    const from = firstHour + index * 3 * 3_600_000
    return { label: new Date(from).getHours().toString().padStart(2, "0"), value: recent.filter(item => item.at >= from && item.at < from + 3 * 3_600_000).reduce((sum, item) => sum + item.tokens, 0) }
  })

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
  return <ScrollView navigationTitle="概览" navigationBarTitleDisplayMode="large" toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" disabled={busy} action={() => void run("balance").catch(alertError)} /> }}>
    <VStack alignment="leading" spacing={16} padding={{ horizontal: 16, top: 12, bottom: 28 }}>
      <Hint>{`${items.length} 个账号 · ${available} 个可用`}</Hint>
      <Hint>{lastUpdated ? `余额更新于 ${new Date(lastUpdated).toLocaleString("zh-CN")}` : "尚未刷新余额"}</Hint>
      <VStack alignment="leading" spacing={8} padding={{ horizontal: 18, top: 14, bottom: 12 }} frame={{ maxWidth: "infinity", alignment: "leading" }} background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 20 } }}>
        <Button buttonStyle="plain" action={tapCheckin}>
          <HStack spacing={16} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Gauge value={available} max={Math.max(1, items.length)} label={<Text>健康</Text>} currentValueLabel={<Text>{`${available}/${items.length}`}</Text>} gaugeStyle="accessoryCircularCapacity" tint="systemPurple" scaleEffect={1.2} frame={{ width: 120, height: 120 }} />
            <VStack alignment="leading" spacing={7} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text font="headline">{!items.length ? "等待添加账号" : available === items.length ? "池子状态良好" : "部分账号需检查"}</Text>
              <Hint>{`${available} 个账号可用 · ${items.length - available} 个需检查`}</Hint>
              <Hint>{recent.length ? `最近 ${recent.length} 次请求成功率 ${Math.round(successes / recent.length * 100)}%` : "暂无本机请求记录"}</Hint>
            </VStack>
          </HStack>
        </Button>
        <HStack spacing={6} frame={{ maxWidth: "infinity" }}>
          <Button buttonStyle="plain" frame={{ maxWidth: "infinity", alignment: "leading" }} action={tapCheckin}>
            <HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={2}>{checkinStatus}</Text>
              <Circle fill={checkinColor} frame={{ width: 10, height: 10 }} />
            </HStack>
          </Button>
          <HStack spacing={0} fixedSize={{ horizontal: true, vertical: false }}>
            <Text font="caption" lineLimit={1} fixedSize={{ horizontal: true, vertical: false }} padding={{ trailing: 12 }}>HTTP API</Text>
            <Toggle title="HTTP API 服务" labelsHidden value={service.running} disabled={serviceBusy} onChanged={value => void toggleService(value)} toggleStyle="switch" tint="systemPurple" frame={{ width: 52 }} />
          </HStack>
        </HStack>
      </VStack>
      <HStack spacing={10}><OverviewStat label="剩余积分" value={compact(credits)} detail="全部账号合计" accent /><OverviewStat label="今日消耗" value={compact(todayTokens)} detail="tokens · 今日" /></HStack>
      <HStack spacing={10}><OverviewStat label="成功率" value={recent.length ? `${Math.round(successes / recent.length * 100)}%` : "—"} detail="成功 / 请求" /><OverviewStat label="缓存命中" value={cacheTotal ? `${Math.round(cacheHit / cacheTotal * 100)}%` : "—"} detail="命中 / 输入 Token" /></HStack>
      {items.some(item => item.credits === -1) && <Hint>不限量企业账号未计入积分合计。</Hint>}
      <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="headline">模型锁池</Text>
        <Hint>本机 API 请求观测到的模型限流</Hint>
        {!lockRows.length && <HStack spacing={10} padding={12} frame={{ maxWidth: "infinity", alignment: "leading" }} background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 14 } }}>
          <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" />
          <Text>当前没有模型级限流</Text>
        </HStack>}
        {lockRows.map(row => <HStack key={`${row.realm}:${row.model}`} spacing={10} padding={12} frame={{ maxWidth: "infinity" }} background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 14 } }}>
          <Image systemName="lock.fill" foregroundStyle="systemOrange" />
          <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text lineLimit={1}>{`${row.model} · ${row.realm}`}</Text>
            <Hint>{`${row.total - row.locked}/${row.total} 个账号未锁 · ${row.estimated ? "本机重试" : "上游重置"} ${new Date(row.until).toLocaleString("zh-CN")}`}</Hint>
            {!!row.reason && <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{row.reason}</Text>}
          </VStack>
        </HStack>)}
      </VStack>
      <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="headline">用量趋势</Text><Hint>最近 24 小时 · 每 3 小时</Hint>
        <VStack padding={12} frame={{ maxWidth: "infinity" }} background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 18 } }}>
          {trend.some(item => item.value > 0) ? <Chart frame={{ height: 170 }} chartYAxis={{ values: { type: "automatic", desiredCount: 3 } }}><BarChart marks={trend.map(item => ({ ...item, foregroundStyle: "systemPurple" }))} /></Chart> : <Hint>暂无本机 Token 用量</Hint>}
        </VStack>
      </VStack>
    </VStack>
  </ScrollView>
}
