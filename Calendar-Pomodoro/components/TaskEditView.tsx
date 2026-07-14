// Scripting 组件与 API：
// - UI 组件（Form/Picker/Toggle 等）
// - Hooks（useState/useEffect/useRef）
import {
  Button,
  Form,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useRef,
  useState,
} from "scripting"

// 通知频率的预设选项
import { NOTIFICATION_INTERVAL_OPTIONS } from "../constants"
// 任务类型
import type { Task } from "../types"
// 读取本地设置（用于按设置页中的日历账户筛选日历）
import { loadSettings } from "../utils/settings"

function newTaskId(): string {
  // 简单的本地唯一 ID（时间戳 + 随机数）
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export function TaskEditView(props: { title: string; initial?: Task }) {
  const dismiss = Navigation.useDismiss()
  // 基础字段
  const [name, setName] = useState(props.initial?.name ?? "")
  // 日历账户列表与设置页中保存的选择状态
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  // 账户筛选后的可写日历
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [calendarIdx, setCalendarIdx] = useState(0)
  const initialSourceInjectedRef = useRef(false)
  // 计时选项：倒计时由主页底部时间轴临时决定，任务设置页只保留通知配置
  const [useNotification, setUseNotification] = useState(
    Boolean(props.initial?.useNotification ?? false)
  )
  const [notificationIdx, setNotificationIdx] = useState(() => {
    const minutes = props.initial?.notificationIntervalMinutes ?? 0
    const idx = NOTIFICATION_INTERVAL_OPTIONS.findIndex((opt) => opt.minutes === minutes)
    return idx >= 0 ? idx : 0
  })

  useEffect(() => {
    // 页面首次进入：读取账户列表与本地设置
    void loadSources()
  }, [])

  useEffect(() => {
    // 设置页中的账户选择变化时，刷新可写日历列表
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
      // 读取所有日历账户
      const list = Calendar.getSources?.() ?? []
      setSources(list)
      const data = await loadSettings()
      const availableIds = list.map((src) => src.identifier)
      const savedIds = data.selectedCalendarSourceIds ?? []
      const savedAvailableIds = savedIds.filter((id) => availableIds.includes(id))
      const initialIds =
        savedAvailableIds.length > 0
          ? savedAvailableIds
          : availableIds
      setSelectedSourceIds(initialIds)
    } catch {
      setSources([])
      setSelectedSourceIds([])
    }
  }

  async function loadCalendars() {
    try {
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
    } catch {
      setCalendars([])
    }
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
    const notificationMinutes = useNotification
      ? NOTIFICATION_INTERVAL_OPTIONS[notificationIdx]?.minutes ?? 0
      : 0
    const task: Task = {
      id: props.initial?.id ?? newTaskId(),
      name: trimmedName,
      calendarId: picked.identifier,
      calendarTitle: picked.title,
      useNotification: useNotification,
      notificationIntervalMinutes: notificationMinutes,
      noteDraft: props.initial?.noteDraft ?? "",
    }
    dismiss(task)
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarTrailing: (
            <Button
              title="保存"
              action={() => {
                HapticFeedback.mediumImpact()
                void onSave()
              }}
            />
          ),
        }}
      >
        {/* 表单分区：任务设置/计时选项 */}
        <Form formStyle="grouped">
          <Section header={<Text>任务设置与日历</Text>}>
            <TextField
              label={<Text>任务名称</Text>}
              value={name}
              onChanged={(v: string) => setName(v)}
              prompt="例如：读书"
            />

            {/* 关联日历（从所选账户中筛选） */}
            {calendars.length ? (
              <Picker
                title="关联日历"
                pickerStyle="menu"
                value={calendarIdx}
                onChanged={(idx: number) => {
                  HapticFeedback.heavyImpact()
                  setCalendarIdx(idx)
                }}
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
            <Toggle
              value={useNotification}
              onChanged={(v: boolean) => {
                HapticFeedback.heavyImpact()
                setUseNotification(v)
              }}
            >
              <Text>使用通知</Text>
            </Toggle>
            {useNotification ? (
              <Picker
                title="通知频率"
                pickerStyle="menu"
                value={notificationIdx}
                onChanged={(idx: number) => {
                  HapticFeedback.heavyImpact()
                  setNotificationIdx(idx)
                }}
              >
                {NOTIFICATION_INTERVAL_OPTIONS.map((opt, idx) => (
                  <Text key={`${opt.label}-${idx}`} tag={idx}>
                    {opt.label}
                  </Text>
                ))}
              </Picker>
            ) : null}
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
