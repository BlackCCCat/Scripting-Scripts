import {
  Button,
  DatePicker,
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
  useState,
} from "scripting"

import type { AlarmDraft, HolidayCalendarSource, HolidayMatchMode } from "../types"
import {
  extractTimeParts,
  makeTimeSeed,
  nextRoundedTimestamp,
} from "../utils/alarm_runtime"
import { DEFAULT_HOLIDAY_SOURCE_ID, DEFAULT_SNOOZE_MINUTES } from "../utils/storage"
import { CenterRowButton } from "./CenterRowButton"

type DraftRepeatMode = "daily" | "weekly" | "monthly" | "holiday" | "custom"

const REPEAT_OPTIONS: DraftRepeatMode[] = ["daily", "weekly", "monthly", "holiday", "custom"]
const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "周日" },
  { value: 2, label: "周一" },
  { value: 3, label: "周二" },
  { value: 4, label: "周三" },
  { value: 5, label: "周四" },
  { value: 6, label: "周五" },
  { value: 7, label: "周六" },
]
const HOLIDAY_MODE_OPTIONS: HolidayMatchMode[] = ["nonHoliday", "holiday"]
const SNOOZE_OPTIONS = [3, 5, 10, 15, 20, 30]
const SOUND_OPTIONS = [
  { label: "Default", value: "" },
  { label: "Radar", value: "Radar" },
  { label: "Beacon", value: "Beacon" },
  { label: "Bulletin", value: "Bulletin" },
  { label: "By The Seaside", value: "By The Seaside" },
  { label: "Chimes", value: "Chimes" },
  { label: "Circuit", value: "Circuit" },
  { label: "Crickets", value: "Crickets" },
  { label: "Hillside", value: "Hillside" },
  { label: "Night Owl", value: "Night Owl" },
  { label: "Opening", value: "Opening" },
  { label: "Playtime", value: "Playtime" },
  { label: "Presto", value: "Presto" },
  { label: "Sencha", value: "Sencha" },
  { label: "Signal", value: "Signal" },
  { label: "Silk", value: "Silk" },
  { label: "Slow Rise", value: "Slow Rise" },
  { label: "Summit", value: "Summit" },
] as const
const MONTHLY_DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => index + 1)
const NUMBER_OPTIONS = Array.from({ length: 999 }, (_, index) => index + 1)
const OCCURRENCE_LIMIT_OPTIONS = Array.from({ length: 99 }, (_, index) => index + 1)
const CUSTOM_DAY_OPTIONS = Array.from({ length: 50 }, (_, index) => index + 1)

function nextWeekdaySelection(weekdays: number[], weekday: number, enabled: boolean): number[] {
  const current = new Set(weekdays)
  if (enabled) current.add(weekday)
  else current.delete(weekday)
  return Array.from(current).sort((a, b) => a - b)
}

function startOfDayTimestamp(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function supportsOccurrenceLimit(mode: DraftRepeatMode): boolean {
  return mode === "daily" || mode === "weekly" || mode === "monthly" || mode === "custom"
}

export function AddAlarmView(props: {
  holidaySources: HolidayCalendarSource[]
  initial?: AlarmDraft | null
  mode?: "create" | "edit"
}) {
  const dismiss = Navigation.useDismiss()
  const initialDraft = props.initial ?? null
  const initialTimestamp = initialDraft?.repeatRule.kind === "once"
    ? initialDraft.repeatRule.timestamp
    : nextRoundedTimestamp()
  const initialTime = extractTimeParts(initialTimestamp)
  const initialRepeatEnabled = initialDraft?.repeatRule.kind !== "once"
  let initialRepeatMode: DraftRepeatMode = "daily"
  if (
    initialDraft?.repeatRule.kind === "daily"
    || initialDraft?.repeatRule.kind === "weekly"
    || initialDraft?.repeatRule.kind === "monthly"
    || initialDraft?.repeatRule.kind === "holiday"
    || initialDraft?.repeatRule.kind === "custom"
  ) {
    initialRepeatMode = initialDraft.repeatRule.kind
  }

  const [title, setTitle] = useState(initialDraft?.title ?? "闹钟")
  const [snoozeMinutes, setSnoozeMinutes] = useState(initialDraft?.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES)
  const [soundIndex, setSoundIndex] = useState<number>(() => {
    const initialSoundName = initialDraft?.soundName ?? ""
    const index = SOUND_OPTIONS.findIndex((item) => item.value === initialSoundName)
    return index >= 0 ? index : 0
  })
  const [repeatEnabled, setRepeatEnabled] = useState(initialRepeatEnabled)
  const [repeatMode, setRepeatMode] = useState<DraftRepeatMode>(initialRepeatMode)
  const [oneTimeTimestamp, setOneTimeTimestamp] = useState<number>(initialTimestamp)
  const [timeSeedTimestamp, setTimeSeedTimestamp] = useState<number>(
    makeTimeSeed(
      initialDraft?.repeatRule.kind === "daily"
      || initialDraft?.repeatRule.kind === "weekly"
      || initialDraft?.repeatRule.kind === "monthly"
      || initialDraft?.repeatRule.kind === "holiday"
      || initialDraft?.repeatRule.kind === "custom"
        ? initialDraft.repeatRule.hour
        : initialTime.hour,
      initialDraft?.repeatRule.kind === "daily"
      || initialDraft?.repeatRule.kind === "weekly"
      || initialDraft?.repeatRule.kind === "monthly"
      || initialDraft?.repeatRule.kind === "holiday"
      || initialDraft?.repeatRule.kind === "custom"
        ? initialDraft.repeatRule.minute
        : initialTime.minute
    )
  )
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(
    initialDraft?.repeatRule.kind === "weekly" ? initialDraft.repeatRule.weekdays : [2, 3, 4, 5, 6]
  )
  const [monthlyDay, setMonthlyDay] = useState<number>(
    initialDraft?.repeatRule.kind === "monthly"
      ? initialDraft.repeatRule.dayOfMonth
      : new Date(oneTimeTimestamp).getDate()
  )
  const [holidayModeIndex, setHolidayModeIndex] = useState(
    initialDraft?.repeatRule.kind === "holiday" && initialDraft.repeatRule.matchMode === "holiday" ? 1 : 0
  )
  const [customStartTimestamp, setCustomStartTimestamp] = useState<number>(
    initialDraft?.repeatRule.kind === "custom"
      ? startOfDayTimestamp(initialDraft.repeatRule.startDateTimestamp)
      : startOfDayTimestamp(oneTimeTimestamp)
  )
  const [customSkipDays, setCustomSkipDays] = useState<number>(
    initialDraft?.repeatRule.kind === "custom" ? initialDraft.repeatRule.skipDays : 2
  )
  const [customRingDays, setCustomRingDays] = useState<number>(
    initialDraft?.repeatRule.kind === "custom" ? initialDraft.repeatRule.ringDays : 1
  )
  const [occurrenceLimitValue, setOccurrenceLimitValue] = useState<number>(
    initialDraft?.repeatRule.kind === "daily"
    || initialDraft?.repeatRule.kind === "weekly"
    || initialDraft?.repeatRule.kind === "monthly"
    || initialDraft?.repeatRule.kind === "custom"
      ? initialDraft.repeatRule.occurrenceLimit ?? 0
      : 0
  )
  const [showOccurrenceLimitPicker, setShowOccurrenceLimitPicker] = useState(false)
  const [showCustomRingPicker, setShowCustomRingPicker] = useState(false)
  const [showCustomSkipPicker, setShowCustomSkipPicker] = useState(false)

  const holidaySources = props.holidaySources

  async function onSave() {
    const fixedTitle = title.trim()
    if (!fixedTitle) {
      await Dialog.alert({ message: "请输入闹钟标题。" })
      return
    }

    if (repeatEnabled && repeatMode === "weekly" && !selectedWeekdays.length) {
      await Dialog.alert({ message: "每周重复至少选择一天。" })
      return
    }

    if (repeatEnabled && repeatMode === "holiday" && !holidaySources.length) {
      await Dialog.alert({ message: "请先在日历设置里同步中国节假日日历。" })
      return
    }

    if (repeatEnabled && repeatMode === "custom") {
      if (!Number.isFinite(customSkipDays) || !Number.isFinite(customRingDays)) {
        await Dialog.alert({ message: "自定义周期选择无效。" })
        return
      }
    }

    const { hour, minute } = extractTimeParts(timeSeedTimestamp)
    const occurrenceLimit = repeatEnabled && supportsOccurrenceLimit(repeatMode) && occurrenceLimitValue > 0
      ? Math.max(1, Math.min(99, occurrenceLimitValue))
      : null
    const soundName = SOUND_OPTIONS[soundIndex]?.value || null
    let result: AlarmDraft

    if (!repeatEnabled) {
      result = {
        title: fixedTitle,
        snoozeMinutes,
        soundName,
        repeatRule: {
          kind: "once",
          timestamp: oneTimeTimestamp,
        },
      }
    } else if (repeatMode === "daily") {
      result = {
        title: fixedTitle,
        snoozeMinutes,
        soundName,
        repeatRule: {
          kind: "daily",
          hour,
          minute,
          occurrenceLimit,
        },
      }
    } else if (repeatMode === "weekly") {
      result = {
        title: fixedTitle,
        snoozeMinutes,
        soundName,
        repeatRule: {
          kind: "weekly",
          hour,
          minute,
          weekdays: selectedWeekdays,
          occurrenceLimit,
        },
      }
    } else if (repeatMode === "monthly") {
      result = {
        title: fixedTitle,
        snoozeMinutes,
        soundName,
        repeatRule: {
          kind: "monthly",
          hour,
          minute,
          dayOfMonth: monthlyDay,
          occurrenceLimit,
        },
      }
    } else if (repeatMode === "holiday") {
      result = {
        title: fixedTitle,
        snoozeMinutes,
        soundName,
        repeatRule: {
          kind: "holiday",
          hour,
          minute,
          sourceId: DEFAULT_HOLIDAY_SOURCE_ID,
          matchMode: HOLIDAY_MODE_OPTIONS[holidayModeIndex] ?? "nonHoliday",
        },
      }
    } else {
      result = {
        title: fixedTitle,
        snoozeMinutes,
        soundName,
        repeatRule: {
          kind: "custom",
          hour,
          minute,
          startDateTimestamp: customStartTimestamp,
          skipDays: Math.max(1, Math.min(50, customSkipDays)),
          ringDays: Math.max(1, Math.min(50, customRingDays)),
          occurrenceLimit,
        },
      }
    }

    if (result.repeatRule.kind === "once" && result.repeatRule.timestamp <= Date.now()) {
      await Dialog.alert({ message: "单次闹钟时间必须晚于当前时间。" })
      return
    }

    dismiss(result)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle={props.mode === "edit" ? "编辑闹钟" : "新建闹钟"}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
      >
        <Section header={<Text>基础信息</Text>}>
          <TextField
            title="标签"
            value={title}
            prompt="例如：起床、吃药、出门"
            onChanged={setTitle}
          />
          <Picker
            title="推迟时长"
            pickerStyle="menu"
            value={SNOOZE_OPTIONS.includes(snoozeMinutes) ? SNOOZE_OPTIONS.indexOf(snoozeMinutes) : 1}
            onChanged={(index: number) => setSnoozeMinutes(SNOOZE_OPTIONS[index] ?? DEFAULT_SNOOZE_MINUTES)}
          >
            {SNOOZE_OPTIONS.map((minutes, index) => (
              <Text key={`snooze-${minutes}`} tag={index}>
                {minutes} 分钟
              </Text>
            ))}
          </Picker>
          <Picker
            title="闹钟声音"
            pickerStyle="menu"
            value={soundIndex}
            onChanged={setSoundIndex}
          >
            {SOUND_OPTIONS.map((option, index) => (
              <Text key={`sound-${option.value || "default"}`} tag={index}>
                {option.label}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section header={<Text>重复</Text>}>
          <Toggle
            value={repeatEnabled}
            onChanged={setRepeatEnabled}
            toggleStyle="switch"
          >
            <Text>重复</Text>
          </Toggle>

          {!repeatEnabled ? (
            <DatePicker
              title="时间"
              value={oneTimeTimestamp}
              startDate={Date.now()}
              onChanged={setOneTimeTimestamp}
            />
          ) : (
            <>
              <Picker
                title="重复方式"
                pickerStyle="menu"
                value={REPEAT_OPTIONS.indexOf(repeatMode)}
                onChanged={(index: number) => setRepeatMode(REPEAT_OPTIONS[index] ?? "daily")}
              >
                <Text tag={0}>每天</Text>
                <Text tag={1}>每周</Text>
                <Text tag={2}>每月</Text>
                <Text tag={3}>节假日</Text>
                <Text tag={4}>自定义</Text>
              </Picker>
            </>
          )}

          {repeatEnabled && supportsOccurrenceLimit(repeatMode) && (
            <Button
              buttonStyle="plain"
              action={() => setShowOccurrenceLimitPicker(true)}
              sheet={{
                isPresented: showOccurrenceLimitPicker,
                onChanged: setShowOccurrenceLimitPicker,
                content: <VStack
                  presentationDetents={[320]}
                  presentationDragIndicator="visible"
                  padding={16}
                  spacing={12}
                >
                  <Text font="headline">重复次数</Text>
                  <Picker
                    title="重复次数"
                    pickerStyle="wheel"
                    value={occurrenceLimitValue}
                    onChanged={setOccurrenceLimitValue}
                  >
                    {OCCURRENCE_LIMIT_OPTIONS.map((value) => (
                      <Text key={`occurrence-limit-${value}`} tag={value}>
                        {value}
                      </Text>
                    ))}
                    <Text tag={0}>无限制</Text>
                  </Picker>
                  <Button title="完成" action={() => setShowOccurrenceLimitPicker(false)} />
                </VStack>,
              }}
            >
              <HStack spacing={12}>
                <Text foregroundStyle="label">重复次数</Text>
                <Spacer minLength={0} />
                <Text foregroundStyle="accentColor">
                  {occurrenceLimitValue > 0 ? String(occurrenceLimitValue) : "无限制"}
                </Text>
              </HStack>
            </Button>
          )}

          {repeatEnabled && repeatMode === "weekly" && WEEKDAY_OPTIONS.map((option) => (
            <Toggle
              key={option.value}
              value={selectedWeekdays.includes(option.value)}
              onChanged={(enabled: boolean) => {
                setSelectedWeekdays((current) => nextWeekdaySelection(current, option.value, enabled))
              }}
              toggleStyle="switch"
            >
              <Text>{option.label}</Text>
            </Toggle>
          ))}

          {repeatEnabled && repeatMode === "monthly" && (
            <Picker
              title="每月日期"
              pickerStyle="menu"
              value={MONTHLY_DAY_OPTIONS.indexOf(monthlyDay)}
              onChanged={(index: number) => setMonthlyDay(MONTHLY_DAY_OPTIONS[index] ?? 1)}
            >
              {MONTHLY_DAY_OPTIONS.map((day, index) => (
                <Text key={`monthly-day-${day}`} tag={index}>
                  每月 {day} 日
                </Text>
              ))}
            </Picker>
          )}

          {repeatEnabled && repeatMode === "holiday" && (
            <>
              <DatePicker
                title="时间"
                displayedComponents={["hourAndMinute"]}
                value={timeSeedTimestamp}
                onChanged={setTimeSeedTimestamp}
              />

              {!holidaySources.length ? (
                <Text foregroundStyle="secondaryLabel">
                  还没有可用的中国节假日日历，请先回到首页日历页里同步。
                </Text>
              ) : null}

              <Picker
                title="触发条件"
                pickerStyle="segmented"
                value={holidayModeIndex}
                onChanged={setHolidayModeIndex}
              >
                <Text tag={0}>工作日</Text>
                <Text tag={1}>休息日</Text>
              </Picker>

              <Text font="caption" foregroundStyle="secondaryLabel">
                工作日默认按周一到周五计算，并包含明确标成“班”的日期；休息日默认按周六周日计算，并包含明确标成“休”的日期。未来 120 天内的命中日期会被展开成多个系统级固定闹钟。
              </Text>
            </>
          )}

          {repeatEnabled && repeatMode === "custom" && (
            <>
              <DatePicker
                title="开始日期"
                displayedComponents={["date"]}
                value={customStartTimestamp}
                onChanged={(value: number) => setCustomStartTimestamp(startOfDayTimestamp(value))}
              />

              <Button
                buttonStyle="plain"
                action={() => setShowCustomRingPicker(true)}
                sheet={{
                  isPresented: showCustomRingPicker,
                  onChanged: setShowCustomRingPicker,
                  content: <VStack
                    presentationDetents={[320]}
                    presentationDragIndicator="visible"
                    padding={16}
                    spacing={12}
                  >
                    <Text font="headline">响几天</Text>
                    <Picker
                      title="响几天"
                    pickerStyle="wheel"
                    value={customRingDays}
                    onChanged={setCustomRingDays}
                  >
                      {CUSTOM_DAY_OPTIONS.map((value) => (
                        <Text key={`custom-ring-${value}`} tag={value}>
                          {value}
                        </Text>
                      ))}
                    </Picker>
                    <Button title="完成" action={() => setShowCustomRingPicker(false)} />
                  </VStack>,
                }}
              >
                <HStack spacing={12}>
                  <Text foregroundStyle="label">响几天</Text>
                  <Spacer minLength={0} />
                  <Text foregroundStyle="accentColor">{customRingDays}</Text>
                </HStack>
              </Button>

              <Button
                buttonStyle="plain"
                action={() => setShowCustomSkipPicker(true)}
                sheet={{
                  isPresented: showCustomSkipPicker,
                  onChanged: setShowCustomSkipPicker,
                  content: <VStack
                    presentationDetents={[320]}
                    presentationDragIndicator="visible"
                    padding={16}
                    spacing={12}
                  >
                    <Text font="headline">停几天</Text>
                    <Picker
                      title="停几天"
                    pickerStyle="wheel"
                    value={customSkipDays}
                    onChanged={setCustomSkipDays}
                  >
                      {CUSTOM_DAY_OPTIONS.map((value) => (
                        <Text key={`custom-skip-${value}`} tag={value}>
                          {value}
                        </Text>
                      ))}
                    </Picker>
                    <Button title="完成" action={() => setShowCustomSkipPicker(false)} />
                  </VStack>,
                }}
              >
                <HStack spacing={12}>
                  <Text foregroundStyle="label">停几天</Text>
                  <Spacer minLength={0} />
                  <Text foregroundStyle="accentColor">{customSkipDays}</Text>
                </HStack>
              </Button>

              <DatePicker
                title="时间"
                displayedComponents={["hourAndMinute"]}
                value={timeSeedTimestamp}
                onChanged={setTimeSeedTimestamp}
              />
            </>
          )}

          {repeatEnabled && repeatMode !== "holiday" && repeatMode !== "custom" && (
            <DatePicker
              title="时间"
              displayedComponents={["hourAndMinute"]}
              value={timeSeedTimestamp}
              onChanged={setTimeSeedTimestamp}
            />
          )}
        </Section>

        <Section>
          <CenterRowButton title={props.mode === "edit" ? "保存修改" : "添加闹钟"} onPress={onSave} />
          <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
        </Section>
      </Form>
    </NavigationStack>
  )
}
