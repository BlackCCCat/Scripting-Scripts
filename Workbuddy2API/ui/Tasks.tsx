import { Button, DisclosureGroup, HStack, Image, Label, List, Section, Text, VStack, useEffect, useRef, useState } from "scripting"
import { accounts, type Account } from "../local/store"
import { listTasks, refreshBalance, type GrowthTask } from "../local/upstream"
import { canAutoProcessTask, canProcessTask, processTask, runTaskBatch, showInTodayTasks, taskAction, taskUnavailableReason, type TaskRunEntry } from "../local/tasks"
import { Busy, Failure, glass, Hint, primaryButton } from "./Shared"

type Row = GrowthTask & { uid: string; nickname: string; canWrite: boolean; site: Account["site"] }
type RunLine = TaskRunEntry & { nickname: string }
const actionSymbol = (task: GrowthTask) => task.claimable ? "gift" : taskAction(task) === "推进并领奖" ? "bolt.fill" : "checkmark.circle"

function ClaimedTask({ task, title }: { task: GrowthTask; title: string }) {
  const completedToday = task.completedAt && new Date(task.completedAt).toDateString() === new Date().toDateString()
  const time = completedToday ? `完成于 ${new Date(task.completedAt!).toLocaleString("zh-CN")}`
    : task.claimedAt ? `本机领取于 ${new Date(task.claimedAt).toLocaleString("zh-CN")}`
      : task.completedAt ? `完成于 ${new Date(task.completedAt).toLocaleString("zh-CN")}` : "领取时间未知"
  return <DisclosureGroup label={<HStack spacing={8}><Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" />
    <VStack alignment="leading" spacing={2}><Text>{title}</Text><Hint>{time}</Hint></VStack></HStack>}>
    <Hint>{task.task_desc || task.description || task.task_code}</Hint>
  </DisclosureGroup>
}

export function TasksPage({ revision }: { revision: number }) {
  const [rows, setRows] = useState<Row[]>([])
  const [scanNotes, setScanNotes] = useState<Record<string, string>>({})
  const [expandedReadOnly, setExpandedReadOnly] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [runEntries, setRunEntries] = useState<RunLine[]>([])
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
        next.push(...tasks.map(task => ({ ...task, uid: account.uid, nickname: account.nickname, canWrite: account.site === "cn", site: account.site })))
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
    try { setError((await loadRows()).failures.join("\n")) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  async function runAll() {
    if (busy || running.current) return
    running.current = true
    setBusy(true); setActiveSince(Date.now()); setError(""); setRunEntries([]); setHasRun(true)
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
        try {
          await runTaskBatch(account.uid, own, push)
          if (entries.some(entry => entry.uid === account.uid && entry.status === "done")) {
            try { await refreshBalance(account.uid) }
            catch (cause) { push({ uid: account.uid, code: "", title: "余额刷新", status: "failed", message: cause instanceof Error ? cause.message : String(cause) }) }
          }
        } catch (cause) {
          push({ uid: account.uid, code: "", title: "账号任务", status: "failed", message: cause instanceof Error ? cause.message : String(cause) })
        }
      }
      const refreshed = await loadRows()
      setError(refreshed.failures.join("\n"))
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
  const pendingGroups = [
    { name: "国内", rows: pending.filter(row => row.site === "cn") },
    { name: "国际", rows: pending.filter(row => row.site !== "cn") },
  ]
  const accountStates = accounts().map(account => {
    const ownAll = rows.filter(row => row.uid === account.uid)
    const own = ownAll.filter(row => showInTodayTasks(row, day))
    const pendingOwn = own.filter(row => !row.claimed)
    const selectableOwn = pendingOwn.filter(automatic)
    const claimableCount = selectableOwn.filter(row => row.claimable).length
    const waitingCount = pendingOwn.filter(row => row.canWrite && taskAction(row) === "等待进度").length
    const lockedCount = pendingOwn.filter(row => row.locked).length
    const claimedToday = own.filter(row => row.claimed).length
    const claimedBefore = ownAll.filter(row => row.claimed && !showInTodayTasks(row, day)).length
    const parts = [
      `${pendingOwn.length} 项未领取`, `${selectableOwn.length} 项可自动执行`,
      ...(claimableCount ? [`${claimableCount} 项可领奖`] : []),
      ...(waitingCount ? [`${waitingCount} 项待推进`] : []),
      ...(account.site !== "cn" && pendingOwn.length ? [`${pendingOwn.length} 项仅查看`] : []),
      ...(lockedCount ? [`${lockedCount} 项未解锁`] : []),
      ...(claimedToday ? [`${claimedToday} 项今日已领`] : []),
      ...(claimedBefore ? [`${claimedBefore} 项历史已领`] : []),
    ]
    return { account, summary: parts.join(" · "), note: scanNotes[account.uid] }
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
    <Section title="账号任务状态">
      {!accountStates.length && <Hint>还没有账号</Hint>}
      {accountStates.map(({ account, summary, note }) => <VStack key={account.uid} alignment="leading" spacing={3}>
        <Text>{account.nickname}</Text>
        <Hint>{busy && !rows.length ? "正在读取任务…" : summary}</Hint>
        {!!note && <Hint>{note}</Hint>}
      </VStack>)}
    </Section>
    {pendingGroups.map(group => {
      const ready = group.rows.filter(automatic)
      const readOnly = group.rows.filter(row => !automatic(row))
      return group.rows.length > 0 && <Section key={group.name} title={`${group.name}任务`}>
        {ready.map(row => <HStack key={`${row.uid}:${row.task_code}`} spacing={8}>
          <Image systemName={actionSymbol(row)} foregroundStyle="systemPurple" />
          <VStack alignment="leading" spacing={2}><Text>{`${row.nickname} · ${row.title}`}</Text><Hint>{`${taskAction(row)} · ${row.current == null || row.target == null ? "进度未知" : `${row.current}/${row.target}`}`}</Hint></VStack>
        </HStack>)}
        {readOnly.length > 0 && <DisclosureGroup title={`暂不自动执行 · ${readOnly.length} 项`}
          isExpanded={expandedReadOnly.includes(group.name)} onChanged={value => setExpandedReadOnly(current => value ? [...current, group.name] : current.filter(name => name !== group.name))}>
          {readOnly.map(row => <VStack key={`${row.uid}:${row.task_code}`} alignment="leading" spacing={2}>
            <Text>{`${row.nickname} · ${row.title}`}</Text>
            <Hint>{`${taskUnavailableReason(row, row.canWrite)} · ${row.task_code} · ${row.accept_status} · ${row.current == null || row.target == null ? "进度未知" : `${row.current}/${row.target}`}`}</Hint>
          </VStack>)}
        </DisclosureGroup>}
      </Section>
    })}
    {visibleRows.some(row => row.claimed) && <Section title="今日已领取">
      {visibleRows.filter(row => row.claimed).map(row => <ClaimedTask key={`${row.uid}:${row.task_code}`} task={row} title={`${row.nickname} · ${row.title}`} />)}
    </Section>}
  </List>
}

export function AccountTasksPage({ account }: { account: Account }) {
  const [tasks, setTasks] = useState<GrowthTask[]>([])
  const [day, setDay] = useState(new Date().toDateString())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")
  async function refresh() {
    setBusy(true); setError(""); setWarning("")
    try { setTasks(await listTasks(account.uid, setWarning)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  useEffect(() => { const timer = setInterval(() => setDay(new Date().toDateString()), 60_000); return () => clearInterval(timer) }, [])
  useEffect(() => { void refresh() }, [account.uid, day])
  const [result, setResult] = useState("")
  async function action(task: GrowthTask) {
    if (busy) return
    setBusy(true); setError(""); setResult("")
    try {
      setResult((await processTask(account.uid, task)).message)
      if (task.claimable || ["first_buddy", "chat_5", "Model_chat_GLM5.2"].includes(task.task_code)) {
        try { await refreshBalance(account.uid) } catch (cause) { setError(`余额刷新失败：${cause instanceof Error ? cause.message : String(cause)}`) }
      }
      setTasks(await listTasks(account.uid, setWarning))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const visibleTasks = tasks.filter(task => showInTodayTasks(task, day))
  const pendingTasks = visibleTasks.filter(task => !task.claimed)
  const availableTasks = pendingTasks.filter(task => canProcessTask(task, account.site === "cn" && !account.enterpriseId))
  return <List navigationTitle={`${account.nickname}的任务`} toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" disabled={busy} action={() => void refresh()} /> }}>
    {busy && <Busy />}{!!result && <Text>{result}</Text>}{!!error && <Failure error={error} retry={() => void refresh()} />}
    {!!warning && <Hint>{warning}</Hint>}
    {account.site !== "cn" && <Hint>国际区任务当前只支持查询；接受、推进和领奖需在官方客户端操作。</Hint>}
    <Hint>仅显示待处理任务，以及可确认在今天完成或由本机今天领取的任务。</Hint>
    {!busy && <Hint>{`${pendingTasks.length} 项未领取 · ${availableTasks.length} 项可操作 · ${visibleTasks.length - pendingTasks.length} 项今日已领`}</Hint>}
    {!busy && !visibleTasks.length && !error && <Hint>今日暂无任务</Hint>}
    {visibleTasks.map(task => task.claimed ? <ClaimedTask key={task.task_code} task={task} title={task.title} /> : <Section key={task.task_code} title={task.title}>
      <Hint>{task.task_desc || task.description || task.task_code}</Hint>
      <Text>{`${task.accept_status} · ${task.current == null || task.target == null ? "进度未知" : `${task.current}/${task.target}`}`}</Text>
      {canProcessTask(task, account.site === "cn" && !account.enterpriseId) &&
        <Button title={taskAction(task)} systemImage={actionSymbol(task)} buttonStyle={primaryButton} disabled={busy} action={() => void action(task)} />}
      {!canProcessTask(task, account.site === "cn" && !account.enterpriseId) && <Hint>{taskUnavailableReason(task, account.site === "cn" && !account.enterpriseId)}</Hint>}
    </Section>)}
  </List>
}
