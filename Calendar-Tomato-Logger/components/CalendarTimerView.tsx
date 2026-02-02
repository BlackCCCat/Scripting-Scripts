import {
  Button,
  EditButton,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  useEffect,
  useMemo,
  useRef,
  useState,
  LiveActivity,
  Markdown,
  Notification,
  Script,
  ForEach,
} from "scripting"

import { COUNTDOWN_OPTIONS, COUNT_UP_WINDOW_MS, NOTIFICATION_INTERVAL_OPTIONS } from "../constants"
import { registerTimerActivity } from "../live_activity_ui"
import type { Task, TimerActivityState } from "../types"
import { loadTasks, saveTasks } from "../utils/storage"
import { loadSettings, saveSettings } from "../utils/settings"
import { formatDateTime, formatDuration } from "../utils/time"
import { TaskEditView } from "./TaskEditView"

const createTimerActivity = registerTimerActivity()

export function CalendarTimerView() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [activeCalendar, setActiveCalendar] = useState<Calendar | null>(null)
  const [sessionStartAt, setSessionStartAt] = useState<Date | null>(null)
  const [segmentStartAt, setSegmentStartAt] = useState<Date | null>(null)
  const [accumulatedMs, setAccumulatedMs] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [saving, setSaving] = useState(false)
  const [noteDraft, setNoteDraft] = useState("")
  const [showMarkdown, setShowMarkdown] = useState(true)
  const timerIdRef = useRef<number | null>(null)
  const settingsLoadedRef = useRef(false)
  const activityRef = useRef<LiveActivity<TimerActivityState> | null>(null)
  const stoppingRef = useRef(false)
  const noteSaveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void refreshTasks()
    void loadAppSettings()
  }, [])

  const activeTask = useMemo(() => {
    if (!activeTaskId) return null
    return tasks.find((t) => t.id === activeTaskId) ?? null
  }, [tasks, activeTaskId])

  const isCountdown = !!(activeTask?.useCountdown && (activeTask.countdownSeconds ?? 0) > 0)
  const countdownTotalMs = isCountdown ? (activeTask?.countdownSeconds ?? 0) * 1000 : 0
  const displayMs = isCountdown ? Math.max(0, countdownTotalMs - elapsedMs) : elapsedMs
  const timerText = useMemo(() => formatDuration(displayMs), [displayMs])

  useEffect(() => {
    if (!activeTask) {
      setNoteDraft("")
      return
    }
    setNoteDraft(activeTask.noteDraft ?? "")
  }, [activeTaskId, tasks])

  useEffect(() => {
    if (!activeTask) return
    if (noteDraft === (activeTask.noteDraft ?? "")) return
    if (noteSaveTimerRef.current != null) clearTimeout(noteSaveTimerRef.current)
    noteSaveTimerRef.current = setTimeout(() => {
      setTasks((prev) => {
        const next = prev.map((t) => (t.id === activeTask.id ? { ...t, noteDraft } : t))
        void saveTasks(next)
        return next
      })
    }, 300)
    return () => {
      if (noteSaveTimerRef.current != null) clearTimeout(noteSaveTimerRef.current)
    }
  }, [noteDraft, activeTask])

  useEffect(() => {
    if (!settingsLoadedRef.current) return
    void saveSettings({ showMarkdown })
  }, [showMarkdown])

  useEffect(() => {
    const syncBackground = async () => {
      try {
        if (running) {
          await BackgroundKeeper.keepAlive()
        } else {
          await BackgroundKeeper.stopKeepAlive()
        }
      } catch {
        // ignore keep-alive errors
      }
    }
    void syncBackground()
  }, [running])

  useEffect(() => {
    if (!running || !segmentStartAt) {
      clearTimer()
      return
    }

    let cancelled = false

    const tick = () => {
      if (cancelled || !segmentStartAt) return
      const ms = accumulatedMs + (Date.now() - segmentStartAt.getTime())
      setElapsedMs(ms)
      if (isCountdown && countdownTotalMs > 0 && ms >= countdownTotalMs) {
        void stopTimer({ auto: true })
        return
      }
      const nowMs = Date.now()
      const remainder = nowMs % 1000
      const delay = remainder === 0 ? 1000 : 1000 - remainder
      timerIdRef.current = setTimeout(tick, delay)
    }

    tick()

    return () => {
      cancelled = true
      clearTimer()
    }
  }, [running, segmentStartAt, accumulatedMs, isCountdown, countdownTotalMs, activeTaskId])

  function clearTimer() {
    if (timerIdRef.current != null) {
      clearTimeout(timerIdRef.current)
      timerIdRef.current = null
    }
  }

  async function refreshTasks() {
    try {
      const list = await loadTasks()
      setTasks(list)
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function loadAppSettings() {
    try {
      const settings = await loadSettings()
      settingsLoadedRef.current = true
      setShowMarkdown(settings.showMarkdown)
    } catch {
      settingsLoadedRef.current = true
    }
  }

  async function persistTasks(next: Task[]) {
    setTasks(next)
    try {
      await saveTasks(next)
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
      await refreshTasks()
    }
  }

  async function addTask() {
    const task = await Navigation.present<Task>({
      element: <TaskEditView title="添加任务" />,
    })
    if (!task) return

    if (tasks.some((t) => t.name === task.name)) {
      await Dialog.alert({ message: "任务名称已存在" })
      return
    }

    await persistTasks([...tasks, task])
  }

  async function editTask(task: Task) {
    if ((running || paused) && activeTaskId === task.id) {
      await Dialog.alert({ message: "请先结束当前任务再编辑" })
      return
    }
    const updated = await Navigation.present<Task>({
      element: <TaskEditView title="编辑任务" initial={task} />,
    })
    if (!updated) return
    if (tasks.some((t) => t.id !== task.id && t.name === updated.name)) {
      await Dialog.alert({ message: "任务名称已存在" })
      return
    }
    const next = tasks.map((t) => (t.id === task.id ? updated : t))
    await persistTasks(next)
  }

  async function removeTask(task: Task) {
    if ((running || paused) && activeTaskId === task.id) {
      await Dialog.alert({ message: "请先结束当前任务" })
      return
    }
    const ok = await Dialog.confirm({ message: `删除任务“${task.name}”？` })
    if (!ok) return
    const next = tasks.filter((t) => t.id !== task.id)
    await persistTasks(next)
    if (activeTaskId === task.id) setActiveTaskId(null)
  }

  async function resolveCalendar(task: Task): Promise<Calendar | null> {
    try {
      const list = await Calendar.forEvents()
      const found = list.find((c) => c.identifier === task.calendarId) ?? null
      if (!found) {
        await Dialog.alert({ message: `找不到日历：${task.calendarTitle}，请重新选择。` })
        return null
      }
      if (!found.isForEvents) {
        await Dialog.alert({ message: "所选日历不支持事件" })
        return null
      }
      if (!found.allowsContentModifications) {
        await Dialog.alert({ message: "所选日历不可写" })
        return null
      }
      return found
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
      return null
    }
  }

  async function clearNotifications() {
    try {
      await Notification.removeAllPendingsOfCurrentScript()
    } catch {
      // ignore
    }
  }

  async function scheduleNotifications(task: Task) {
    try {
      if (!task.useNotification) return
      const minutes = task.notificationIntervalMinutes ?? 0
      if (minutes <= 0) return
      const Trigger = (globalThis as any).TimeIntervalNotificationTrigger
      if (!Trigger) {
        await Dialog.alert({ message: "当前系统不支持通知触发器。" })
        return
      }
      const trigger = new Trigger({
        timeInterval: minutes * 60,
        repeats: true,
      })
      await clearNotifications()
      const scheduled = await Notification.schedule({
        title: task.name,
        body: "计时提醒",
        threadIdentifier: "calendar-loger",
        interruptionLevel: "active",
        trigger,
      })
      if (!scheduled) {
        await Dialog.alert({ message: "通知未能安排，请检查系统通知权限。" })
        return
      }
      const pendings = await Notification.getAllPendingsOfCurrentScript()
      if (!pendings || pendings.length === 0) {
        await Dialog.alert({ message: "通知未生效，请在系统设置中允许该应用通知。" })
      }
    } catch {
      // ignore notification errors to avoid blocking Live Activity
    }
  }

  function buildActivityState(task: Task, now: Date, elapsed: number, pausedAt?: Date): TimerActivityState {
    const countdownSeconds = task.countdownSeconds ?? 0
    if (task.useCountdown && countdownSeconds > 0) {
      const remaining = Math.max(0, countdownSeconds * 1000 - elapsed)
      return {
        title: task.name,
        calendarTitle: task.calendarTitle,
        from: now.getTime(),
        to: now.getTime() + remaining,
        countsDown: true,
        pauseTime: pausedAt ? pausedAt.getTime() : undefined,
      }
    }
    const from = now.getTime() - elapsed
    return {
      title: task.name,
      calendarTitle: task.calendarTitle,
      from,
      to: from + COUNT_UP_WINDOW_MS,
      countsDown: false,
      pauseTime: pausedAt ? pausedAt.getTime() : undefined,
    }
  }

  async function ensureLiveActivity(createNew = false): Promise<LiveActivity<TimerActivityState> | null> {
    try {
      const enabled = await LiveActivity.areActivitiesEnabled()
      if (!enabled) return null
    } catch {
      return null
    }
    if (createNew || !activityRef.current) {
      activityRef.current = createTimerActivity()
    }
    return activityRef.current
  }

  async function startLiveActivity(task: Task, now: Date, elapsed: number) {
    const activity = await ensureLiveActivity(true)
    if (!activity) return
    await activity.start(buildActivityState(task, now, elapsed), {
      relevanceScore: 1,
      staleDate: new Date(now.getTime() + 1000 * 60 * 60 * 6),
    })
  }

  async function updateLiveActivity(task: Task, now: Date, elapsed: number, pausedAt?: Date) {
    const activity = await ensureLiveActivity()
    if (!activity || !activity.started) return
    await activity.update(buildActivityState(task, now, elapsed, pausedAt))
  }

  async function endLiveActivity(task: Task, now: Date, elapsed: number) {
    const activity = activityRef.current
    if (!activity || !activity.started) return
    await activity.end(buildActivityState(task, now, elapsed), {
      dismissTimeInterval: 0,
    })
    activityRef.current = null
  }

  async function startTask(task: Task) {
    if (running && activeTaskId === task.id) return

    if ((running || paused) && activeTaskId && activeTaskId !== task.id) {
      const ok = await Dialog.confirm({
        message: `当前任务“${activeTask?.name ?? ""}”未结束，是否结束并切换任务？`,
      })
      if (!ok) return
      await stopTimer()
    }

    if (!running && paused && activeTaskId === task.id && sessionStartAt) {
      const resumeAt = new Date()
      setSegmentStartAt(resumeAt)
      setRunning(true)
      setPaused(false)
      await updateLiveActivity(task, resumeAt, accumulatedMs)
      return
    }

    const calendar = await resolveCalendar(task)
    if (!calendar) return
    if (task.useCountdown && (task.countdownSeconds ?? 0) <= 0) {
      await Dialog.alert({ message: "倒计时时长无效" })
      return
    }

    const start = new Date()
    setActiveTaskId(task.id)
    setActiveCalendar(calendar)
    setSessionStartAt(start)
    setSegmentStartAt(start)
    setAccumulatedMs(0)
    setElapsedMs(0)
    setRunning(true)
    setPaused(false)

    await scheduleNotifications(task)
    await startLiveActivity(task, start, 0)
  }

  async function pauseTimer() {
    if (!running || !segmentStartAt) return
    const now = new Date()
    const total = accumulatedMs + (now.getTime() - segmentStartAt.getTime())
    setAccumulatedMs(total)
    setElapsedMs(total)
    setSegmentStartAt(null)
    setRunning(false)
    setPaused(true)
    await clearNotifications()
    if (activeTask) {
      await updateLiveActivity(activeTask, now, total, now)
    }
  }

  async function cancelTimer() {
    if (!activeTask || (!running && !paused && !sessionStartAt)) return
    const now = new Date()
    const segmentElapsed = running && segmentStartAt ? now.getTime() - segmentStartAt.getTime() : 0
    const total = accumulatedMs + Math.max(0, segmentElapsed)
    setRunning(false)
    setPaused(false)
    clearTimer()
    setSessionStartAt(null)
    setSegmentStartAt(null)
    setAccumulatedMs(0)
    setElapsedMs(0)
    await clearNotifications()
    await endLiveActivity(activeTask, now, total)
  }

  async function stopTimer(options?: { auto?: boolean }) {
    if (stoppingRef.current) return
    if (!activeTask || !sessionStartAt || !activeCalendar) return
    if (!running && !paused) return

    stoppingRef.current = true
    const now = new Date()
    const segmentElapsed = running && segmentStartAt ? now.getTime() - segmentStartAt.getTime() : 0
    let total = accumulatedMs + Math.max(0, segmentElapsed)
    if (isCountdown && countdownTotalMs > 0) {
      total = Math.min(total, countdownTotalMs)
    }
    setElapsedMs(total)
    setRunning(false)
    setPaused(false)
    clearTimer()
    await clearNotifications()

    const startTime = sessionStartAt
    const endTime = new Date(startTime.getTime() + total)

    const trimmedNote = noteDraft.trim()
    const summaryLines = [
      `开始：${formatDateTime(startTime)}`,
      `结束：${formatDateTime(endTime)}`,
      `时长：${formatDuration(total)}`,
    ]

    const notes = trimmedNote ? `${trimmedNote}\n\n${summaryLines.join("\n")}` : summaryLines.join("\n")

    setSaving(true)
    try {
      const event = new CalendarEvent()
      event.title = activeTask.name
      event.calendar = activeCalendar
      event.startDate = startTime
      event.endDate = endTime
      event.notes = notes
      await event.save()
      if (!options?.auto) {
        await Dialog.alert({ message: "已保存到日历" })
      }
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    } finally {
      setSaving(false)
    }

    await endLiveActivity(activeTask, now, total)

    setTasks((prev) => {
      const next = prev.map((t) => (t.id === activeTask.id ? { ...t, noteDraft: "" } : t))
      void saveTasks(next)
      return next
    })
    setNoteDraft("")

    setSessionStartAt(null)
    setSegmentStartAt(null)
    setAccumulatedMs(0)
    setElapsedMs(0)
    stoppingRef.current = false
  }

  async function openNoteEditor() {
    const controller = new EditorController({
      content: noteDraft,
      ext: "md",
      readOnly: false,
    })
    controller.onContentChanged = (content) => {
      setNoteDraft(String(content ?? ""))
    }
    try {
      await controller.present({
        navigationTitle: "笔记",
        fullscreen: true,
      })
      setNoteDraft(String(controller.content ?? ""))
    } finally {
      controller.dispose()
    }
  }

  function moveTasks(indices: number[], newOffset: number) {
    if (!indices.length) return
    const movingItems = indices.map((index) => tasks[index]).filter(Boolean)
    const next = tasks.filter((_, index) => !indices.includes(index))
    next.splice(newOffset, 0, ...movingItems)
    void persistTasks(next)
  }

  const statusText = running ? "计时中" : paused ? "暂停中" : sessionStartAt ? "已停止" : "未开始"

  return (
    <NavigationStack>
      <List
        navigationTitle="日历番茄钟"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{
          topBarLeading: (
            <Button title="" systemImage="xmark.circle" action={() => Script.exit()} />
          ),
          topBarTrailing: (
            <HStack>
              <EditButton />
              <Button title="" systemImage="plus.circle" action={addTask} />
            </HStack>
          ),
        }}
      >
        <Section header={<Text>当前计时</Text>}>
          {activeTask ? (
            <VStack>
              <HStack>
                <Text font="headline">{activeTask.name}</Text>
                <Spacer />
                <Text foregroundStyle="secondaryLabel">{activeTask.calendarTitle}</Text>
              </HStack>
              <HStack padding={{ top: 6, bottom: 6 }}>
                <Text font="title">{timerText}</Text>
                <Spacer />
                <Text foregroundStyle="secondaryLabel">{statusText}</Text>
              </HStack>
              {sessionStartAt ? (
                <Text foregroundStyle="secondaryLabel">开始时间：{formatDateTime(sessionStartAt)}</Text>
              ) : null}
              <HStack padding={{ top: 8, bottom: 4 }}>
                <Button
                  title="取消"
                  buttonStyle="borderedProminent"
                  tint="black"
                  disabled={(!running && !paused) || saving}
                  action={cancelTimer}
                />
                <Spacer />
                <Button
                  title="结束"
                  buttonStyle="borderedProminent"
                  tint="systemRed"
                  disabled={(!running && !paused) || saving}
                  action={() => stopTimer()}
                />
                <Spacer />
                <Button
                  title="暂停"
                  buttonStyle="borderedProminent"
                  tint="systemOrange"
                  disabled={!running || saving}
                  action={pauseTimer}
                />
                <Spacer />
                <Button
                  title={paused ? "继续" : "开始"}
                  buttonStyle="borderedProminent"
                  tint="systemGreen"
                  disabled={saving}
                  action={() => startTask(activeTask)}
                />
              </HStack>
            </VStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">还没有选择任务，请在下方点击开始。</Text>
          )}
        </Section>

        <Section
          header={(
            <HStack>
              <Text>笔记</Text>
              <Button
                title=""
                systemImage={showMarkdown ? "eye.fill" : "eye.slash.fill"}
                action={() => setShowMarkdown((prev) => !prev)}
              />
              <Spacer />
              <Button
                title=""
                systemImage="arrow.down.backward.and.arrow.up.forward"
                action={openNoteEditor}
              />
            </HStack>
          )}
        >
          <TextField
            label={<Text>编辑</Text>}
            value={noteDraft}
            onChanged={(v: string) => setNoteDraft(v)}
            prompt="支持 Markdown，自动保存"
            axis="vertical"
            frame={{ height: 140 }}
          />
          {showMarkdown && noteDraft.trim() ? (
            <Markdown content={noteDraft} scrollable={false} />
          ) : showMarkdown ? (
            <Text foregroundStyle="secondaryLabel">暂无笔记</Text>
          ) : (
            <Text foregroundStyle="secondaryLabel">预览已关闭</Text>
          )}
        </Section>

        <Section header={<Text>任务列表</Text>}>
          {tasks.length ? (
            <ForEach
              count={tasks.length}
              onMove={moveTasks}
              itemBuilder={(index) => {
                const task = tasks[index]
                if (!task) return <Text> </Text>
                const isActive = activeTaskId === task.id
                const isRunning = running && isActive
                const isPaused = paused && isActive
                const actionTitle = isPaused ? "继续" : "开始"
                const countdownSeconds = task.countdownSeconds ?? 0
                const countdownLabel = task.useCountdown
                  ? COUNTDOWN_OPTIONS.find((opt) => opt.seconds === countdownSeconds)?.label ?? "倒计时"
                  : ""
                const notifyLabel = task.useNotification
                  ? NOTIFICATION_INTERVAL_OPTIONS.find((opt) => opt.minutes === task.notificationIntervalMinutes)?.label ?? "通知"
                  : ""
                const isCountdownTask = task.useCountdown && countdownSeconds > 0
                const iconName = isCountdownTask ? "restart" : "play"
                const iconColor = isCountdownTask ? "systemBlue" : "systemGreen"
                return (
                  <VStack
                    key={task.id}
                    trailingSwipeActions={{
                      allowsFullSwipe: false,
                      actions: [
                        <Button title="编辑" action={() => editTask(task)} />,
                        <Button title="删除" role="destructive" action={() => removeTask(task)} />,
                      ],
                    }}
                  >
                    <HStack padding={{ top: 8, bottom: 8 }}>
                      <Image
                        systemName={iconName}
                        foregroundStyle={iconColor}
                        imageScale="large"
                        frame={{ width: 22, height: 22 }}
                      />
                      <VStack alignment="leading">
                        <Text font="headline">{task.name}</Text>
                        <Text foregroundStyle="secondaryLabel">
                          {task.calendarTitle}
                          {countdownLabel ? ` · ${countdownLabel}` : ""}
                          {notifyLabel ? ` · ${notifyLabel}` : ""}
                        </Text>
                      </VStack>
                      <Spacer />
                      {isRunning ? (
                        <Text foregroundStyle="secondaryLabel">计时中</Text>
                      ) : isPaused ? (
                        <Text foregroundStyle="secondaryLabel">暂停中</Text>
                      ) : (
                        <Button
                          title={actionTitle}
                          buttonStyle="borderedProminent"
                          tint="systemGreen"
                          disabled={saving}
                          action={() => startTask(task)}
                        />
                      )}
                    </HStack>
                  </VStack>
                )
              }}
            />
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无任务，点击右上角新增。</Text>
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}
