// Scripting 组件与 API：
// - UI 组件（Form/Picker/Toggle/DisclosureGroup 等）
// - Hooks（useState/useEffect/useRef）
import {
  Button,
  DisclosureGroup,
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
  useRef,
  useState,
} from "scripting"

// 倒计时与通知的预设选项
import { COUNTDOWN_OPTIONS, NOTIFICATION_INTERVAL_OPTIONS } from "../constants"
// 任务类型
import type { Task } from "../types"
// 读取/保存本地设置（用于记住日历账户选择）
import { loadSettings, saveSettings, type AppSettings } from "../utils/settings"

function newTaskId(): string {
  // 简单的本地唯一 ID（时间戳 + 随机数）
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
      {/* 通过左右 Spacer 让文字居中对齐 */}
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
  // 基础字段
  const [name, setName] = useState(props.initial?.name ?? "")
  // 日历账户列表与选择状态
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [sourcesExpanded, setSourcesExpanded] = useState(false)
  // 账户筛选后的可写日历
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [calendarIdx, setCalendarIdx] = useState(0)
  // 加载状态与错误
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  // 本地设置（用于记住账户选择）
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const selectionInitRef = useRef(false)
  const initialSourceInjectedRef = useRef(false)
  // 计时选项
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
    // 页面首次进入：读取账户列表与本地设置
    void loadSources()
    void loadAppSettings()
  }, [])

  useEffect(() => {
    if (!sources.length) return
    if (!settings) return
    if (selectionInitRef.current) return
    // 首次根据设置恢复勾选的日历账户；若无设置则默认全选
    const savedIds = settings.selectedCalendarSourceIds ?? []
    const availableIds = sources.map((src) => src.identifier)
    const initialIds =
      savedIds.length > 0
        ? savedIds.filter((id) => availableIds.includes(id))
        : availableIds
    selectionInitRef.current = true
    setSelectedSourceIds(initialIds)
  }, [sources, settings])

  useEffect(() => {
    if (!selectionInitRef.current || !settings) return
    // 记住上次勾选的账户
    void saveSettings({ ...settings, selectedCalendarSourceIds: selectedSourceIds })
  }, [selectedSourceIds, settings])

  useEffect(() => {
    // 勾选账户变化时，刷新可写日历列表
    void loadCalendars()
  }, [selectedSourceIds, sources.length])

  useEffect(() => {
    if (!calendars.length) return
    if (props.initial?.calendarId) {
      // 编辑时优先定位到原任务的日历
      const idx = calendars.findIndex((c) => c.identifier === props.initial?.calendarId)
      if (idx >= 0) {
        setCalendarIdx(idx)
        return
      }
    }
    setCalendarIdx((idx) => (idx >= 0 && idx < calendars.length ? idx : 0))
  }, [calendars, props.initial?.calendarId])

  useEffect(() => {
    if (initialSourceInjectedRef.current) return
    if (!props.initial?.calendarId) return
    if (!sources.length) return
    // 编辑任务时，确保原任务所属账户在勾选列表中
    void (async () => {
      try {
        const list = await Calendar.forEvents()
        const found = list.find((c) => c.identifier === props.initial?.calendarId)
        const sourceId = found?.source?.identifier
        if (!sourceId) return
        if (!selectedSourceIds.includes(sourceId)) {
          setSelectedSourceIds((prev) => [...prev, sourceId])
        }
      } finally {
        initialSourceInjectedRef.current = true
      }
    })()
  }, [props.initial?.calendarId, sources, selectedSourceIds])

  async function loadSources() {
    try {
      setLoading(true)
      setError("")
      // 读取所有日历账户
      const list = Calendar.getSources?.() ?? []
      setSources(list)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  async function loadAppSettings() {
    try {
      // 读取本地设置（记住的账户选择）
      const data = await loadSettings()
      setSettings(data)
    } catch {
      setSettings({
        showMarkdown: true,
        selectedCalendarSourceIds: [],
      })
    }
  }

  async function loadCalendars() {
    try {
      setLoading(true)
      setError("")
      if (!selectedSourceIds.length) {
        setCalendars([])
        return
      }
      // 仅加载勾选账户下可写的事件日历
      const selectedSources = sources.filter((src) => selectedSourceIds.includes(src.identifier))
      const lists = await Promise.all(
        selectedSources.map((src) => src.getCalendars("event"))
      )
      const merged = (lists ?? []).flat().filter(Boolean)
      const seen = new Set<string>()
      const unique = merged.filter((cal) => {
        if (!cal?.identifier) return false
        if (seen.has(cal.identifier)) return false
        seen.add(cal.identifier)
        return true
      })
      const writable = unique.filter((c) => c.isForEvents && c.allowsContentModifications)
      setCalendars(writable)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  async function toggleSource(sourceId: string, enabled: boolean) {
    // 至少保留一个账户，避免日历列表为空
    if (!enabled && selectedSourceIds.length <= 1 && selectedSourceIds.includes(sourceId)) {
      await Dialog.alert({ message: "至少选择一个日历账户" })
      return
    }
    setSelectedSourceIds((prev) => {
      if (enabled) {
        if (prev.includes(sourceId)) return prev
        return [...prev, sourceId]
      }
      return prev.filter((id) => id !== sourceId)
    })
  }

  async function onSave() {
    // 保存前的校验
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
    // UI 选择转换为最终保存的任务字段
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
        {/* 表单分区：任务设置/计时选项/保存 */}
        <Form formStyle="grouped">
          <Section header={<Text>任务设置与日历</Text>}>
            <TextField
              label={<Text>任务名称</Text>}
              value={name}
              onChanged={(v: string) => setName(v)}
              prompt="例如：读书"
            />


            {/* 日历账户（可展开多选） */}
            <DisclosureGroup
              label={(
                <HStack>
                  <Text>日历账户</Text>
                  <Spacer />
                  <Text foregroundStyle="secondaryLabel">
                    已选 {selectedSourceIds.length}/{sources.length}
                  </Text>
                </HStack>
              )}
              isExpanded={sourcesExpanded}
              onChanged={(value: boolean) => setSourcesExpanded(value)}
            >
              {sources.length ? (
                sources.map((src) => (
                  <Toggle
                    key={src.identifier}
                    value={selectedSourceIds.includes(src.identifier)}
                    onChanged={(value: boolean) => void toggleSource(src.identifier, value)}
                    toggleStyle="switch"
                  >
                    <Text>{src.title}</Text>
                  </Toggle>
                ))
              ) : (
                <Text foregroundStyle="secondaryLabel">暂无日历账户</Text>
              )}
            </DisclosureGroup>

            {/* 关联日历（从所选账户中筛选） */}
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
            {/* 通知开关与频率 */}
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
            {/* 倒计时开关与时长 */}
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

          {/* 操作区：保存/取消 */}
          <Section>
            <CenterRowButton title="保存" onPress={onSave} />
            <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
