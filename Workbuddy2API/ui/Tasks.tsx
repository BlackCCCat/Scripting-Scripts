import { Button, DisclosureGroup, HStack, Image, Label, List, Section, Text, VStack, useEffect, useRef, useState } from "scripting"
import { accounts, type Account } from "../local/store"
import { listTasks, refreshBalance, type GrowthTask } from "../local/upstream"
import { canAutoProcessTask, processTask, runTaskBatch, showInTodayTasks, type TaskRunEntry } from "../local/tasks"
import { Busy, Failure, glass, Hint, primaryButton } from "./Shared"
import { AccountTaskDashboard } from "./TaskDashboard"

type Row = GrowthTask & { uid: string; canWrite: boolean }
type RunLine = TaskRunEntry & { nickname: string }
type CreditChange = { uid: string; nickname: string; before: number; after: number }
const formatCredit = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })

export function TasksPage({ revision }: { revision: number }) {
  const [rows, setRows] = useState<Row[]>([])
  const [extrasRevision, setExtrasRevision] = useState(0)
  const [scanNotes, setScanNotes] = useState<Record<string, string>>({})
  const [expandedAccounts, setExpandedAccounts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [runEntries, setRunEntries] = useState<RunLine[]>([])
  const [creditChanges, setCreditChanges] = useState<CreditChange[]>([])
  const [hasRun, setHasRun] = useState(false)
  const [day, setDay] = useState(new Date().toDateString())
  const [activeSince, setActiveSince] = useState<number | null>(null)
  const running = useRef(false)
  const automatic = (row: Row) => canAutoProcessTask(row, row.canWrite)
  useEffect(() => { const timer = setInterval(() => setDay(new Date().toDateString()), 60_000); return () => clearInterval(timer) }, [])
  useEffect(() => { setRows([]); void scan() }, [revision, day])
  async function loadRows(): Promise<{ rows: Row[]; failures: string[]; notes: Record<string, string> }> {
    const next: Row[] = [], failures: string[] = []
    const notes: Record<string, string> = {}
    for (const account of accounts()) {
      if (account.enterpriseId) { notes[account.uid] = "企业账号没有个人成长任务"; continue }
      try {
        const warnings: string[] = []
        const tasks = await listTasks(account.uid, message => warnings.push(message))
        next.push(...tasks.map(task => ({ ...task, uid: account.uid, canWrite: account.site === "cn" })))
        if (warnings.length) notes[account.uid] = warnings.join("；")
        else if (!tasks.length) notes[account.uid] = "上游未下发成长任务"
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        notes[account.uid] = `任务读取失败：${message}`
        failures.push(`${account.nickname}: ${message}`)
      }
    }
    setRows(next); setScanNotes(notes)
    return { rows: next, failures, notes }
  }
  async function scan() {
    if (busy || running.current) return
    setBusy(true); setError("")
    try { setError((await loadRows()).failures.join("\n")); setExtrasRevision(value => value + 1) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  async function runAll() {
    if (busy || running.current) return
    running.current = true
    setBusy(true); setActiveSince(Date.now()); setError(""); setRunEntries([]); setCreditChanges([]); setHasRun(true)
    const entries: RunLine[] = []
    const push = (entry: TaskRunEntry) => {
      const nickname = accounts().find(item => item.uid === entry.uid)?.nickname ?? entry.uid
      entries.push({ ...entry, nickname })
      setRunEntries([...entries])
    }
    try {
      const snapshot = await loadRows()
      for (const account of accounts()) {
        const own = snapshot.rows.filter(row => row.uid === account.uid)
        if (account.enterpriseId || !own.length) {
          const message = snapshot.notes[account.uid] ?? "上游没有下发成长任务"
          push({ uid: account.uid, code: "", title: "账号任务", status: message.startsWith("任务读取失败") ? "failed" : "skipped", message })
          continue
        }
        const hasActions = account.site === "cn" && own.some(task => canAutoProcessTask(task, true))
        let before: number | undefined
        if (hasActions) {
          try { before = (await refreshBalance(account.uid)).credits }
          catch { /* Task execution can continue when the initial balance is unavailable. */ }
        }
        try { await runTaskBatch(account.uid, own, push) }
        catch (cause) {
          push({ uid: account.uid, code: "", title: "账号任务", status: "failed", message: cause instanceof Error ? cause.message : String(cause) })
        }
        if (hasActions) {
          try {
            const after = (await refreshBalance(account.uid)).credits
            if (before != null && before >= 0 && after != null && after >= 0)
              setCreditChanges(current => [...current, { uid: account.uid, nickname: account.nickname, before, after }])
          } catch (cause) { push({ uid: account.uid, code: "", title: "余额刷新", status: "failed", message: cause instanceof Error ? cause.message : String(cause) }) }
        }
      }
      const refreshed = await loadRows()
      setError(refreshed.failures.join("\n"))
      setExtrasRevision(value => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { running.current = false; setBusy(false); setActiveSince(null) }
  }
  const visibleRows = rows.filter(row => showInTodayTasks(row, day))
  const pending = visibleRows.filter(row => !row.claimed)
  const runnable = pending.filter(automatic).length
  const doneCount = runEntries.filter(entry => entry.status === "done").length
  const pendingCount = runEntries.filter(entry => entry.status === "pending").length
  const failedCount = runEntries.filter(entry => entry.status === "failed").length
  const skipped = runEntries.filter(entry => entry.status === "skipped")
  const accountStates = accounts().map(account => {
    const ownAll = rows.filter(row => row.uid === account.uid)
    const own = ownAll.filter(row => showInTodayTasks(row, day))
    const pendingOwn = own.filter(row => !row.claimed)
    const selectableOwn = pendingOwn.filter(automatic)
    const claimableCount = selectableOwn.filter(row => row.claimable).length
    const parts = [
      `${ownAll.length} 项成长/小程序任务`, `${pendingOwn.length} 项未领取`, `${selectableOwn.length} 项可自动执行`,
      ...(claimableCount ? [`${claimableCount} 项可领奖`] : []),
      ...(account.site !== "cn" && pendingOwn.length ? ["国际区仅查看"] : []),
    ]
    return { account, tasks: ownAll, summary: parts.join(" · "), note: scanNotes[account.uid] }
  })
  return <List navigationTitle="任务" toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" disabled={busy} action={() => void scan()} /> }}
    safeAreaInset={{ bottom: { content: <VStack padding={{ horizontal: 16, vertical: 10 }}>
      <Button buttonStyle={glass ? "glassProminent" : primaryButton} tint="systemPurple" controlSize="large" disabled={busy} action={() => void runAll()}>
        <Label title={activeSince ? "正在执行…" : "一键执行任务"} systemImage="play.fill" frame={{ maxWidth: "infinity" }} />
      </Button>
    </VStack> } }}>
    <Section title="一键任务">
      <Hint>点击底部按钮会重新扫描所有账号，自动推进当前支持的任务并领取已达标奖励；无法执行的任务会跳过。</Hint>
      <Hint>首只 Buddy 会同意领养协议；GLM-5.2 对话可能消耗账号额度。</Hint>
      <Hint>{`${pending.length} 项未领取 · ${runnable} 项可自动执行`}</Hint>
      {!busy && !pending.length && <Hint>当前没有待处理的成长任务。</Hint>}
      {activeSince !== null && <Hint>{`开始于 ${new Date(activeSince).toLocaleTimeString("zh-CN")}`}</Hint>}
      {busy && <Busy text={activeSince ? "正在执行任务…" : "正在读取任务…"} />}
      {!!error && <Failure error={error} />}
    </Section>
    {hasRun && <Section title="本轮结果">
      <Hint>{`${doneCount} 项已处理 · ${pendingCount} 项待上游确认 · ${failedCount} 项失败 · ${skipped.length} 项跳过`}</Hint>
      {creditChanges.map(item => <Hint key={item.uid}>{`${item.nickname} · 积分 ${formatCredit(item.before)} → ${formatCredit(item.after)}（执行期间净变化 ${item.after > item.before ? "+" : ""}${formatCredit(item.after - item.before)}）`}</Hint>)}
      {!busy && !runEntries.length && !error && <Hint>本轮没有待执行的任务。</Hint>}
      {runEntries.filter(entry => entry.status !== "skipped").map((entry, index) => <HStack key={`${entry.uid}:${entry.code}:${index}`} spacing={8}>
        <Image systemName={entry.status === "done" ? "checkmark.circle.fill" : entry.status === "failed" ? "xmark.circle.fill" : "clock.fill"}
          foregroundStyle={entry.status === "done" ? "systemGreen" : entry.status === "failed" ? "systemRed" : "systemOrange"} />
        <VStack alignment="leading" spacing={2}><Text>{`${entry.nickname} · ${entry.title}`}</Text><Hint>{entry.message}</Hint></VStack>
      </HStack>)}
      {!!skipped.length && <DisclosureGroup title={`已跳过 · ${skipped.length} 项`}>
        {skipped.map((entry, index) => <VStack key={`${entry.uid}:${entry.code}:${index}`} alignment="leading" spacing={2}>
          <Text>{`${entry.nickname} · ${entry.title}`}</Text><Hint>{`${entry.code ? `${entry.code} · ` : ""}${entry.message}`}</Hint>
        </VStack>)}
      </DisclosureGroup>}
    </Section>}
    <Section title="各账号任务明细">
      {!accountStates.length && <Hint>还没有账号</Hint>}
      {accountStates.map(({ account, tasks, summary, note }) => <DisclosureGroup key={account.uid}
        label={<VStack alignment="leading" spacing={3}><Text fontWeight="semibold">{account.nickname}</Text>
          <Hint>{busy && !rows.length ? "正在读取任务…" : summary}</Hint></VStack>}
        isExpanded={expandedAccounts.includes(account.uid)}
        onChanged={value => setExpandedAccounts(current => value ? [...current, account.uid] : current.filter(uid => uid !== account.uid))}>
        {!!note && <Hint>{note}</Hint>}
        <AccountTaskDashboard uid={account.uid} tasks={tasks}
          canWrite={account.site === "cn" && !account.enterpriseId} busy={busy} refreshKey={extrasRevision}
          active={expandedAccounts.includes(account.uid)} />
      </DisclosureGroup>)}
    </Section>
  </List>
}

export function AccountTasksPage({ account }: { account: Account }) {
  const [tasks, setTasks] = useState<GrowthTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [extrasRevision, setExtrasRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")
  async function refresh() {
    setBusy(true); setError(""); setWarning("")
    try { setTasks(await listTasks(account.uid, setWarning)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoaded(true); setExtrasRevision(value => value + 1); setBusy(false) }
  }
  useEffect(() => { void refresh() }, [account.uid])
  const [result, setResult] = useState("")
  async function action(task: GrowthTask) {
    if (busy) return
    setBusy(true); setError(""); setResult("")
    try {
      setResult((await processTask(account.uid, task)).message)
      if (canAutoProcessTask(task, account.site === "cn" && !account.enterpriseId)) {
        try { await refreshBalance(account.uid) } catch (cause) { setError(`余额刷新失败：${cause instanceof Error ? cause.message : String(cause)}`) }
      }
      setTasks(await listTasks(account.uid, setWarning))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const pendingTasks = tasks.filter(task => !task.claimed)
  const availableTasks = pendingTasks.filter(task => canAutoProcessTask(task, account.site === "cn" && !account.enterpriseId))
  return <List navigationTitle={`${account.nickname}的任务`} toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" disabled={busy} action={() => void refresh()} /> }}>
    {busy && <Busy />}{!!result && <Text>{result}</Text>}{!!error && <Failure error={error} retry={() => void refresh()} />}
    {!!warning && <Hint>{warning}</Hint>}
    {account.site !== "cn" && <Hint>国际区任务当前只支持查询；接受、推进和领奖需在官方客户端操作。</Hint>}
    {loaded && <Section title="任务明细">
      <Hint>{`${tasks.length} 项成长/小程序任务 · ${pendingTasks.length} 项未领取 · ${availableTasks.length} 项可自动执行`}</Hint>
      <Hint>完整清单按来源折叠展示；已领取任务也可展开查看。活动任务和连登日历按账号单独读取。</Hint>
      <AccountTaskDashboard uid={account.uid} tasks={tasks} canWrite={account.site === "cn" && !account.enterpriseId}
        busy={busy} onAction={task => void action(task)} refreshKey={extrasRevision} />
    </Section>}
  </List>
}
