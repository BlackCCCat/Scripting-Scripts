import { Button, HStack, Image, Label, List, Menu, Navigation, NavigationLink, Picker, ProgressView, ScrollView, Section, Spacer, Text, VStack, useEffect, useRef, useState } from "scripting"
import { accounts, checkinStatusNeedsRefresh, removeAccount, restoreSyncedAccounts, saveCredential, todayInChina, updateAccount, type Account, type Site } from "../local/store"
import { beginLogin, checkin, parseKeychainWorkBuddy, pollLogin, refreshBalance, refreshCheckinStatus, type LoginSession } from "../local/upstream"
import { alertError, barFill, Busy, Failure, glass, hideTopSeparator, Hint, PageBackdrop, pageMargins, primaryButton, StatusDot, SymbolTile } from "./Shared"
import { AccountTasksPage } from "./Tasks"

const credits = (value?: number) => value == null ? "—" : value < 0 ? "不限量" : value.toLocaleString("zh-CN")
function CreditBalance({ account }: { account: Account }) {
  const { credits: remaining, total } = account
  if (remaining == null || remaining < 0 || total == null || total <= 0) {
    return <HStack spacing={6}>
      <Hint>{remaining == null ? "余额未读取" : remaining >= 0 && total == null ? "剩余积分 · 总额未知" : "剩余积分"}</Hint><Spacer />
      <Text font="subheadline" monospacedDigit>{credits(remaining)}</Text>
    </HStack>
  }
  return <VStack alignment="leading" spacing={5}>
    <HStack spacing={6}>
      <Hint>剩余／总积分</Hint><Spacer />
      <Text font="subheadline" fontWeight="semibold" monospacedDigit>{`${credits(remaining)} / ${credits(total)}`}</Text>
    </HStack>
    <ProgressView value={Math.min(remaining, total) / total} total={1} progressViewStyle="linear" tint={barFill}
      accessibilityLabel="剩余积分比例" />
    <Hint>{`已用 ${credits(Math.max(0, total - remaining))}`}</Hint>
  </VStack>
}

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
  const availableCount = items.filter(item => item.enabled !== false && !item.error).length
  const lastUpdated = Math.max(0, ...items.map(item => item.updatedAt ?? 0))
  async function refreshAll() {
    if (busy) return
    setBusy(true)
    let failures = 0
    try { restoreSyncedAccounts() } catch (error) { console.warn("iCloud 账号恢复失败", error) }
    for (const item of accounts()) { try { await refreshBalance(item.uid) } catch { failures++ } }
    refresh(); setBusy(false)
    if (failures) await Dialog.alert({ message: `${failures} 个账号余额刷新失败，请查看账号详情。` })
  }
  function toggleAccount(item: Account) {
    try { updateAccount(item.uid, { enabled: item.enabled === false }); refresh() }
    catch (error) { void alertError(error) }
  }
  return <List navigationTitle="账号" navigationBarTitleDisplayMode="large" background={<PageBackdrop />}
    listStyle="insetGroup" scrollContentBackground="hidden" contentMargins={pageMargins}
    searchable={{ value: search, onChanged: setSearch, prompt: "搜索昵称或 UID", placement: "navigationBarDrawerAlwaysDisplay" }}
    safeAreaInset={{ bottom: { spacing: 0, content: <HStack padding={{ horizontal: 18, top: 4, bottom: 12 }}>
      <Spacer />
      <NavigationLink destination={<LoginPage onChanged={refresh} />} buttonStyle={glass ? "glassProminent" : primaryButton}
        tint={barFill} controlSize="large">
        <Label title="添加账号" systemImage="plus" />
      </NavigationLink>
      <Spacer />
    </HStack> } }}
    toolbar={{
      topBarTrailing: [
        <Menu title="排序方式" systemImage="arrow.up.arrow.down">
          <Button title="添加顺序" systemImage={sort === "added" ? "checkmark" : "list.number"} action={() => setSort("added")} />
          <Button title="积分从高到低" systemImage={sort === "credits" ? "checkmark" : "arrow.down"} action={() => setSort("credits")} />
          <Button title="按昵称" systemImage={sort === "nickname" ? "checkmark" : "textformat.abc"} action={() => setSort("nickname")} />
        </Menu>,
        <Button title="筛选可用" systemImage={availableOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"} action={() => setAvailableOnly(value => !value)} />,
        <Button title="刷新" systemImage="arrow.clockwise" disabled={busy} action={() => void refreshAll()} />,
      ],
    }}>
    <Section listSectionSeparator="hidden"
      header={<Hint>{`${items.length} 个账号 · ${availableCount} 个可用${visible.length !== items.length ? ` · 显示 ${visible.length} 个` : ""}${availableOnly ? " · 仅可用" : ""}`}</Hint>}
      footer={lastUpdated > 0 ? <Hint>{`更新于 ${new Date(lastUpdated).toLocaleString("zh-CN")}`}</Hint> : undefined}>
      {visible.map((item, index) => <NavigationLink key={item.uid} destination={<AccountPage account={item} onChanged={refresh} />}
        listRowSeparator={visible.length === 1 ? "hidden" : index === 0 ? hideTopSeparator
          : index === visible.length - 1 ? { visibility: "hidden", edges: "bottom" } : "visible"}
        listRowInsets={{ top: 12, bottom: 12, leading: 14, trailing: 12 }}
        trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title={item.enabled === false ? "启用" : "停用"}
          systemImage={item.enabled === false ? "checkmark.circle" : "pause.circle"}
          tint={item.enabled === false ? "systemGreen" : "systemOrange"} action={() => toggleAccount(item)} />] }}>
        <VStack alignment="leading" spacing={9} opacity={item.enabled === false ? 0.65 : 1}
          frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <HStack spacing={10}>
            <SymbolTile symbol={item.enterpriseId ? "building.2" : item.site === "cn" ? "person.crop.circle" : "globe"} />
            <VStack alignment="leading" spacing={3}>
              <Text font="headline" lineLimit={2}>{item.nickname || item.uid.slice(0, 8)}</Text>
              <HStack spacing={5}>
                <StatusDot color={item.enabled === false ? "systemGray" : item.error ? "systemOrange" : "systemGreen"} />
                <Hint>{`${item.site === "cn" ? "国内版" : "国际版"} · ${item.enabled === false ? "已停用" : item.error ? "需检查" : "可用"}`}</Hint>
              </HStack>
            </VStack>
          </HStack>
          <CreditBalance account={item} />
        </VStack>
      </NavigationLink>)}
      {!visible.length && <Hint>{items.length ? "没有匹配的账号" : "尚未添加账号，点击底部添加。"}</Hint>}
    </Section>
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
      <NavigationLink destination={<AccountTasksPage account={current} />}><HStack><Image systemName="checklist" /><Text>账号任务</Text></HStack></NavigationLink>
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
  const picking = useRef(false)
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
    if (busy || picking.current) return
    picking.current = true
    setBusy(true); setResult(""); setError("")
    try {
      const options = { title: "选择 WorkBuddy 凭据", prompt: "请选择一条 WorkBuddy 登录凭据。" }
      let raw: string | null
      try { raw = await Keychain.pick(options) }
      catch (cause) {
        if (!String(cause).includes("picker host")) throw cause
        await new Promise<void>(resolve => setTimeout(resolve, 500))
        raw = await Keychain.pick(options)
      }
      if (raw === null) return
      await new Promise<void>(resolve => setTimeout(resolve, 350))
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
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message.includes("picker host") ? "钥匙串选择窗口未恢复，请返回脚本列表重新运行后再试。" : message)
    } finally {
      await new Promise<void>(resolve => setTimeout(resolve, 400))
      picking.current = false
      setBusy(false)
    }
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
