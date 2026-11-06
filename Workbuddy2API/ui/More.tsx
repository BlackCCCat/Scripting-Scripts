import { Button, HStack, Image, Link, List, NavigationLink, Picker, Section, Text, TextField, Toggle, VStack, useEffect, useState } from "scripting"
import { Script } from "scripting"
import { accountRotationEnabled, accounts, addressHost, fixedAccountUid, hiddenModelIds, listenPort, modelCatalog, modelCatalogNeedsRefresh, setAccountRotationEnabled, setAddressHost, setFixedAccountUid, setListenPort, setModelHidden, type ModelEntry } from "../local/store"
import { clearDiagnosticRun, diagnosticFailure, diagnosticFieldsText, diagnosticLocalTime, diagnosticOutcomeName, diagnosticSnapshot, diagnosticStageName, diagnosticsEnabled, exportDiagnosticFile, readDiagnosticLog, setDiagnosticsEnabled, subscribeDiagnostics, type DiagnosticRequest } from "../local/diagnostics"
import { claimGift, giftStatus, refreshBalance, refreshModelCatalog, vouchers, type GiftStatus, type Voucher } from "../local/upstream"
import { gatewayState, serviceAddress, serviceDefaultHost, setLanEnabled, startGateway, stopGateway, subscribeGateway } from "../local/gateway"
import { alertError, Busy, Failure, Hint } from "./Shared"

export function MorePage() {
  const [state, setState] = useState(gatewayState)
  const [busy, setBusy] = useState(false)
  const [host, setHost] = useState(() => addressHost(""))
  const [portText, setPortText] = useState(() => String(listenPort()))
  const [rotation, setRotation] = useState(accountRotationEnabled)
  const [fixedUid, setFixedUid] = useState(fixedAccountUid)
  const [logging, setLogging] = useState(diagnosticsEnabled)
  useEffect(() => subscribeGateway(() => setState(gatewayState())), [])
  const autoHost = serviceDefaultHost
  async function toggle() {
    if (busy) return
    setBusy(true)
    try { if (gatewayState().running) await stopGateway(); else await startGateway(); setState(gatewayState()) }
    catch (error) { setState(gatewayState()); await alertError(error) }
    finally { if (Script.supportsMinimization()) Script.enableMinimize(gatewayState().running); setBusy(false) }
  }
  async function changeLan(value: boolean) {
    if (busy) return
    setBusy(true)
    try {
      const wasRunning = gatewayState().running
      if (wasRunning) await stopGateway()
      setLanEnabled(value)
      if (wasRunning) await startGateway()
      setState(gatewayState())
    } catch (error) { setState(gatewayState()); await alertError(error) }
    finally { if (Script.supportsMinimization()) Script.enableMinimize(gatewayState().running); setBusy(false) }
  }
  async function saveEndpoint() {
    if (busy) return
    setBusy(true)
    try {
      const port = Number(portText.trim())
      if (!/^\d+$/.test(portText.trim()) || port < 1 || port > 65535) throw new Error("端口必须是 1-65535 的整数")
      setAddressHost(host)
      setListenPort(port)
      if (gatewayState().running && gatewayState().port !== port) { await stopGateway(); await startGateway() }
      setState(gatewayState())
    } catch (error) { setState(gatewayState()); await alertError(error) }
    finally { if (Script.supportsMinimization()) Script.enableMinimize(gatewayState().running); setBusy(false) }
  }
  async function copyAddress() {
    try {
      const url = serviceAddress()
      await Pasteboard.setString(url)
      await Dialog.alert({ title: "已复制", message: url })
    } catch (error) { await alertError(error) }
  }
  async function changeRotation(value: boolean) {
    try {
      if (!value && !fixedUid) {
        const first = accounts().find(account => account.enabled !== false) ?? accounts()[0]
        if (!first) throw new Error("请先添加账号")
        setFixedAccountUid(first.uid)
        setFixedUid(first.uid)
      }
      setAccountRotationEnabled(value)
      setRotation(value)
    } catch (error) { await alertError(error) }
  }
  const accountChoices = accounts()
  return <List navigationTitle="更多">
    <Section title="模型与日志">
      <NavigationLink destination={<ModelsPage />}><HStack spacing={12}><Image systemName="square.stack.3d.up" foregroundStyle="systemPurple" /><VStack alignment="leading" spacing={2}><Text>模型</Text><Hint>模型目录与展示控制</Hint></VStack></HStack></NavigationLink>
      <NavigationLink destination={<LogsPage />}><HStack spacing={12}><Image systemName="text.alignleft" foregroundStyle="systemPurple" /><VStack alignment="leading" spacing={2}><Text>日志</Text><Hint>本次服务的请求过程与错误</Hint></VStack></HStack></NavigationLink>
    </Section>
    <Section title="资源">
      <NavigationLink destination={<GiftPage />}><HStack spacing={12}><Image systemName="gift" foregroundStyle="systemPurple" /><VStack alignment="leading" spacing={2}><Text>礼包</Text><Hint>按账号查看与领取</Hint></VStack></HStack></NavigationLink>
      <NavigationLink destination={<VouchersPage />}><HStack spacing={12}><Image systemName="ticket" foregroundStyle="systemPurple" /><VStack alignment="leading" spacing={2}><Text>券码</Text><Hint>历史券码一览</Hint></VStack></HStack></NavigationLink>
      <HStack spacing={12}><Image systemName="arrow.uturn.backward.circle" foregroundStyle="secondaryLabel" /><VStack alignment="leading" spacing={2}><Text>补偿</Text><Hint>上游活动已结束</Hint></VStack></HStack>
    </Section>
    <Section title="关于">
      <NavigationLink destination={<AboutPage />}><HStack spacing={12}><Image systemName="chevron.left.forwardslash.chevron.right" foregroundStyle="systemPurple" /><VStack alignment="leading" spacing={2}><Text>开源</Text><Hint>仓库、构建与同步基准</Hint></VStack></HStack></NavigationLink>
    </Section>
    <Section title="系统 · 本机 API 服务">
      <Text>{state.running ? "运行中" : "已停止"}</Text>
      {state.running && <Hint>{state.keptAlive ? "后台保活已开启" : `后台保活不可用${state.backgroundIssue ? `：${state.backgroundIssue}` : ""}`}</Hint>}
      {state.running && <Hint>{state.activityActive ? "锁屏实时活动已开启；支持的设备会显示灵动岛" : `实时活动未显示${state.activityIssue ? `：${state.activityIssue}` : ""}`}</Hint>}
      {!state.running && !!state.activityIssue && <Text foregroundStyle="systemOrange">{state.activityIssue}</Text>}
      <HStack spacing={8} alignment="center">
        <TextField title="主机名或 IP" prompt={autoHost()} value={host} onChanged={setHost} frame={{ maxWidth: "infinity" }} />
        <Button title="复制地址" systemImage="doc.on.doc" labelStyle="iconOnly" disabled={host !== addressHost("") || portText !== String(listenPort())} action={() => void copyAddress()} />
      </HStack>
      <TextField title="端口" value={portText} keyboardType="numberPad" onChanged={setPortText} />
      {(host !== addressHost("") || portText !== String(listenPort())) && <Button title="保存地址和端口" systemImage="checkmark" disabled={busy} action={() => void saveEndpoint()} />}
      <Hint>地址留空时自动使用当前网络地址；自定义地址用于复制，监听范围由局域网开关控制。端口固定，保存后若服务运行会自动重启。</Hint>
      <Hint>接口：GET /v1/models、POST /v1/chat/completions。无需鉴权头，客户端任意填写或留空 API Key 均可。</Hint>
      <Hint>流式请求会逐块转发上游 SSE；客户端断开时会取消上游请求。</Hint>
      <Button title={busy ? "处理中…" : state.running ? "停止服务" : "启动服务"} systemImage={state.running ? "stop.fill" : "play.fill"} disabled={busy} action={() => void toggle()} />
      <Toggle title="允许局域网访问" systemImage="wifi" value={state.lan} disabled={busy} onChanged={value => void changeLan(value)} />
      <Toggle title="账号轮询" systemImage="arrow.triangle.2.circlepath" value={rotation} disabled={!accountChoices.length} onChanged={value => void changeRotation(value)} />
      <Toggle title="请求诊断日志" systemImage="waveform.path.ecg" value={logging} onChanged={value => {
        try { setDiagnosticsEnabled(value); setLogging(value) } catch (error) { void alertError(error) }
      }} />
      <Hint>默认开启；只保留最近一次 HTTP 服务运行的日志。记录阶段、状态与大小，不保存请求正文、思考文字或密钥。</Hint>
      {!rotation && !!accountChoices.length && <>
        <Picker title="固定账号" pickerStyle="navigationLink" value={fixedUid} onChanged={(uid: string) => { try { setFixedAccountUid(uid); setFixedUid(uid) } catch (error) { void alertError(error) } }}>
          {!!fixedUid && !accountChoices.some(item => item.uid === fixedUid) && <Text tag={fixedUid}>原账号已移除</Text>}
          {accountChoices.map(item => <Text key={item.uid} tag={item.uid}>{item.nickname || item.uid}</Text>)}
        </Picker>
        <Hint>关闭轮询后仅使用固定账号；该账号停用、额度耗尽、模型受限或请求失败时直接返回错误。</Hint>
      </>}
      {!rotation && !accountChoices.length && <Hint>请先添加账号，再选择固定账号。</Hint>}
      {rotation && <Hint>新会话轮流分配账号，同一会话优先复用原账号；不可用时才尝试其他账号。</Hint>}
      {state.running && Script.supportsMinimization() && <Button title="收起界面，保持服务" systemImage="rectangle.compress.vertical" action={() => { void Script.minimize() }} />}
      {!!state.lastError && <Text foregroundStyle="systemRed">{state.lastError}</Text>}
      <Hint>局域网使用明文 HTTP 且无鉴权，请仅在可信网络中开启。后台保活使用系统音频资源；iOS 仍可能挂起或终止脚本。</Hint>
    </Section>
  </List>
}

function AboutPage() {
  return <List navigationTitle="开源与关于">
    <Section title="项目"><Text>WorkBuddy2API for Scripting</Text><Hint>界面与功能参考 chenyynx 的 wb2api-ios；账号与任务协议参考 workbuddy2api-panel，成长任务一键执行流程参考 L0NE-6 的 WorkBuddy-Daily。感谢各项目作者及维护者。</Hint></Section>
    <Section title="原项目">
      <Link url="https://github.com/chenyynx/wb2api-ios"><HStack spacing={9}><Image systemName="iphone" foregroundStyle="systemBlue" /><Text>wb2api-ios · iOS 原项目</Text></HStack></Link>
      <Link url="https://github.com/misakano7545/workbuddy2api-panel"><HStack spacing={9}><Image systemName="server.rack" foregroundStyle="systemGreen" /><Text>workbuddy2api-panel · 上游后端</Text></HStack></Link>
      <Link url="https://github.com/L0NE-6/WorkBuddy-Daily"><HStack spacing={9}><Image systemName="checklist" foregroundStyle="systemOrange" /><Text>WorkBuddy-Daily · 任务自动化参考</Text></HStack></Link>
    </Section>
    <Section title="同步参考">
      <Hint>iOS 界面最初参考 42cd9651。iOS 与后端提交于 2026-10-31 核对，任务项目于 2026-11-01 核对；本脚本仅同步适用功能。</Hint>
      <Link url="https://github.com/chenyynx/wb2api-ios/commit/5c809a055d9a417370843abf8aa855c7eb755b97"><HStack spacing={9}><Image systemName="arrow.triangle.2.circlepath" foregroundStyle="systemBlue" /><Text>iOS 最新提交 · 5c809a055d9a</Text></HStack></Link>
      <Link url="https://github.com/misakano7545/workbuddy2api-panel/commit/8ab87d4e5178318fcbee9f611c48d3316749edc2"><HStack spacing={9}><Image systemName="arrow.triangle.2.circlepath" foregroundStyle="systemGreen" /><Text>后端最新提交 · 8ab87d4e5178</Text></HStack></Link>
      <Link url="https://github.com/L0NE-6/WorkBuddy-Daily/commit/c442bab4d356e3450433df83de9c2dabe3248239"><HStack spacing={9}><Image systemName="arrow.triangle.2.circlepath" foregroundStyle="systemOrange" /><Text>任务最新提交 · c442bab4d356</Text></HStack></Link>
    </Section>
  </List>
}

function lastAccount(request: DiagnosticRequest): string {
  const fields = request.events.findLast(event => event.stage === "route.selected")?.fields
  if (!fields?.account) return ""
  return fields.uidSuffix ? `${fields.account} · ${fields.site} · UID 尾号 ${fields.uidSuffix}` : `UID 尾号 ${fields.account}`
}

function DiagnosticDetailPage({ id }: { id: string }) {
  const [request, setRequest] = useState(() => diagnosticSnapshot()?.requests.find(item => item.id === id))
  useEffect(() => subscribeDiagnostics(() => setRequest(diagnosticSnapshot()?.requests.find(item => item.id === id))), [id])
  if (!request) return <List navigationTitle={`请求 ${id}`}><Section><Hint>这条记录已被清理或由新的服务运行替换</Hint></Section></List>
  return <List navigationTitle={`请求 ${request.id}`}>
    <Section title="请求"><Text>{`${request.method ?? "未知"} ${request.path ?? "未识别路径"}`}</Text>
      {!!request.model && <Text>{`模型：${request.model}`}</Text>}
      {!!lastAccount(request) && <Text>{`最后尝试账号：${lastAccount(request)}`}</Text>}
      <Hint>{`${diagnosticLocalTime(request.at)} · ${request.stream ? "流式" : "非流式"} · ${diagnosticOutcomeName(request.outcome)} · ${((request.events.at(-1)?.at ?? Date.now()) - request.at)} ms${request.status ? ` · HTTP ${request.status}` : ""}`}</Hint>
      {!!diagnosticFailure(request) && <Text foregroundStyle="systemRed">{diagnosticFailure(request)}</Text>}
    </Section>
    <Section title="过程">
      {request.events.map((event, index) => <VStack key={`${event.at}:${index}`} alignment="leading" spacing={3}>
        <Text>{diagnosticStageName(event.stage)}</Text>
        <Hint>{`${diagnosticLocalTime(event.at).slice(11, 19)} · +${event.at - request.at} ms`}</Hint>
        {!!event.fields && <Text font="caption" foregroundStyle="secondaryLabel">{diagnosticFieldsText(event.fields)}</Text>}
      </VStack>)}
      {!!request.droppedEvents && <Hint>{`已省略 ${request.droppedEvents} 条较早的过程记录`}</Hint>}
    </Section>
  </List>
}

function DiagnosticLogTextPage() {
  const [lines, setLines] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  async function load() {
    setLoading(true)
    try {
      const content = await readDiagnosticLog()
      setLines(content.trimEnd().split("\n").filter(Boolean))
      setError("")
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  return <List navigationTitle="查看完整日志" toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" disabled={loading} action={() => void load()} /> }}>
    {loading && <Section><Hint>正在读取日志…</Hint></Section>}
    {!!error && <Section><Text foregroundStyle="systemRed">{error}</Text></Section>}
    {!loading && !error && <>
      <Section title={`完整日志 · ${lines.length} 行`}>
        {!lines.length && <Hint>当前没有日志内容</Hint>}
        {lines.map((line, index) => <Text key={index} font="caption2" fontDesign="monospaced" foregroundStyle="label">{line}</Text>)}
      </Section>
    </>}
  </List>
}

function LogsPage() {
  const [run, setRun] = useState(diagnosticSnapshot)
  const [busy, setBusy] = useState(false)
  useEffect(() => subscribeDiagnostics(() => setRun(diagnosticSnapshot())), [])
  async function clear() {
    if (!await Dialog.confirm({ title: "清理请求日志", message: "清理当前日志？服务运行时的新请求仍会继续记录。", confirmLabel: "清理", cancelLabel: "取消" })) return
    try { await clearDiagnosticRun(); setRun(diagnosticSnapshot()) }
    catch (error) { await alertError(error) }
  }
  async function exportLog() {
    if (!diagnosticSnapshot() || busy) return
    setBusy(true)
    let path: string | null = null
    try {
      path = await exportDiagnosticFile()
      await ShareSheet.present([path])
    } catch (error) { await alertError(error) }
    finally { if (path) try { await FileManager.remove(path) } catch { }; setBusy(false) }
  }
  return <List navigationTitle="请求诊断日志" toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" action={() => setRun(diagnosticSnapshot())} /> }}>
    <Section title="本次服务">
      {!run && <Hint>暂无日志。开启 HTTP 服务后开始记录；下次启动会替换上一份。</Hint>}
      {!!run && <>
        <Text>{`${diagnosticLocalTime(run.startedAt)} 启动 · ${run.endedAt ? "已关闭" : "运行中或上次异常结束"}`}</Text>
        <Hint>{`${run.lan ? "局域网" : "本机"} · 端口 ${run.port} · ${run.requests.length} 条请求${run.droppedRequests ? ` · 已裁掉较早的 ${run.droppedRequests} 条` : ""}`}</Hint>
        {run.saveFailed && <Text foregroundStyle="systemOrange">部分日志未能写入设备存储</Text>}
      </>}
      <Hint>按请求查看连接、账号换号、思考生成、写出和断开阶段。页面显示最近 200 条请求、每条最多 80 个事件；导出的文本日志包含本次运行全部已记录事件。</Hint>
    </Section>
    {!!run && <Section title="操作">
      <NavigationLink destination={<DiagnosticLogTextPage />}><HStack spacing={10}><Image systemName="doc.text" /><Text>查看日志</Text></HStack></NavigationLink>
      <Button title="导出完整日志" systemImage="square.and.arrow.up" disabled={busy} action={() => void exportLog()} />
      <Button title="清理日志" systemImage="trash" disabled={busy} action={() => void clear()} />
    </Section>}
    {!!run?.requests.length && <Section title="请求记录">
      {[...run.requests].reverse().map(request => <NavigationLink key={request.id} destination={<DiagnosticDetailPage id={request.id} />}>
        <HStack spacing={10}>
          <Image systemName={request.outcome === "ok" ? "checkmark.circle.fill" : request.outcome ? "exclamationmark.circle.fill" : "clock"} foregroundStyle={request.outcome === "ok" ? "systemGreen" : request.outcome === "error" ? "systemRed" : "systemOrange"} />
          <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text lineLimit={1}>{request.model || `${request.method ?? "连接"} ${request.path ?? ""}`}</Text>
            <Hint>{`${request.stream ? "流式" : "非流式"} · ${diagnosticOutcomeName(request.outcome)} · ${((request.events.at(-1)?.at ?? Date.now()) - request.at)} ms · ${diagnosticLocalTime(request.at).slice(11, 19)}`}</Hint>
            {!!lastAccount(request) && <Hint>{`账号：${lastAccount(request)}`}</Hint>}
            {!!diagnosticFailure(request) && <Text font="caption" foregroundStyle="systemRed" lineLimit={2}>{diagnosticFailure(request)}</Text>}
          </VStack>
        </HStack>
      </NavigationLink>)}
    </Section>}
  </List>
}

function GiftPage() {
  const [items, setItems] = useState<Record<string, GiftStatus>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  async function refresh() {
    if (busy) return
    setBusy(true); setLoading(true); setError("")
    const next: Record<string, GiftStatus> = {}, failures: string[] = []
    for (const account of accounts().filter(item => !item.enterpriseId)) {
      try { next[account.uid] = await giftStatus(account.uid) }
      catch (cause) { failures.push(`${account.nickname}：${cause instanceof Error ? cause.message : String(cause)}`) }
    }
    setItems(next); setError(failures.join("\n")); setLoading(false); setBusy(false)
  }
  async function claim(uid: string) {
    if (busy) return
    setBusy(true); setError("")
    try {
      const amount = await claimGift(uid)
      setItems(previous => ({ ...previous, [uid]: { ...previous[uid], claimed: true } }))
      let message = `已领取 ${amount} 积分`
      try { await refreshBalance(uid) } catch { message += "；余额刷新失败，可在账号页重试" }
      await Dialog.alert({ message })
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void refresh() }, [])
  return <List navigationTitle="礼包" toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" disabled={busy || loading} action={() => void refresh()} /> }}>
    {!!error && <Failure error={error} />}
    {!accounts().length && <Hint>请先添加账号</Hint>}
    {accounts().filter(item => !item.enterpriseId).map(account => <Section key={account.uid} title={account.nickname || account.uid}>
      {loading && <Busy text="正在查询礼包状态…" />}
      {!items[account.uid] && !loading && <Hint>暂未取得礼包状态</Hint>}
      {!!items[account.uid] && <Text>{!items[account.uid].active ? "当前没有活动" : items[account.uid].claimed ? "已领取" : items[account.uid].creditNum > 0 ? `待领取 ${items[account.uid].creditNum} 积分` : "暂无可领取积分"}</Text>}
      {!!items[account.uid]?.endTime && <Hint>{`截止 ${items[account.uid].endTime}`}</Hint>}
      {items[account.uid]?.active && !items[account.uid].claimed && items[account.uid].creditNum > 0 && <Button title="领取礼包" systemImage="gift.fill" disabled={busy} action={() => void claim(account.uid)} />}
    </Section>)}
    <Section><Hint>领取前会重新查询上游状态；礼包活动以账号实际返回为准。</Hint></Section>
  </List>
}

function VouchersPage() {
  const [items, setItems] = useState<Array<{ uid: string; nickname: string; voucher: Voucher }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function refresh() {
    if (busy) return
    setBusy(true); setError("")
    const next: Array<{ uid: string; nickname: string; voucher: Voucher }> = [], failures: string[] = []
    for (const account of accounts().filter(item => item.site === "cn" && !item.enterpriseId)) {
      try { for (const voucher of await vouchers(account.uid)) next.push({ uid: account.uid, nickname: account.nickname, voucher }) }
      catch (cause) { failures.push(`${account.nickname}：${cause instanceof Error ? cause.message : String(cause)}`) }
    }
    setItems(next); setError(failures.join("\n")); setBusy(false)
  }
  useEffect(() => { void refresh() }, [])
  return <List navigationTitle="券码" toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" disabled={busy} action={() => void refresh()} /> }}>
    {busy && <Busy />}{!!error && <Failure error={error} />}
    {!busy && !items.length && !error && <Hint>暂无历史券码</Hint>}
    {items.map(item => <Section key={`${item.uid}:${item.voucher.code}`} title={item.voucher.prizeName}>
      <Text>{item.voucher.code}</Text><Hint>{`${item.nickname}${item.voucher.validTo ? ` · 有效期至 ${item.voucher.validTo}` : ""}`}</Hint>
      <Button title="复制券码" systemImage="doc.on.doc" action={() => { void Pasteboard.setString(item.voucher.code).catch(alertError) }} />
    </Section>)}
    <Section><Hint>开学季活动已结束；这里只查询此前获得的第三方券码。</Hint></Section>
  </List>
}

function ModelsPage() {
  const [entries, setEntries] = useState<ModelEntry[]>(() => modelCatalogNeedsRefresh() ? [] : modelCatalog())
  const [hidden, setHidden] = useState<string[]>(hiddenModelIds)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function refresh() {
    if (busy) return
    setBusy(true); setError("")
    try { setEntries(await refreshModelCatalog()); setHidden(hiddenModelIds()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  useEffect(() => { if (modelCatalogNeedsRefresh()) void refresh() }, [])
  function flip(id: string, visible: boolean) {
    setModelHidden(id, !visible)
    setHidden(hiddenModelIds())
  }
  const groups = [{ realm: "cn" as const, title: "Workbuddy" }, { realm: "global" as const, title: "Workbuddy AI" }]
  return <List navigationTitle="模型列表" toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" disabled={busy} action={() => void refresh()} /> }}>
    {(busy || !!error) && <Section>{busy && <Busy text="正在从上游获取模型…" />}{!!error && <Failure error={error} retry={() => void refresh()} />}</Section>}
    {groups.map(group => {
      const hasAccount = accounts().some(item => (item.site === "cn" ? "cn" : "global") === group.realm)
      const groupEntries = hasAccount ? entries.filter(item => item.realm === group.realm) : []
      const enabled = groupEntries.filter(item => !hidden.includes(`${group.realm}:${item.id}`)).length
      return <Section key={group.realm} title={`${group.title}（已启用 ${enabled} / ${groupEntries.length}）`}>
        {!hasAccount && <Hint>{group.realm === "cn" ? "添加国内账号后获取模型" : "添加国际或旧国际账号后获取模型"}</Hint>}
        {hasAccount && !busy && !groupEntries.length && <Hint>暂无模型，点右上角刷新重试。</Hint>}
        {groupEntries.map(entry => <Toggle key={`${entry.realm}:${entry.id}`} title={entry.id} value={!hidden.includes(`${entry.realm}:${entry.id}`)} onChanged={value => flip(`${entry.realm}:${entry.id}`, value)} />)}
      </Section>
    })}
    <Section><Hint>开关只影响 /v1/models 展示，不代表账号一定有该模型的使用权限。</Hint></Section>
  </List>
}
