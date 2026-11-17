import { Button, DisclosureGroup, Grid, GridRow, HStack, Image, Link, RoundedRectangle, Text, VStack, useEffect, useState } from "scripting"
import { canProcessTask, taskAction, taskUnavailableReason } from "../local/tasks"
import { fetchCampaignActivities, fetchStreakStatus, type CampaignActivity, type CampaignTask, type GrowthTask, type StreakStatus } from "../local/upstream"
import { alertError, Busy, Hint } from "./Shared"

const text = (error: unknown) => error instanceof Error ? error.message : String(error)
const formatTime = (value: string | number) => new Date(value).toLocaleString("zh-CN")
const growthStatus = (value: string) => ({ not_accepted: "未接取", accepted: "已接取", completed: "已完成", claimed: "已领取" })[value] ?? value
const tierStatus = (value: string) => ({ available: "可兑换", locked: "未解锁", claimed: "已兑换" })[value] ?? value

function CopyPath({ value, title }: { value: string; title: string }) {
  return <Button title={title} systemImage="doc.on.doc" buttonStyle="borderless" action={() => {
    void Pasteboard.setString(value).then(() => Dialog.alert({ message: "已复制到剪贴板" })).catch(alertError)
  }} />
}

function TaskDestination({ url }: { url?: string }) {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return <Link url={url}><HStack spacing={5}><Image systemName="arrow.up.right.square" /><Text>打开任务链接</Text></HStack></Link>
  if (/^(workbuddy|weixin):\/\//i.test(url)) return <CopyPath value={url} title="复制任务深链" />
  return <Hint>上游任务链接格式不可用</Hint>
}

function GrowthRow({ task, canWrite, busy, onAction }: {
  task: GrowthTask; canWrite: boolean; busy?: boolean; onAction?: (task: GrowthTask) => void
}) {
  const time = task.completedAt ? `完成于 ${formatTime(task.completedAt)}` : task.claimedAt ? `本机领取于 ${formatTime(task.claimedAt)}` : ""
  const status = task.claimed ? "已领取" : task.locked ? "未解锁" : task.claimable ? "可领奖" : growthStatus(task.accept_status)
  const progress = task.current == null || task.target == null ? "进度未知" : `${task.current}/${task.target}`
  return <DisclosureGroup title={task.title} listRowSeparator="visible">
    <VStack alignment="leading" spacing={6} padding={{ vertical: 4 }}>
      <Hint>{`${status} · ${progress}`}</Hint>
      <Hint>{`任务代码：${task.task_code}`}</Hint>
      {(task.rewardCredit != null || task.rewardEnergy != null) && <Hint>{`奖励${task.rewardCredit != null ? ` ${task.rewardCredit} 积分` : ""}${task.rewardEnergy != null ? ` ${task.rewardEnergy} 能量` : ""}`}</Hint>}
      {!!time && <Hint>{time}</Hint>}
      {!!(task.task_desc || task.description) && <Hint>{task.task_desc || task.description}</Hint>}
      <TaskDestination url={task.jump_url} />
      {onAction && canProcessTask(task, canWrite) && <Button title={taskAction(task)} systemImage={task.claimable ? "gift" : "bolt.fill"}
        buttonStyle="borderless" disabled={busy} action={() => onAction(task)} />}
      {!task.claimed && !canProcessTask(task, canWrite) && <Hint>{taskUnavailableReason(task, canWrite)}</Hint>}
    </VStack>
  </DisclosureGroup>
}

function CampaignRow({ task }: { task: CampaignTask }) {
  const done = !!task.claimedAt
  const claimable = !done && (!!task.completedAt || task.current >= task.target)
  const status = done ? "已领取" : claimable ? "可领取" : "未完成"
  return <DisclosureGroup title={task.title} listRowSeparator="visible">
    <VStack alignment="leading" spacing={6} padding={{ vertical: 4 }}>
      <Hint>{`${status} · ${task.current}/${task.target} · ${task.credit} 积分`}</Hint>
      <Hint>{`任务代码：${task.code}`}</Hint>
      {task.kind === "app" && <Hint>需在手机端完成</Hint>}
      {!!task.claimedAt && <Hint>{`领取于 ${formatTime(task.claimedAt)}`}</Hint>}
      {!!task.completedAt && !task.claimedAt && <Hint>{`完成于 ${formatTime(task.completedAt)}`}</Hint>}
      {!!task.jumpUrl && <TaskDestination url={task.jumpUrl} />}
    </VStack>
  </DisclosureGroup>
}

function StreakCalendar({ status }: { status: StreakStatus }) {
  const byDate = new Map(status.heatmap.map(cell => [cell.date, cell]))
  const end = status.heatmap.length ? (/^\d{4}-\d{2}-\d{2}$/.test(status.today ?? "") ? status.today : status.heatmap.at(-1)?.date) : undefined
  const endTime = end ? Date.parse(`${end}T00:00:00Z`) : NaN
  const cells = Number.isFinite(endTime) ? Array.from({ length: 28 }, (_, index) => {
    const date = new Date(endTime - (27 - index) * 86_400_000).toISOString().slice(0, 10)
    return byDate.get(date) ?? { date, score: null }
  }) : []
  const first = cells[0]?.date
  const lead = first ? (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 : 0
  const padded = [...Array.from({ length: lead }, () => null), ...cells]
  const rows = Array.from({ length: Math.ceil(padded.length / 7) }, (_, index) => padded.slice(index * 7, index * 7 + 7))
  const hits = cells.filter(cell => cell.score != null && cell.score > 0).length
  return <VStack alignment="leading" spacing={10}>
    <Hint>{cells.length ? `近 28 天 · ${hits} 天有记录 · 缺失日期显示未知` : "上游没有返回日历数据"}</Hint>
    {!!cells.length && <Grid horizontalSpacing={7} verticalSpacing={7}>
      <GridRow>{["一", "二", "三", "四", "五", "六", "日"].map(day => <Text key={day} font="caption2" foregroundStyle="secondaryLabel" frame={{ width: 32 }}>{day}</Text>)}</GridRow>
      {rows.map((row, index) => <GridRow key={index}>{Array.from({ length: 7 }, (_, column) => {
        const cell = row[column]
        if (!cell) return <Text key={column} frame={{ width: 32, height: 30 }}> </Text>
        const opacity = cell.score == null || cell.score <= 0 ? 1 : cell.score <= 2 ? 0.3 : cell.score <= 5 ? 0.55 : 0.8
        const fill = cell.score == null ? "systemGray6" : cell.score <= 0 ? "systemGray5" : "systemGreen"
        return <VStack key={cell.date} spacing={2} frame={{ width: 32, height: 30 }}>
          <Text font="caption2" monospacedDigit accessibilityLabel={`${cell.date}，${cell.score == null ? "状态未知" : `${cell.score} 分`}`}>{cell.date.slice(-2)}</Text>
          <RoundedRectangle cornerRadius={3} fill={fill} opacity={opacity} frame={{ width: 26, height: 8 }} />
        </VStack>
      })}</GridRow>)}
    </Grid>}
    {!!status.today && <Hint>{`上游日期 ${status.today}${status.todayActive == null ? "" : status.todayActive ? " · 今日有记录" : " · 今日暂无记录"}`}</Hint>}
  </VStack>
}

export function AccountTaskDashboard({ uid, tasks, canWrite, busy, onAction, refreshKey, active = true }: {
  uid: string; tasks: GrowthTask[]; canWrite: boolean; busy?: boolean; onAction?: (task: GrowthTask) => void; refreshKey: number; active?: boolean
}) {
  const [campaigns, setCampaigns] = useState<CampaignActivity[] | null>(null)
  const [streak, setStreak] = useState<StreakStatus | null>(null)
  const [campaignError, setCampaignError] = useState("")
  const [streakError, setStreakError] = useState("")
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!canWrite || !active) return
    let alive = true
    setLoading(true); setCampaignError(""); setStreakError(""); setCampaigns(null); setStreak(null)
    void (async () => {
      try { const next = await fetchStreakStatus(uid); if (alive) setStreak(next) }
      catch (error) { if (alive) setStreakError(text(error)) }
      try { const next = await fetchCampaignActivities(uid); if (alive) setCampaigns(next) }
      catch (error) { if (alive) setCampaignError(text(error)) }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [uid, canWrite, active, refreshKey])
  const groups = [
    { key: "growth", title: "成长任务", rows: tasks.filter(task => !task.miniprogram) },
    { key: "mini", title: "小程序链式任务", rows: tasks.filter(task => task.miniprogram) },
  ]
  return <>
    {groups.map(group => <DisclosureGroup key={group.key} title={`${group.title} · ${group.rows.length} 项`} listRowSeparator="visible">
      {!group.rows.length && <Hint>上游未下发此类任务</Hint>}
      {group.rows.filter(task => !task.claimed).map(task => <GrowthRow key={task.task_code} task={task} canWrite={canWrite} busy={busy} onAction={onAction} />)}
      {group.rows.some(task => task.claimed) && <DisclosureGroup title={`已领取 · ${group.rows.filter(task => task.claimed).length} 项`}>
        {group.rows.filter(task => task.claimed).map(task => <GrowthRow key={task.task_code} task={task} canWrite={canWrite} />)}
      </DisclosureGroup>}
    </DisclosureGroup>)}
    {canWrite && <DisclosureGroup title={`活动任务${campaigns ? ` · ${campaigns.reduce((sum, item) => sum + item.tasks.length, 0)} 项` : ""}`} listRowSeparator="visible">
      {loading && <Busy text="正在读取活动任务…" />}
      {!!campaignError && <Hint>{`活动任务读取失败：${campaignError}`}</Hint>}
      {campaigns?.map(activity => <DisclosureGroup key={activity.code} title={`${activity.title} · ${activity.tasks.length} 项`} listRowSeparator="visible">
        {!!activity.error && <Hint>{`读取失败：${activity.error}`}</Hint>}
        {!activity.error && !activity.tasks.length && <Hint>上游当前未下发活动任务</Hint>}
        {activity.tasks.filter(task => !task.claimedAt).map(task => <CampaignRow key={task.code} task={task} />)}
        {activity.tasks.some(task => task.claimedAt) && <DisclosureGroup title={`已领取 · ${activity.tasks.filter(task => task.claimedAt).length} 项`}>
          {activity.tasks.filter(task => task.claimedAt).map(task => <CampaignRow key={task.code} task={task} />)}
        </DisclosureGroup>}
        <Hint>上游未提供活动页网页链接，可复制小程序内部路径。</Hint>
        <CopyPath value={activity.pagePath} title="复制小程序页面路径" />
      </DisclosureGroup>)}
    </DisclosureGroup>}
    {canWrite && <DisclosureGroup title="连登日历" listRowSeparator="visible">
      {loading && <Busy text="正在读取连登状态…" />}
      {!!streakError && <Hint>{`连登状态读取失败：${streakError}`}</Hint>}
      {streak && <VStack alignment="leading" spacing={8}>
        <Hint>{`连登 ${streak.days == null ? "未读取" : `${streak.days} 天`} · 补签卡 ${streak.makeupCards == null ? "未读取" : streak.makeupCards} · 抽奖 ${streak.lotteryChances == null ? "未读取" : streak.lotteryChances} 次`}</Hint>
        {!!streak.nextTier && streak.nextTierRemaining != null && <Hint>{`距 ${streak.nextTier} 档还差 ${streak.nextTierRemaining} 天`}</Hint>}
        {streak.tiers?.map(tier => <Hint key={tier.name}>{`${tier.name} 档 · ${tierStatus(tier.status)}${tier.credit ? ` · ${tier.credit} 积分` : ""}${tier.energy ? ` · ${tier.energy} 能量` : ""}`}</Hint>)}
        <StreakCalendar status={streak} />
        {!!streak.error && <Hint>{`部分状态读取失败：${streak.error}`}</Hint>}
      </VStack>}
    </DisclosureGroup>}
  </>
}
