import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useState,
} from "scripting"

import { COUNTDOWN_OPTIONS, NOTIFICATION_INTERVAL_OPTIONS } from "../constants"
import type { Task } from "../types"

function newTaskId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function CenterRowButton(props: {
  title: string
  role?: "cancel" | "destructive"
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Button role={props.role} action={props.onPress} disabled={props.disabled}>
      <HStack frame={{ width: "100%" as any }} padding={{ top: 14, bottom: 14 }}>
        <Text opacity={0} frame={{ width: 1 }}>
          .
        </Text>
        <Spacer />
        <Text font="headline">{props.title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}

export function TaskEditView(props: { title: string; initial?: Task }) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(props.initial?.name ?? "")
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [sourceIdx, setSourceIdx] = useState(0)
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [calendarIdx, setCalendarIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [useCountdown, setUseCountdown] = useState(Boolean(props.initial?.useCountdown ?? false))
  const [useNotification, setUseNotification] = useState(
    Boolean(props.initial?.useNotification ?? false)
  )
  const [countdownIdx, setCountdownIdx] = useState(() => {
    const initialSeconds = props.initial?.countdownSeconds ?? 0
    const idx = COUNTDOWN_OPTIONS.findIndex((opt) => opt.seconds === initialSeconds)
    return idx >= 0 ? idx : 0
  })
  const [notificationIdx, setNotificationIdx] = useState(() => {
    const minutes = props.initial?.notificationIntervalMinutes ?? 0
    const idx = NOTIFICATION_INTERVAL_OPTIONS.findIndex((opt) => opt.minutes === minutes)
    return idx >= 0 ? idx : 0
  })

  useEffect(() => {
    void loadSources()
  }, [])

  useEffect(() => {
    if (!sources.length) return
    if (!props.initial?.calendarId) return
    void (async () => {
      try {
        const list = await Calendar.forEvents()
        const found = list.find((c) => c.identifier === props.initial?.calendarId)
        const sourceId = found?.source?.identifier
        if (!sourceId) return
        const idx = sources.findIndex((s) => s.identifier === sourceId)
        if (idx >= 0) setSourceIdx(idx + 1)
      } catch {
        // ignore
      }
    })()
  }, [sources, props.initial?.calendarId])

  useEffect(() => {
    void loadCalendars()
  }, [sourceIdx, sources.length])

  useEffect(() => {
    if (!calendars.length) return
    if (props.initial?.calendarId) {
      const idx = calendars.findIndex((c) => c.identifier === props.initial?.calendarId)
      if (idx >= 0) {
        setCalendarIdx(idx)
        return
      }
    }
    setCalendarIdx((idx) => (idx >= 0 && idx < calendars.length ? idx : 0))
  }, [calendars, props.initial?.calendarId])

  async function loadSources() {
    try {
      setLoading(true)
      setError("")
      const list = Calendar.getSources?.() ?? []
      setSources(list)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  async function loadCalendars() {
    try {
      setLoading(true)
      setError("")
      const targetSource = sourceIdx > 0 ? sources[sourceIdx - 1] : null
      const list = targetSource ? await targetSource.getCalendars("event") : await Calendar.forEvents()
      const writable = (list ?? []).filter((c) => c.isForEvents && c.allowsContentModifications)
      setCalendars(writable)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  async function onSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      await Dialog.alert({ message: "请先输入任务名称" })
      return
    }
    if (!calendars.length) {
      await Dialog.alert({ message: "没有可写日历" })
      return
    }
    const picked = calendars[calendarIdx]
    if (!picked) {
      await Dialog.alert({ message: "请先选择日历" })
      return
    }
    const countdown = useCountdown ? COUNTDOWN_OPTIONS[countdownIdx]?.seconds ?? 0 : 0
    const notificationMinutes = useNotification
      ? NOTIFICATION_INTERVAL_OPTIONS[notificationIdx]?.minutes ?? 0
      : 0
    const task: Task = {
      id: props.initial?.id ?? newTaskId(),
      name: trimmedName,
      calendarId: picked.identifier,
      calendarTitle: picked.title,
      useCountdown: useCountdown,
      countdownSeconds: countdown,
      useNotification: useNotification,
      notificationIntervalMinutes: notificationMinutes,
      noteDraft: props.initial?.noteDraft ?? "",
    }
    dismiss(task)
  }

  return (
    <NavigationStack>
      <VStack navigationTitle={props.title} navigationBarTitleDisplayMode="inline">
        <Form formStyle="grouped">
          <Section header={<Text>任务设置与日历</Text>}>
            <TextField
              label={<Text>任务名称</Text>}
              value={name}
              onChanged={(v: string) => setName(v)}
              prompt="例如：读书"
            />

            {loading ? <Text>日历加载中...</Text> : null}
            {error ? <Text>{error}</Text> : null}

            {sources.length ? (
              <Picker
                title="日历账户"
                pickerStyle="menu"
                value={sourceIdx}
                onChanged={(idx: number) => {
                  setSourceIdx(idx)
                  setCalendarIdx(0)
                }}
              >
                <Text tag={0}>全部账户</Text>
                {sources.map((src, idx) => (
                  <Text key={src.identifier} tag={idx + 1}>
                    {src.title}
                  </Text>
                ))}
              </Picker>
            ) : null}

            {calendars.length ? (
              <Picker
                title="关联日历"
                pickerStyle="menu"
                value={calendarIdx}
                onChanged={(idx: number) => setCalendarIdx(idx)}
              >
                {calendars.map((cal, idx) => (
                  <Text key={cal.identifier} tag={idx}>
                    {cal.title}
                  </Text>
                ))}
              </Picker>
            ) : (
              <Text foregroundStyle="secondaryLabel">暂无可写日历</Text>
            )}
          </Section>

          <Section header={<Text>计时选项</Text>}>
            <Toggle value={useNotification} onChanged={(v: boolean) => setUseNotification(v)}>
              <Text>使用通知</Text>
            </Toggle>
            {useNotification ? (
              <Picker
                title="通知频率"
                pickerStyle="menu"
                value={notificationIdx}
                onChanged={(idx: number) => setNotificationIdx(idx)}
              >
                {NOTIFICATION_INTERVAL_OPTIONS.map((opt, idx) => (
                  <Text key={`${opt.label}-${idx}`} tag={idx}>
                    {opt.label}
                  </Text>
                ))}
              </Picker>
            ) : null}
            <Toggle value={useCountdown} onChanged={(v: boolean) => setUseCountdown(v)}>
              <Text>使用倒计时</Text>
            </Toggle>
            {useCountdown ? (
              <Picker
                title="倒计时"
                pickerStyle="wheel"
                value={countdownIdx}
                onChanged={(idx: number) => setCountdownIdx(idx)}
              >
                {COUNTDOWN_OPTIONS.map((opt, idx) => (
                  <Text key={`${opt.label}-${idx}`} tag={idx}>
                    {opt.label}
                  </Text>
                ))}
              </Picker>
            ) : null}
          </Section>

          <Section>
            <CenterRowButton title="保存" onPress={onSave} />
            <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
