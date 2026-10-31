import { Button, HStack, Image, List, Menu, Navigation, NavigationLink, Picker, ProgressView, RoundedRectangle, ScrollView, Section, Spacer, Text, TextField, VStack, useEffect, useState } from "scripting"
import { accounts, checkinStatusNeedsRefresh, removeAccount, saveCredential, todayInChina, updateAccount, type Account, type Site } from "../local/store"
import { beginLogin, checkin, parseKeychainWorkBuddy, pollLogin, refreshBalance, refreshCheckinStatus, type LoginSession } from "../local/upstream"
import { alertError, Busy, Failure, glass, Hint, primaryButton } from "./Shared"
import { AccountTasksPage } from "./Tasks"

const credits = (value?: number) => value == null ? "—" : value < 0 ? "不限量" : value.toLocaleString("zh-CN")

export function AccountsPage({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [items, setItems] = useState<Account[]>(accounts)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<"added" | "credits" | "nickname">("added")
  const [availableOnly, setAvailableOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setItems(accounts()) }, [revision])
  const refresh = () => { setItems(accounts()); onChanged() }
  const visible = items.filter(item => (!availableOnly || item.enabled !== false && !item.error) && `${item.nickname} ${item.uid}`.toLowerCase().includes(search.trim().toLowerCase()))
  if (sort === "credits") visible.sort((a, b) => (b.credits ?? -1) - (a.credits ?? -1) || a.nickname.localeCompare(b.nickname, "zh-CN"))
  if (sort === "nickname") visible.sort((a, b) => a.nickname.localeCompare(b.nickname, "zh-CN"))
  const lastUpdated = Math.max(0, ...items.map(item => item.updatedAt ?? 0))
  async function refreshAll() {
    if (busy) return
    setBusy(true)
    let failures = 0
    for (const item of items) { try { await refreshBalance(item.uid) } catch { failures++ } }
    refresh(); setBusy(false)
    if (failures) await Dialog.alert({ message: `${failures} 个账号余额刷新失败，请查看账号详情。` })
  }
  function toggleAccount(item: Account) {
    try { updateAccount(item.uid, { enabled: item.enabled === false }); refresh() }
    catch (error) { void alertError(error) }
  }
  return <List navigationTitle="账号" navigationBarTitleDisplayMode="large" listStyle="plain" toolbar={{
    topBarLeading: <NavigationLink destination={<LoginPage onChanged={refresh} />}><Image systemName="plus" /></NavigationLink>,
    topBarTrailing: [
      <Menu title="排序方式" systemImage="arrow.up.arrow.down">
        <Button title="添加顺序" systemImage={sort === "added" ? "checkmark" : "list.number"} action={() => setSort("added")} />
        <Button title="积分从高到低" systemImage={sort === "credits" ? "checkmark" : "arrow.down"} action={() => setSort("credits")} />
        <Button title="按昵称" systemImage={sort === "nickname" ? "checkmark" : "textformat.abc"} action={() => setSort("nickname")} />
      </Menu>,
      <Button title="筛选可用" systemImage={availableOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"} action={() => setAvailableOnly(value => !value)} />,
      <Button title="刷新" systemImage="arrow.clockwise" disabled={busy} action={() => void refreshAll()} />,
    ],
  }} safeAreaInset={{ top: { content: <VStack alignment="leading" spacing={6} padding={{ horizontal: 16, top: 8, bottom: 8 }} background="systemBackground">
      <HStack spacing={8} padding={{ horizontal: 12, vertical: 7 }} background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 14 } }}>
        <Image systemName="magnifyingglass" foregroundStyle="secondaryLabel" />
        <TextField title="搜索账号" prompt="搜索昵称或 UID" value={search} onChanged={setSearch} frame={{ maxWidth: "infinity" }} />
      </HStack>
      <Hint>{`共 ${items.length} 个账号 · 显示 ${visible.length} 个 · ${sort === "added" ? "添加顺序" : sort === "credits" ? "积分从高到低" : "按昵称"}${availableOnly ? " · 仅可用" : ""}`}</Hint>
      {lastUpdated > 0 && <Hint>{`更新于 ${new Date(lastUpdated).toLocaleString("zh-CN")}`}</Hint>}
    </VStack> }, bottom: { content: <HStack padding={{ horizontal: 16, vertical: 8 }}><Spacer /><NavigationLink destination={<LoginPage onChanged={refresh} />} buttonStyle={glass ? "glassProminent" : "borderedProminent"} controlSize="large"><HStack spacing={8}><Image systemName="plus" /><Text>添加账号</Text></HStack></NavigationLink><Spacer /></HStack> } }}>
      {visible.map(item => <NavigationLink key={item.uid} destination={<AccountPage account={item} onChanged={refresh} />}
        listRowSeparator="hidden" listRowInsets={{ top: 20, bottom: 20, leading: 24, trailing: 24 }}
        listRowBackground={<RoundedRectangle cornerRadius={18} fill="secondarySystemBackground" opacity={item.enabled === false ? 0.5 : 1} padding={{ horizontal: 8, vertical: 6 }} />}
        trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title={item.enabled === false ? "启用" : "停用"}
          systemImage={item.enabled === false ? "checkmark.circle" : "pause.circle"}
          tint={item.enabled === false ? "systemGreen" : "systemOrange"} action={() => toggleAccount(item)} />] }}>
        <HStack spacing={12} opacity={item.enabled === false ? 0.5 : 1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <VStack spacing={2}><Image systemName={item.enterpriseId ? "building.2.fill" : "person.crop.circle.fill"} font="title2" foregroundStyle="systemPurple" /><Image systemName="circle.fill" font="caption2" foregroundStyle={item.enabled === false ? "systemGray" : item.error ? "systemRed" : "systemGreen"} /></VStack>
          <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font="headline" lineLimit={1}>{item.nickname || item.uid.slice(0, 8)}</Text>
            <Hint>{`${item.enabled === false ? "已停用 · 不参与 HTTP API" : item.error ? "需检查" : "可用"} · ${item.updatedAt ? new Date(item.updatedAt).toLocaleString("zh-CN") : "尚未更新"}`}</Hint>
            <Hint>{item.site === "cn" ? "国内版" : "国际版"}</Hint>
          </VStack>
          <VStack alignment="trailing" spacing={6} frame={{ width: 85 }}>
            <Text font="headline" monospacedDigit>{credits(item.credits)}</Text>
            {item.total != null && item.total > 0 && item.credits != null && item.credits >= 0 && <ProgressView value={Math.min(item.credits, item.total)} total={item.total} progressViewStyle="linear" tint="systemPurple" frame={{ width: 72 }} />}
          </VStack>
        </HStack>
      </NavigationLink>)}
      {!visible.length && <Hint>{items.length ? "没有匹配的账号" : "尚未添加账号，点击左上角添加。"}</Hint>}
  </List>
}

function AccountPage({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const [current, setCurrent] = useState(account)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(account.site === "cn" && !account.enterpriseId && checkinStatusNeedsRefresh(account.uid))
  const [statusUnavailable, setStatusUnavailable] = useState(false)
  const dismiss = Navigation.useDismiss()
  useEffect(() => {
    if (account.site !== "cn" || account.enterpriseId) return
    if (!checkinStatusNeedsRefresh(account.uid)) { setChecking(false); return }
    let active = true
    void refreshCheckinStatus(account.uid).then(() => {
      if (active) setCurrent(accounts().find(item => item.uid === account.uid) ?? account)
    }).catch(() => { if (active) setStatusUnavailable(true) }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [account.uid])
  async function run(action: "balance" | "checkin") {
    if (busy) return
    setBusy(true)
    try {
      if (action === "checkin") { await checkin(current.uid); setStatusUnavailable(false) }
      else await refreshBalance(current.uid)
      setCurrent(accounts().find(item => item.uid === current.uid) ?? current)
      onChanged()
    } catch (error) { await alertError(error) }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!await Dialog.confirm({ message: `移除 ${current.nickname}？重新使用需要再次授权。` })) return
    try { removeAccount(current.uid); onChanged(); dismiss() }
    catch (error) { await alertError(error) }
  }
  return <List navigationTitle={current.nickname || current.uid}>
    <Section title="账号"><Text>{`UID：${current.uid}`}</Text><Text>{`区域：${current.site === "cn" ? "国内版" : "国际版"}`}</Text><Text>{`HTTP 服务：${current.enabled === false ? "已停用" : "已启用"}`}</Text>{!!current.enterpriseId && <Hint>企业账号</Hint>}{!!current.error && <Failure error={current.error} />}</Section>
    <Section title="积分"><Text>{`剩余：${credits(current.credits)}`}</Text><Text>{`总额：${credits(current.total)}`}</Text><Hint>{current.updatedAt ? `上次更新：${new Date(current.updatedAt).toLocaleString()}` : "尚未查询余额"}</Hint></Section>
    <Section title="操作"><Button title={busy ? "正在查询…" : "刷新余额"} systemImage="arrow.clockwise" disabled={busy} action={() => void run("balance")} />
      {current.site === "cn" && !current.enterpriseId && <Button title={checking ? "查询签到状态…" : current.checkedIn === todayInChina() ? "今日已签到" : statusUnavailable ? "状态未确认，尝试签到" : current.checkinActive === false ? "签到活动未开启" : "签到"}
        systemImage={current.checkedIn === todayInChina() ? "checkmark.seal.fill" : "checkmark.seal"}
        disabled={busy || checking || current.checkedIn === todayInChina() || current.checkinActive === false && !statusUnavailable} action={() => void run("checkin")} />}
      <NavigationLink destination={<AccountTasksPage account={current} />}><HStack><Image systemName="checklist" /><Text>成长任务</Text></HStack></NavigationLink>
      <NavigationLink destination={<LoginPage site={current.site} expectedUid={current.uid} onChanged={() => { setCurrent(accounts().find(item => item.uid === current.uid) ?? current); onChanged() }} />}><HStack><Image systemName="arrow.triangle.2.circlepath" /><Text>重新授权</Text></HStack></NavigationLink>
    </Section>
    <Section><Button title="移除账号" systemImage="trash" role="destructive" action={() => void remove()} /></Section>
  </List>
}

export function LoginPage({ site = "cn", expectedUid, onChanged }: { site?: Site; expectedUid?: string; onChanged: () => void }) {
  const [region, setRegion] = useState<Site>(site)
  const [session, setSession] = useState<LoginSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState("")
  const [error, setError] = useState("")
  async function start() {
    if (busy) return
    if (session) { try { await Safari.present(session.url, false) } catch (cause) { await alertError(cause) }; return }
    setBusy(true); setResult(""); setError("")
    let current: LoginSession | null = null
    try { current = await beginLogin(region); setSession(current) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
    if (current) { try { await Safari.present(current.url, false) } catch (cause) { await alertError(cause) } }
  }
  async function poll(current: LoginSession) {
    if (busy) return
    setBusy(true)
    try {
      const value = await pollLogin(current, expectedUid)
      if (value) { setSession(null); setResult(`授权成功：${value.nickname}`); onChanged() }
    } catch (cause) { setSession(null); setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  async function importFromKeychain() {
    if (busy) return
    setBusy(true); setResult(""); setError("")
    try {
      const raw = await Keychain.pick({ title: "选择 WorkBuddy 凭据", prompt: "请选择一条 WorkBuddy 登录凭据。" })
      if (raw === null) return
      const value = parseKeychainWorkBuddy(raw, region)
      if (!value) { setResult("所选记录不是可识别的 WorkBuddy 登录凭据，已跳过。"); return }
      if (expectedUid && value.uid !== expectedUid) throw new Error("所选凭据与当前账号 UID 不一致")
      if (accounts().some(item => item.uid === value.uid) && !await Dialog.confirm({ message: `将替换 ${value.nickname} 的现有登录凭据，确定继续吗？` })) return
      saveCredential(value)
      setSession(null)
      setResult(`已导入：${value.nickname}`)
      onChanged()
      try { await refreshBalance(value.uid); onChanged() }
      catch { setResult(`已导入：${value.nickname}；余额暂未更新，请在账号页检查凭据。`) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!session) return
    const timer = setInterval(() => { void poll(session) }, 3000)
    return () => clearInterval(timer)
  }, [session, busy])
  return <ScrollView navigationTitle={expectedUid ? "重新授权" : "添加账号"}>
    <VStack spacing={14} padding={18}>
      <Picker title="登录站点" pickerStyle="segmented" value={region} disabled={!!session || !!expectedUid} onChanged={(value: string) => setRegion(value as Site)}>
        <Text tag="cn">国内</Text><Text tag="intl">国际</Text><Text tag="workbuddy">旧国际</Text>
      </Picker>
      <HStack><Spacer /><Button title={busy ? "正在请求…" : session ? "继续登录授权" : "登录授权"} systemImage="safari" buttonStyle={glass ? "glassProminent" : primaryButton} controlSize="large" disabled={busy} action={() => void start()} /><Spacer /></HStack>
      {session && <Button title="我已授权，立即检查" systemImage="checkmark.circle" disabled={busy} action={() => void poll(session)} />}
      {session && <Busy text="等待授权，最长 15 分钟" />}
      {!session && <Text foregroundStyle="secondaryLabel">或</Text>}
      {!session && <HStack><Spacer /><Button title="从钥匙串导入" systemImage="key.fill" buttonStyle={glass ? "glass" : "bordered"} tint="systemPurple" controlSize="large" disabled={busy} action={() => void importFromKeychain()} /><Spacer /></HStack>}
      {!!result && <Text>{result}</Text>}{!!error && <Failure error={error} />}
      <Hint>登录授权会在应用内打开 Safari。钥匙串导入每次选择一个账号；其他类型的凭据会跳过。</Hint>
    </VStack>
  </ScrollView>
}
