import {
  Button,
  EmptyView,
  ForEach,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  NavigationStack,
  Section,
  Tab,
  TabView,
  Text,
  Toggle,
  VStack,
  ZStack,
  modifiers,
  type Color,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
} from "scripting"

import type { AlarmDraft, AlarmRecord, AlarmRepeatRule, HolidayCalendarSource } from "../types"
import { AddAlarmView } from "./AddAlarmView"
import { BlockingProgressOverlay } from "./BlockingProgressOverlay"
import { CalendarSettingsView } from "./CalendarSettingsView"
import { HeaderAlarmActionLabel, NextAlarmHeader } from "./NextAlarmHeader"
import {
  GLASS_CARD_APPEARANCE,
  GLASS_CARD_SHAPE,
  GRADIENT_SCROLL_APPEARANCE,
  GradientPage,
  supportsLiquidGlass as usesLiquidGlass,
} from "./PageAppearance"
import { useReleaseNotesSheet } from "./ReleaseNotesSheet"
import { SoundSettingsView } from "./SoundSettingsView"
import { StatusView } from "./StatusView"
import { SystemAlarmSettingsView } from "./SystemAlarmSettingsView"
import {
  cancelManagedSystemAlarmIds,
  deleteAlarm,
  disableAlarm,
  displaySubtitle,
  displayTime,
  formatDateTime,
  nextOccurrenceDateLabel,
  nextOccurrenceTimestamp,
  reconcileAlarmRecords,
  scheduleAlarm,
} from "../utils/alarm_runtime"
import { canSkipAlarm, pendingSkippedOccurrences, skipOccurrence, undoSkippedOccurrence } from "../utils/alarm_skip"
import { ALARM_TYPE_SYMBOLS, nextAlarmForDisplay } from "../utils/alarm_summary"
import { buildHolidayDayMap, syncHolidayCalendarSource } from "../utils/holiday_calendar"
import { DEFAULT_SOUND_NAME, loadAvailableSoundNames, soundDisplayName } from "../utils/alarm_sounds"
import {
  ALARM_CONFIGURATION_VERSION,
  collectRecordSystemAlarmIds,
  DEFAULT_HOLIDAY_SOURCE_ID,
  loadCustomAlarmState,
  mergeManagedSystemAlarmIds,
  saveCustomAlarmState,
} from "../utils/storage"

const STATUS_TAB = 0
const ALARMS_TAB = 1
const CALENDARS_TAB = 2
const ACTION_TAB = 3
const ALARM_CARD_PREVIEW = modifiers()
  .contentShape({ kind: "interaction", shape: GLASS_CARD_SHAPE })
  .contentShape({ kind: "dragPreview", shape: GLASS_CARD_SHAPE })
  .contentShape({ kind: "contextMenuPreview", shape: GLASS_CARD_SHAPE })

type ContentTab = typeof STATUS_TAB | typeof ALARMS_TAB | typeof CALENDARS_TAB
type RootTab = ContentTab | typeof ACTION_TAB
type AdvancedCleanupItem = {
  alarmId: string
  timeLabel: string
  title: string
  summary: string
  detail: string
  sourceLabel: string
}
type AdvancedCleanupSnapshot = {
  items: AdvancedCleanupItem[]
  diagnosticItems: AdvancedCleanupItem[]
}

function isContentTab(value: RootTab): value is ContentTab {
  return value === STATUS_TAB || value === ALARMS_TAB || value === CALENDARS_TAB
}

function mergeStoredRecords(current: AlarmRecord[], stored: AlarmRecord[]): AlarmRecord[] {
  // 优先保留更新时间更晚的那份数据，避免监听器刷新时把刚改完的本地状态覆盖回旧值。
  const storedMap = new Map(stored.map((item) => [item.id, item]))
  const merged = current.map((item) => {
    const storedItem = storedMap.get(item.id)
    if (!storedItem) return item
    return (storedItem.updatedAt ?? 0) > (item.updatedAt ?? 0) ? storedItem : item
  })
  const existingIds = new Set(merged.map((item) => item.id))
  for (const item of stored) {
    if (!existingIds.has(item.id)) merged.push(item)
  }
  return merged
}

function normalizeRepeatRule(rule: AlarmRepeatRule): string {
  switch (rule.kind) {
    case "once":
      return JSON.stringify({
        kind: rule.kind,
        timestamp: rule.timestamp,
      })
    case "daily":
      return JSON.stringify({
        kind: rule.kind,
        hour: rule.hour,
        minute: rule.minute,
        occurrenceLimit: rule.occurrenceLimit ?? null,
      })
    case "weekly":
      return JSON.stringify({
        kind: rule.kind,
        hour: rule.hour,
        minute: rule.minute,
        weekdays: [...rule.weekdays].sort((a, b) => a - b),
        occurrenceLimit: rule.occurrenceLimit ?? null,
      })
    case "monthly":
      return JSON.stringify({
        kind: rule.kind,
        hour: rule.hour,
        minute: rule.minute,
        dayOfMonth: rule.dayOfMonth,
        occurrenceLimit: rule.occurrenceLimit ?? null,
      })
    case "holiday":
      return JSON.stringify({
        kind: rule.kind,
        hour: rule.hour,
        minute: rule.minute,
        sourceId: rule.sourceId,
        matchMode: rule.matchMode,
      })
    case "custom":
      return JSON.stringify({
        kind: rule.kind,
        hour: rule.hour,
        minute: rule.minute,
        startDateTimestamp: rule.startDateTimestamp,
        skipDays: rule.skipDays,
        ringDays: rule.ringDays,
        occurrenceLimit: rule.occurrenceLimit ?? null,
      })
    default:
      return JSON.stringify(rule)
  }
}

function alarmDraftKey(draft: AlarmDraft): string {
  return JSON.stringify({
    title: draft.title.trim(),
    snoozeMinutes: draft.snoozeMinutes,
    soundName: draft.soundName,
    repeatRule: normalizeRepeatRule(draft.repeatRule),
  })
}

function toAlarmDraft(record: AlarmRecord): AlarmDraft {
  return {
    title: record.title,
    snoozeMinutes: record.snoozeMinutes,
    soundName: record.soundName,
    repeatRule: record.repeatRule,
  }
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0")
}

function systemAlarmTimeLabel(alarm: AlarmManager.Alarm): string {
  const schedule = alarm.schedule
  if (schedule?.type === "fixed" && schedule.date) {
    const date = new Date(schedule.date)
    return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
  }
  if (typeof schedule?.hour === "number" && typeof schedule?.minute === "number") {
    return `${twoDigits(schedule.hour)}:${twoDigits(schedule.minute)}`
  }
  return "无固定时间"
}

function describeSystemAlarm(alarm: AlarmManager.Alarm): string {
  const schedule = alarm.schedule
  if (!schedule) return `无时间规则 · ${alarm.state}`

  if (schedule.type === "fixed" && schedule.date) {
    const date = new Date(schedule.date)
    const yyyy = date.getFullYear()
    const mm = twoDigits(date.getMonth() + 1)
    const dd = twoDigits(date.getDate())
    const hh = twoDigits(date.getHours())
    const min = twoDigits(date.getMinutes())
    return `${yyyy}-${mm}-${dd} ${hh}:${min} · ${alarm.state}`
  }

  if (schedule.weekdays?.length) {
    const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
    const weekdayText = schedule.weekdays
      .map((weekday) => labels[(weekday - 1 + 7) % 7] ?? String(weekday))
      .join("、")
    return `${weekdayText} ${twoDigits(schedule.hour ?? 0)}:${twoDigits(schedule.minute ?? 0)} · ${alarm.state}`
  }

  if (typeof schedule.hour === "number" && typeof schedule.minute === "number") {
    return `每天 ${twoDigits(schedule.hour)}:${twoDigits(schedule.minute)} · ${alarm.state}`
  }

  return alarm.state
}

function alarmScheduleKindLabel(alarm: AlarmManager.Alarm): string {
  const schedule = alarm.schedule
  if (!schedule) return "未知规则"
  if (schedule.type === "fixed" && schedule.date) return "固定时间"
  if (schedule.weekdays?.length) return "每周重复"
  if (typeof schedule.hour === "number" && typeof schedule.minute === "number") return "每日重复"
  return "未知规则"
}

function rowSwipeActions(props: {
  onEdit: () => void
  onDelete: () => void
}) {
  return {
    allowsFullSwipe: false,
    actions: [
      <Button title="编辑" action={props.onEdit} />,
      <Button title="删除" role="destructive" tint="red" action={props.onDelete} />,
    ],
  }
}

function AlarmMetaTag(props: {
  icon: string
  text: string
  tint?: Color
}) {
  return (
    <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Image
        systemName={props.icon}
        foregroundStyle={props.tint ?? "systemOrange"}
        frame={{ width: 12, alignment: "center" }}
      />
      <Text
        font="caption"
        foregroundStyle="secondaryLabel"
        lineLimit={2}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        {props.text}
      </Text>
    </HStack>
  )
}

function AlarmRow(props: {
  record: AlarmRecord
  subtitle: string
  nextDateText: string
  busy: boolean
  onToggle: (record: AlarmRecord, enabled: boolean) => void | Promise<void>
}) {
  const titleText = props.record.title.trim()
  const showsTitle = titleText.length > 0 && titleText !== "闹钟"
  const once = props.record.repeatRule.kind === "once"

  return (
    <HStack
      alignment="top"
      spacing={12}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      padding={{ top: 12, bottom: 12, leading: 16, trailing: 16 }}
      background={{
        alignment: "bottomLeading",
        content: (
          <Image
            systemName={ALARM_TYPE_SYMBOLS[props.record.repeatRule.kind]}
            font={56}
            foregroundStyle={{ light: "rgba(60,90,105,0.07)", dark: "rgba(225,235,240,0.07)" }}
            allowsHitTesting={false}
            accessibilityHidden
          />
        ),
      }}
    >
      <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text
          font="largeTitle"
          fontWeight="semibold"
          monospacedDigit
          lineLimit={1}
          minScaleFactor={0.75}
          foregroundStyle={props.record.enabled ? "label" : "secondaryLabel"}
        >
          {displayTime(props.record)}
        </Text>
        {showsTitle ? <Text font="subheadline" lineLimit={1}>{titleText}</Text> : null}
        <AlarmMetaTag
          icon={once ? "clock" : "arrow.trianglehead.2.clockwise"}
          text={once ? `单次 · ${props.subtitle}` : props.subtitle}
        />
        <AlarmMetaTag icon="calendar" text={`下次 ${props.nextDateText}`} tint="#2563EB" />
        <AlarmMetaTag icon="speaker.wave.2" text={`声音 ${soundDisplayName(props.record.soundName)}`} />
      </VStack>
      <Toggle
        title="启用闹钟"
        labelsHidden
        value={props.record.enabled}
        disabled={props.busy}
        onChanged={(value: boolean) => props.onToggle(props.record, value)}
        toggleStyle="switch"
      />
    </HStack>
  )
}

export function HomeView() {
  const releaseNotesSheet = useReleaseNotesSheet({
    title: "更新说明",
    // Legacy identifier retained so renaming the Markdown file does not reset read state.
    storageKey: "custom-alarm:release-notes:release-notes.md:last-seen-hash",
  })
  const [initialState] = useState(() => loadCustomAlarmState())
  const alarmRecords = useObservable<AlarmRecord[]>(() => initialState.alarms)
  const records = alarmRecords.value
  const [holidaySources, setHolidaySources] = useState<HolidayCalendarSource[]>(() => initialState.holidaySources)
  const [availableSounds, setAvailableSounds] = useState<string[]>(() => initialState.availableSounds)
  const [managedSystemAlarmIds, setManagedSystemAlarmIds] = useState<string[]>(() => initialState.managedSystemAlarmIds)
  const [cleanupCandidateAlarmIds, setCleanupCandidateAlarmIds] = useState<string[]>(() => initialState.cleanupCandidateAlarmIds)
  const [alarmConfigurationVersion, setAlarmConfigurationVersion] = useState<number>(() => initialState.alarmConfigurationVersion)
  const [systemAlarms, setSystemAlarms] = useState<AlarmManager.Alarm[]>([])
  const [globalBusy, setGlobalBusy] = useState(false)
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null)
  const [calendarRefreshing, setCalendarRefreshing] = useState(false)
  const [alarmWriting, setAlarmWriting] = useState(false)
  const [alarmDeleting, setAlarmDeleting] = useState(false)
  const activeTab = useObservable<RootTab>(ALARMS_TAB)
  const [lastContentTab, setLastContentTab] = useState<ContentTab>(ALARMS_TAB)
  const [actionRunning, setActionRunning] = useState(false)
  const skipMutationInProgress = useRef(false)

  const holidaySourceMap = useMemo(() => {
    return new Map(holidaySources.map((item) => [item.id, item]))
  }, [holidaySources])
  const systemAlarmMap = useMemo(() => {
    return new Map(systemAlarms.map((alarm) => [alarm.id, alarm]))
  }, [systemAlarms])

  const enabledCount = useMemo(() => records.filter((item) => item.enabled).length, [records])
  const managedInstanceCount = useMemo(() => {
    const activeIds = new Set<string>()
    for (const record of records) {
      for (const id of record.systemAlarmIds) {
        if (systemAlarmMap.has(id)) activeIds.add(id)
      }
    }
    return activeIds.size
  }, [records, systemAlarmMap])
  const selectedHolidaySource = holidaySources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? holidaySources[0] ?? null
  const currentMonthSummary = useMemo(() => {
    if (!selectedHolidaySource) return { totalOff: 0, remainingOff: 0, totalWork: 0, remainingWork: 0 }

    const dayMap = buildHolidayDayMap(selectedHolidaySource)
    const now = new Date()
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-`
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    let totalOff = 0
    let remainingOff = 0
    let totalWork = 0
    let remainingWork = 0

    for (const [dateKey, info] of dayMap.entries()) {
      if (!dateKey.startsWith(prefix)) continue
      if (info.kind === "off") {
        totalOff += 1
        if (dateKey >= todayKey) remainingOff += 1
      }
      if (info.kind === "work") {
        totalWork += 1
        if (dateKey >= todayKey) remainingWork += 1
      }
    }

    return { totalOff, remainingOff, totalWork, remainingWork }
  }, [selectedHolidaySource])

  function setRecords(update: AlarmRecord[] | ((current: AlarmRecord[]) => AlarmRecord[])) {
    alarmRecords.setValue(typeof update === "function" ? update(alarmRecords.value) : update)
  }

  function saveStateSnapshot(
    nextRecords: AlarmRecord[],
    nextHolidaySources = holidaySources,
    nextAvailableSounds = availableSounds,
    nextManagedSystemAlarmIds = managedSystemAlarmIds,
    nextCleanupCandidateAlarmIds = cleanupCandidateAlarmIds,
    nextAlarmConfigurationVersion = alarmConfigurationVersion
  ) {
    saveCustomAlarmState({
      alarms: nextRecords,
      holidaySources: nextHolidaySources,
      availableSounds: nextAvailableSounds,
      managedSystemAlarmIds: nextManagedSystemAlarmIds,
      cleanupCandidateAlarmIds: nextCleanupCandidateAlarmIds,
      alarmConfigurationVersion: nextAlarmConfigurationVersion,
    })
  }

  function markCleanupCandidates(ids: string[]): string[] {
    if (!ids.length) return cleanupCandidateAlarmIds
    const next = mergeManagedSystemAlarmIds(cleanupCandidateAlarmIds, ids)
    setCleanupCandidateAlarmIds(next)
    saveStateSnapshot(records, holidaySources, availableSounds, managedSystemAlarmIds, next)
    return next
  }

  async function migrateAlarmConfigurationsIfNeeded() {
    const storedState = loadCustomAlarmState()
    if (storedState.alarmConfigurationVersion >= ALARM_CONFIGURATION_VERSION) return
    if (!AlarmManager.isAvailable) return

    const sourceMap = new Map(storedState.holidaySources.map((item) => [item.id, item]))
    const migratedRecords: AlarmRecord[] = []
    let migrationFailed = false

    for (const record of storedState.alarms) {
      if (!record.enabled || !record.systemAlarmIds.length) {
        migratedRecords.push(record)
        continue
      }

      try {
        migratedRecords.push(await scheduleAlarm(record, sourceMap))
      } catch {
        migrationFailed = true
        migratedRecords.push(record)
      }
    }

    const nextManagedIds = collectRecordSystemAlarmIds(migratedRecords)
    const nextAlarmConfigurationVersion = migrationFailed
      ? storedState.alarmConfigurationVersion
      : ALARM_CONFIGURATION_VERSION
    setRecords(migratedRecords)
    setManagedSystemAlarmIds(nextManagedIds)
    setAlarmConfigurationVersion(nextAlarmConfigurationVersion)
    saveStateSnapshot(
      migratedRecords,
      storedState.holidaySources,
      storedState.availableSounds,
      nextManagedIds,
      storedState.cleanupCandidateAlarmIds,
      nextAlarmConfigurationVersion
    )
    await refreshSystemState()
  }

  function buildAdvancedCleanupItems(
    nextSystemAlarms = systemAlarms,
    nextRecords = records,
    nextCleanupCandidateIds = cleanupCandidateAlarmIds
  ): AdvancedCleanupItem[] {
    const cleanupCandidateSet = new Set(nextCleanupCandidateIds)

    return [...nextSystemAlarms]
      .sort((a, b) => systemAlarmTimeLabel(a).localeCompare(systemAlarmTimeLabel(b)))
      .filter((alarm) => cleanupCandidateSet.has(alarm.id))
      .map((alarm): AdvancedCleanupItem | null => {
        const owner = nextRecords.find((record) => record.systemAlarmIds.includes(alarm.id))
        if (owner) return null
        return {
          alarmId: alarm.id,
          timeLabel: systemAlarmTimeLabel(alarm),
          title: "首页已删除的残留闹钟",
          summary: "首页已经删除，但系统里仍然残留的闹钟实例。",
          detail: describeSystemAlarm(alarm),
          sourceLabel: "来源：删除后残留，允许在这里手动清理",
        }
      })
      .filter((item: AdvancedCleanupItem | null): item is AdvancedCleanupItem => Boolean(item))
  }

  function buildDiagnosticItems(
    nextSystemAlarms = systemAlarms,
    nextRecords = records,
    nextManagedIds = managedSystemAlarmIds,
    nextCleanupCandidateIds = cleanupCandidateAlarmIds
  ): AdvancedCleanupItem[] {
    const managedIdSet = new Set(nextManagedIds)
    const cleanupIdSet = new Set(nextCleanupCandidateIds)

    return [...nextSystemAlarms]
      .sort((a, b) => systemAlarmTimeLabel(a).localeCompare(systemAlarmTimeLabel(b)))
      .map((alarm): AdvancedCleanupItem => {
        const owner = nextRecords.find((record) => record.systemAlarmIds.includes(alarm.id))
        const linkedLabel = owner ? displaySubtitle(owner, holidaySourceMap) : "未关联到当前首页闹钟"
        const sourceParts = [
          owner ? "当前首页闹钟已关联" : "当前首页闹钟未关联",
          managedIdSet.has(alarm.id) ? "脚本已登记" : "脚本未登记",
          cleanupIdSet.has(alarm.id) ? "已标记为残留候选" : null,
        ].filter(Boolean)

        return {
          alarmId: alarm.id,
          timeLabel: systemAlarmTimeLabel(alarm),
          title: owner?.title || "未关联到当前首页闹钟",
          summary: `${alarmScheduleKindLabel(alarm)} · ${linkedLabel}`,
          detail: describeSystemAlarm(alarm),
          sourceLabel: sourceParts.join(" · "),
        }
      })
  }

  useEffect(() => {
    saveCustomAlarmState({
      alarms: records,
      holidaySources,
      availableSounds,
      managedSystemAlarmIds,
      cleanupCandidateAlarmIds,
      alarmConfigurationVersion,
    })
  }, [records, holidaySources, availableSounds, managedSystemAlarmIds, cleanupCandidateAlarmIds, alarmConfigurationVersion])

  useEffect(() => {
    if (!AlarmManager.isAvailable) return

    const listener = () => {
      // 跳过期间会先登记新实例再取消旧实例，中途不对账。
      if (skipMutationInProgress.current) return
      void refreshSystemState()
    }

    AlarmManager.addAlarmUpdateListener(listener)
    void (async () => {
      await refreshSystemState()
      await migrateAlarmConfigurationsIfNeeded()
    })()
    void refreshAvailableSounds({ showError: false })

    return () => {
      AlarmManager.removeAlarmUpdateListener(listener)
    }
  }, [])

  useEffect(() => {
    const today = new Date()
    const isJanFirst = today.getMonth() === 0 && today.getDate() === 1
    if (!isJanFirst) return

    const source = selectedHolidaySource
    if (!source) return

    const lastSyncedAt = source.lastSyncedAt ? new Date(source.lastSyncedAt) : null
    const alreadySyncedToday = Boolean(
      lastSyncedAt
      && lastSyncedAt.getFullYear() === today.getFullYear()
      && lastSyncedAt.getMonth() === today.getMonth()
      && lastSyncedAt.getDate() === today.getDate()
    )

    if (!alreadySyncedToday) {
      void refreshBuiltinHolidayCalendar({ showLoading: false })
    }
  }, [holidaySources])

  useEffect(() => {
    if (isContentTab(activeTab.value)) {
      setLastContentTab(activeTab.value)
      return
    }

    if (actionRunning) return
    setActionRunning(true)

    void (async () => {
      try {
        if (lastContentTab === STATUS_TAB) {
          await refreshStatusPanel()
        } else if (lastContentTab === ALARMS_TAB) {
          await addAlarm()
        } else {
          if (!calendarRefreshing) await refreshBuiltinHolidayCalendar({ showLoading: true })
        }
      } finally {
        activeTab.setValue(lastContentTab)
        setActionRunning(false)
      }
    })()
  }, [activeTab.value, lastContentTab, actionRunning, calendarRefreshing])

  async function refreshSystemState(): Promise<AdvancedCleanupSnapshot | void> {
    if (!AlarmManager.isAvailable) {
      setSystemAlarms([])
      return {
        items: [],
        diagnosticItems: [],
      }
    }
    try {
      const alarms = await AlarmManager.alarms()
      const storedState = loadCustomAlarmState()
      const latestSource = storedState.holidaySources[0]
      setHolidaySources((current) => (
        (latestSource?.lastSyncedAt ?? 0) > (current[0]?.lastSyncedAt ?? 0)
          ? storedState.holidaySources
          : current
      ))
      setSystemAlarms(alarms)
      const alarmMap = new Map(alarms.map((item) => [item.id, item]))
      let nextRecordsSnapshot: AlarmRecord[] = []
      setRecords((current) => {
        nextRecordsSnapshot = reconcileAlarmRecords(mergeStoredRecords(current, storedState.alarms), alarmMap)
        return nextRecordsSnapshot
      })
      const referencedIds = collectRecordSystemAlarmIds(nextRecordsSnapshot)
      const nextManagedIds = mergeManagedSystemAlarmIds(storedState.managedSystemAlarmIds, referencedIds)
      const orphanIds = nextManagedIds.filter((id) => !referencedIds.includes(id))
      const cleanupCandidateSet = new Set([
        ...storedState.cleanupCandidateAlarmIds,
        ...orphanIds,
      ])
      if (orphanIds.length) {
        await cancelManagedSystemAlarmIds(orphanIds)
      }
      const referencedIdSet = new Set(referencedIds)
      const nextCleanupCandidateIds = alarms
        .map((item) => item.id)
        .filter((id) => cleanupCandidateSet.has(id) && !referencedIdSet.has(id))
      setManagedSystemAlarmIds(referencedIds)
      setCleanupCandidateAlarmIds(nextCleanupCandidateIds)
      saveStateSnapshot(nextRecordsSnapshot, holidaySources, availableSounds, referencedIds, nextCleanupCandidateIds)
      return {
        items: buildAdvancedCleanupItems(alarms, nextRecordsSnapshot, nextCleanupCandidateIds),
        diagnosticItems: buildDiagnosticItems(alarms, nextRecordsSnapshot, referencedIds, nextCleanupCandidateIds),
      }
    } catch {
      return {
        items: buildAdvancedCleanupItems(systemAlarms, records, cleanupCandidateAlarmIds),
        diagnosticItems: buildDiagnosticItems(systemAlarms, records, managedSystemAlarmIds, cleanupCandidateAlarmIds),
      }
    }
  }

  async function openSystemAlarmSettings() {
    await Navigation.present({
      element: (
        <SystemAlarmSettingsView
          items={buildAdvancedCleanupItems()}
          diagnosticItems={buildDiagnosticItems()}
          onRefresh={refreshSystemState}
          onDeleteIds={deleteSystemAlarmIds}
        />
      ),
    })
  }

  async function upsertRecord(nextRecord: AlarmRecord) {
    setRecords((current) => {
      const exists = current.find((item) => item.id === nextRecord.id)
      const next = exists
        ? current.map((item) => (item.id === nextRecord.id ? nextRecord : item))
        : [...current, nextRecord]
      const nextManagedIds = mergeManagedSystemAlarmIds(managedSystemAlarmIds, collectRecordSystemAlarmIds(next))
      setManagedSystemAlarmIds(nextManagedIds)
      saveStateSnapshot(next, holidaySources, availableSounds, nextManagedIds, cleanupCandidateAlarmIds)
      return next
    })
  }

  async function addAlarm() {
    if (globalBusy || skipMutationInProgress.current) return
    const nextSounds = await refreshAvailableSounds({ showError: false })
    const draft = await Navigation.present<AlarmDraft>({
      element: (
        <AddAlarmView
          holidaySources={holidaySources}
          availableSounds={nextSounds}
          existingDrafts={records.map(toAlarmDraft)}
          mode="create"
        />
      ),
    })
    if (!draft) return

    if (records.some((item) => alarmDraftKey({
      title: item.title,
      snoozeMinutes: item.snoozeMinutes,
      soundName: item.soundName,
      repeatRule: item.repeatRule,
    }) === alarmDraftKey(draft))) {
      await Dialog.alert({ message: "闹钟已存在。" })
      return
    }

    if (!AlarmManager.isAvailable) {
      await Dialog.alert({ message: "当前系统不支持 AlarmManager。" })
      return
    }

    setGlobalBusy(true)
    setAlarmWriting(true)
    try {
      const baseRecord: AlarmRecord = {
        id: UUID.string(),
        title: draft.title,
        enabled: true,
        snoozeMinutes: draft.snoozeMinutes,
        soundName: draft.soundName,
        repeatRule: draft.repeatRule,
        completedOccurrences: 0,
        skippedOccurrences: [],
        systemAlarmIds: [],
        lastScheduledAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      const scheduled = await scheduleAlarm(baseRecord, holidaySourceMap)
      await upsertRecord(scheduled)
      await refreshSystemState()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
    } finally {
      setAlarmWriting(false)
      setGlobalBusy(false)
    }
  }

  async function applyHolidaySources(updatedSources: HolidayCalendarSource[]) {
    setHolidaySources(updatedSources)

    const holidaySourceMapAfterUpdate = new Map(updatedSources.map((item) => [item.id, item]))
    const affectedRecords = records.filter((item) => item.enabled && item.repeatRule.kind === "holiday")

    if (!affectedRecords.length || !AlarmManager.isAvailable) return

    const replacingIds = collectRecordSystemAlarmIds(affectedRecords)
    const nextCleanupCandidateIds = replacingIds.length
      ? markCleanupCandidates(replacingIds)
      : cleanupCandidateAlarmIds

    try {
      const updatedRecords: AlarmRecord[] = []
      for (const record of records) {
        if (record.repeatRule.kind !== "holiday" || !record.enabled) {
          updatedRecords.push(record)
          continue
        }
        if (!holidaySourceMapAfterUpdate.has(record.repeatRule.sourceId)) {
          updatedRecords.push(await disableAlarm(record, systemAlarmMap))
          continue
        }
        updatedRecords.push(await scheduleAlarm(record, holidaySourceMapAfterUpdate))
      }
      setRecords(updatedRecords)
      const nextManagedIds = mergeManagedSystemAlarmIds(managedSystemAlarmIds, collectRecordSystemAlarmIds(updatedRecords))
      setManagedSystemAlarmIds(nextManagedIds)
      saveStateSnapshot(updatedRecords, updatedSources, availableSounds, nextManagedIds, nextCleanupCandidateIds)
      await refreshSystemState()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
    }
  }

  async function editAlarm(record: AlarmRecord) {
    if (globalBusy || busyRecordId) return
    const nextSounds = await refreshAvailableSounds({ showError: false })
    const draft = await Navigation.present<AlarmDraft>({
      element: (
        <AddAlarmView
          holidaySources={holidaySources}
          availableSounds={nextSounds}
          existingDrafts={records.filter((item) => item.id !== record.id).map(toAlarmDraft)}
          mode="edit"
          initial={{
            title: record.title,
            snoozeMinutes: record.snoozeMinutes,
            soundName: record.soundName,
            repeatRule: record.repeatRule,
          }}
        />
      ),
    })
    if (!draft || !AlarmManager.isAvailable) return

    if (records.some((item) => {
      if (item.id === record.id) return false
      return alarmDraftKey({
        title: item.title,
        snoozeMinutes: item.snoozeMinutes,
        soundName: item.soundName,
        repeatRule: item.repeatRule,
      }) === alarmDraftKey(draft)
    })) {
      await Dialog.alert({ message: "闹钟已存在。" })
      return
    }

    setGlobalBusy(true)
    try {
      const nextCleanupCandidateIds = record.systemAlarmIds.length
        ? markCleanupCandidates(record.systemAlarmIds)
        : cleanupCandidateAlarmIds
      const optimisticRecord: AlarmRecord = {
        ...record,
        title: draft.title,
        snoozeMinutes: draft.snoozeMinutes,
        soundName: draft.soundName,
        repeatRule: draft.repeatRule,
        completedOccurrences: normalizeRepeatRule(record.repeatRule) === normalizeRepeatRule(draft.repeatRule)
          ? (record.completedOccurrences ?? 0)
          : 0,
        skippedOccurrences: normalizeRepeatRule(record.repeatRule) === normalizeRepeatRule(draft.repeatRule)
          ? record.skippedOccurrences
          : [],
        enabled: record.enabled,
        updatedAt: Date.now(),
      }
      const optimisticRecords = records.map((item) => (item.id === record.id ? optimisticRecord : item))
      setRecords(optimisticRecords)
      saveStateSnapshot(optimisticRecords, holidaySources, availableSounds, managedSystemAlarmIds, nextCleanupCandidateIds)

      const nextRecord = await scheduleAlarm(optimisticRecord, holidaySourceMap)
      const nextRecords = optimisticRecords.map((item) => (item.id === record.id ? nextRecord : item))
      setRecords(nextRecords)
      const nextManagedIds = mergeManagedSystemAlarmIds(managedSystemAlarmIds, collectRecordSystemAlarmIds(nextRecords))
      setManagedSystemAlarmIds(nextManagedIds)
      saveStateSnapshot(nextRecords, holidaySources, availableSounds, nextManagedIds, nextCleanupCandidateIds)
      await refreshSystemState()
    } catch (error: any) {
      const rollbackRecords = records.map((item) => (item.id === record.id ? record : item))
      setRecords(rollbackRecords)
      saveStateSnapshot(rollbackRecords, holidaySources, availableSounds, managedSystemAlarmIds, cleanupCandidateAlarmIds)
      await Dialog.alert({ message: String(error?.message ?? error) })
    } finally {
      setGlobalBusy(false)
    }
  }

  async function toggleAlarm(record: AlarmRecord, enabled: boolean) {
    if (!AlarmManager.isAvailable) {
      await Dialog.alert({ message: "当前系统不支持 AlarmManager。" })
      return
    }
    if (globalBusy || busyRecordId || skipMutationInProgress.current) return

    setBusyRecordId(record.id)
    try {
      const nextCleanupCandidateIds = !enabled && record.systemAlarmIds.length
        ? markCleanupCandidates(record.systemAlarmIds)
        : cleanupCandidateAlarmIds
      const optimisticRecord: AlarmRecord = {
        ...record,
        enabled,
        updatedAt: Date.now(),
      }
      const optimisticRecords = records.map((item) => (item.id === record.id ? optimisticRecord : item))
      setRecords(optimisticRecords)
      saveStateSnapshot(optimisticRecords, holidaySources, availableSounds, managedSystemAlarmIds, nextCleanupCandidateIds)

      const nextRecord = enabled
        ? await scheduleAlarm(optimisticRecord, holidaySourceMap)
        : await disableAlarm(record, systemAlarmMap)
      const nextRecords = optimisticRecords.map((item) => (item.id === record.id ? nextRecord : item))
      setRecords(nextRecords)
      const nextManagedIds = mergeManagedSystemAlarmIds(managedSystemAlarmIds, collectRecordSystemAlarmIds(nextRecords))
      setManagedSystemAlarmIds(nextManagedIds)
      saveStateSnapshot(nextRecords, holidaySources, availableSounds, nextManagedIds, nextCleanupCandidateIds)
      void refreshSystemState()
    } catch (error: any) {
      const rollbackRecords = records.map((item) => (item.id === record.id ? record : item))
      setRecords(rollbackRecords)
      saveStateSnapshot(rollbackRecords, holidaySources, availableSounds, managedSystemAlarmIds, cleanupCandidateAlarmIds)
      await Dialog.alert({ message: String(error?.message ?? error) })
    } finally {
      setBusyRecordId(null)
    }
  }

  async function changeSkippedAlarm(record: AlarmRecord, skipTimestamp: number | null) {
    if (!AlarmManager.isAvailable || globalBusy || busyRecordId || skipMutationInProgress.current) return
    const undo = skipTimestamp === null
    if (undo ? !pendingSkippedOccurrences(record, Date.now()).length : !canSkipAlarm(record)) return

    setBusyRecordId(record.id)
    skipMutationInProgress.current = true
    try {
      const currentAlarms = new Map((await AlarmManager.alarms()).map((alarm) => [alarm.id, alarm]))
      const now = Date.now()
      const latestRecord = alarmRecords.value.find((item) => item.id === record.id)
      if (latestRecord?.updatedAt !== record.updatedAt
        || record.systemAlarmIds.some((id) => currentAlarms.get(id)?.state !== "scheduled")) {
        throw new Error("当前闹钟状态已变化，请刷新后重试。")
      }

      if (skipTimestamp !== null) {
        const scheduled = nextAlarmForDisplay(
          [record], currentAlarms, (item) => nextOccurrenceTimestamp(item, holidaySourceMap, now), now
        )
        if (scheduled?.timestamp !== skipTimestamp) {
          throw new Error("下一次响铃时间已变化，请重试。")
        }
      }
      const changed = skipTimestamp === null
        ? undoSkippedOccurrence(record, now)
        : skipOccurrence(record, skipTimestamp, now)
      if (!changed) return

      const limit = "occurrenceLimit" in record.repeatRule ? record.repeatRule.occurrenceLimit : null
      const reachedLimit = typeof limit === "number" && (changed.completedOccurrences ?? 0) >= limit
      const nextCandidate = {
        ...changed,
        enabled: undo && !record.enabled && typeof limit === "number"
          && (record.completedOccurrences ?? 0) >= limit && !reachedLimit
          ? true
          : changed.enabled,
      }
      const nextTimestamp = nextOccurrenceTimestamp(nextCandidate, holidaySourceMap, now)
      if (nextCandidate.enabled && !nextTimestamp && !reachedLimit) {
        throw new Error("当前规则没有更晚的可安排日期，无法跳过这次闹钟。")
      }

      const nextRecord = !nextCandidate.enabled
        ? nextCandidate
        : nextTimestamp
          ? await scheduleAlarm(nextCandidate, holidaySourceMap)
          : { ...await disableAlarm(nextCandidate, currentAlarms), lastScheduledAt: null }
      const nextRecords = records.map((item) => item.id === record.id ? nextRecord : item)
      const nextManagedIds = mergeManagedSystemAlarmIds(managedSystemAlarmIds, collectRecordSystemAlarmIds(nextRecords))
      const nextCleanupCandidateIds = mergeManagedSystemAlarmIds(cleanupCandidateAlarmIds, record.systemAlarmIds)
      setRecords(nextRecords)
      setManagedSystemAlarmIds(nextManagedIds)
      setCleanupCandidateAlarmIds(nextCleanupCandidateIds)
      saveStateSnapshot(nextRecords, holidaySources, availableSounds, nextManagedIds, nextCleanupCandidateIds)
      await refreshSystemState()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
    } finally {
      skipMutationInProgress.current = false
      setBusyRecordId(null)
    }
  }

  function renderStatusTab() {
    return (
      <NavigationStack>
        <StatusView
          logicalAlarmCount={records.length}
          enabledCount={enabledCount}
          managedInstanceCount={managedInstanceCount}
          cleanupCandidateCount={cleanupCandidateAlarmIds.length}
          currentHolidayTitle={selectedHolidaySource?.title || ""}
          syncedHolidayCount={selectedHolidaySource?.holidayDates.length ?? 0}
          currentMonthTotalOffCount={currentMonthSummary.totalOff}
          currentMonthRemainingOffCount={currentMonthSummary.remainingOff}
          currentMonthTotalWorkCount={currentMonthSummary.totalWork}
          currentMonthRemainingWorkCount={currentMonthSummary.remainingWork}
          lastSyncedAt={selectedHolidaySource?.lastSyncedAt ?? null}
          availableSoundCount={Math.max(0, availableSounds.length - 1)}
          onOpenSoundSettings={() => {
            void openSoundSettings()
          }}
        />
      </NavigationStack>
    )
  }

  const previewTime = Date.now()
  const next = nextAlarmForDisplay(
    records,
    systemAlarmMap,
    (record) => nextOccurrenceTimestamp(record, holidaySourceMap, previewTime),
    previewTime
  )
  const skipTarget = next && canSkipAlarm(next.record) ? next : null
  const pending = records.flatMap((record) => {
    const timestamp = pendingSkippedOccurrences(record, previewTime).at(-1)
    return timestamp === undefined ? [] : [{ record, timestamp }]
  })
  const directUndo = pending.length === 1 && pending[0].record.id === next?.record.id
    ? pending[0].record : null
  const disablesHeaderActions = globalBusy || busyRecordId !== null

  function renderAlarmsTab() {
    return (
      <NavigationStack>
        <GradientPage>
          <List
            navigationTitle="闹钟"
            navigationBarTitleDisplayMode="large"
            listStyle="insetGroup"
            listSectionSpacing="compact"
            {...GRADIENT_SCROLL_APPEARANCE}
            toolbar={{
              topBarTrailing: (
                <Button
                  title=""
                  systemImage="gearshape"
                  accessibilityLabel="闹钟设置"
                  action={() => {
                    void openSystemAlarmSettings()
                  }}
                />
              ),
            }}
          >
            {!AlarmManager.isAvailable ? (
              <Text foregroundStyle="secondaryLabel">当前系统不支持 AlarmManager。</Text>
            ) : (
              <>
                <Section listSectionMargins={usesLiquidGlass ? 0 : undefined}>
                  <NextAlarmHeader
                    alarm={next ? { timestamp: next.timestamp, rule: next.record.repeatRule } : null}
                    now={previewTime}
                    actions={skipTarget || pending.length ? (
                      <VStack alignment="trailing" spacing={8}>
                        {skipTarget ? (
                          <Button
                            buttonStyle={usesLiquidGlass ? "glass" : "bordered"}
                            buttonBorderShape="capsule"
                            controlSize="large"
                            disabled={disablesHeaderActions}
                            action={() => changeSkippedAlarm(skipTarget.record, skipTarget.timestamp)}
                          >
                            <HeaderAlarmActionLabel title="跳过闹钟" accented />
                          </Button>
                        ) : null}
                        {directUndo ? (
                          <Button
                            buttonStyle={usesLiquidGlass ? "glass" : "bordered"}
                            buttonBorderShape="capsule"
                            controlSize="large"
                            disabled={disablesHeaderActions}
                            action={() => changeSkippedAlarm(directUndo, null)}
                          >
                            <HeaderAlarmActionLabel title="取消跳过" />
                          </Button>
                        ) : pending.length ? (
                          <Menu
                            label={
                              <HeaderAlarmActionLabel
                                title="取消跳过"
                                menuSurface={usesLiquidGlass ? "glass" : "standard"}
                              />
                            }
                            menuStyle="borderlessButton"
                            disabled={disablesHeaderActions}
                          >
                            {pending.map(({ record, timestamp }) => (
                              <Button
                                key={record.id}
                                title={`${record.title} · ${formatDateTime(timestamp)}`}
                                systemImage={ALARM_TYPE_SYMBOLS[record.repeatRule.kind]}
                                action={() => changeSkippedAlarm(record, null)}
                              />
                            ))}
                          </Menu>
                        ) : null}
                      </VStack>
                    ) : undefined}
                  />
                </Section>
                <Section header={<Text>我的闹钟</Text>}>
                  {records.length ? (
                    <ForEach
                      data={alarmRecords}
                      editActions="move"
                      builder={(record) => (
                        <VStack
                          key={record.id}
                          moveDisabled={globalBusy || busyRecordId !== null}
                          frame={{ maxWidth: "infinity", alignment: "leading" }}
                          {...GLASS_CARD_APPEARANCE}
                          clipShape={GLASS_CARD_SHAPE}
                          modifiers={ALARM_CARD_PREVIEW}
                          listRowInsets={{ top: 5, bottom: 5, leading: 0, trailing: 0 }}
                          listRowBackground={<EmptyView />}
                          listRowSeparator="hidden"
                          trailingSwipeActions={rowSwipeActions({
                            onEdit: () => {
                              void editAlarm(record)
                            },
                            onDelete: () => {
                              void removeAlarm(record)
                            },
                          })}
                        >
                          <AlarmRow
                            record={record}
                            subtitle={displaySubtitle(record, holidaySourceMap)}
                            nextDateText={nextOccurrenceDateLabel(record, holidaySourceMap)}
                            busy={globalBusy || busyRecordId === record.id}
                            onToggle={toggleAlarm}
                          />
                        </VStack>
                      )}
                    />
                  ) : (
                    <Text foregroundStyle="secondaryLabel">点击底部右侧按钮创建一个闹钟。</Text>
                  )}
                </Section>
              </>
            )}
          </List>
        </GradientPage>
      </NavigationStack>
    )
  }

  function renderCalendarsTab() {
    return (
      <NavigationStack>
        <CalendarSettingsView
          source={selectedHolidaySource}
          isRefreshing={calendarRefreshing}
        />
      </NavigationStack>
    )
  }

  async function removeAlarm(record: AlarmRecord) {
    if (globalBusy || busyRecordId) return
    setGlobalBusy(true)
    setAlarmDeleting(true)
    const nextCleanupCandidateIds = mergeManagedSystemAlarmIds(cleanupCandidateAlarmIds, record.systemAlarmIds)
    const nextRecords = records.filter((item) => item.id !== record.id)
    try {
      setRecords(nextRecords)
      setCleanupCandidateAlarmIds(nextCleanupCandidateIds)
      saveStateSnapshot(nextRecords, holidaySources, availableSounds, managedSystemAlarmIds, nextCleanupCandidateIds)

      await deleteAlarm(record, systemAlarmMap)
      await refreshSystemState()
    } catch (error: any) {
      setRecords(records)
      setCleanupCandidateAlarmIds(cleanupCandidateAlarmIds)
      saveStateSnapshot(records, holidaySources, availableSounds, managedSystemAlarmIds, cleanupCandidateAlarmIds)
      await Dialog.alert({ message: String(error?.message ?? error) })
    } finally {
      setAlarmDeleting(false)
      setGlobalBusy(false)
    }
  }

  async function deleteSystemAlarmIds(ids: string[]) {
    if (globalBusy || busyRecordId) return
    if (!ids.length) {
      return {
        items: buildAdvancedCleanupItems(systemAlarms, records, cleanupCandidateAlarmIds),
        diagnosticItems: buildDiagnosticItems(systemAlarms, records, managedSystemAlarmIds, cleanupCandidateAlarmIds),
      }
    }

    setGlobalBusy(true)
    try {
      await cancelManagedSystemAlarmIds(ids)

      const removedIdSet = new Set(ids)
      const nextRecords = records.map((record) => {
        const nextIds = record.systemAlarmIds.filter((id) => !removedIdSet.has(id))
        if (nextIds.length === record.systemAlarmIds.length) return record
        return {
          ...record,
          enabled: nextIds.length ? record.enabled : false,
          systemAlarmIds: nextIds,
          lastScheduledAt: nextIds.length ? record.lastScheduledAt : null,
          updatedAt: Date.now(),
        }
      })
      const nextManagedIds = managedSystemAlarmIds.filter((id) => !removedIdSet.has(id))
      const nextCleanupCandidateIds = cleanupCandidateAlarmIds.filter((id) => !removedIdSet.has(id))

      setRecords(nextRecords)
      setManagedSystemAlarmIds(nextManagedIds)
      setCleanupCandidateAlarmIds(nextCleanupCandidateIds)
      saveStateSnapshot(nextRecords, holidaySources, availableSounds, nextManagedIds, nextCleanupCandidateIds)
      const snapshot = await refreshSystemState()
      return snapshot
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
      return {
        items: buildAdvancedCleanupItems(systemAlarms, records, cleanupCandidateAlarmIds),
        diagnosticItems: buildDiagnosticItems(systemAlarms, records, managedSystemAlarmIds, cleanupCandidateAlarmIds),
      }
    } finally {
      setGlobalBusy(false)
    }
  }

  async function refreshStatusPanel() {
    if (busyRecordId) return
    await refreshAvailableSounds({ showError: false })
    await refreshSystemState()
  }

  async function refreshAvailableSounds(options?: { showError?: boolean }): Promise<string[]> {
    try {
      const nextSounds = await loadAvailableSoundNames()
      setAvailableSounds(nextSounds)
      saveStateSnapshot(records, holidaySources, nextSounds, managedSystemAlarmIds, cleanupCandidateAlarmIds)
      return nextSounds
    } catch (error: any) {
      if (options?.showError === false) return availableSounds
      await Dialog.alert({ message: String(error?.message ?? error) })
      return availableSounds
    }
  }

  function replaceSoundName(oldSound: string, newSound: string) {
    const nextSounds = availableSounds.map((sound) => (sound === oldSound ? newSound : sound))
    setAvailableSounds(nextSounds)
    setRecords((current) => {
      const nextRecords = current.map((record) => (
        record.soundName === oldSound
          ? { ...record, soundName: newSound, updatedAt: Date.now() }
          : record
      ))
      saveStateSnapshot(nextRecords, holidaySources, nextSounds, managedSystemAlarmIds, cleanupCandidateAlarmIds)
      return nextRecords
    })
  }

  function removeSoundName(sound: string) {
    const nextSounds = availableSounds.filter((item) => item !== sound)
    setAvailableSounds(nextSounds)
    setRecords((current) => {
      const nextRecords = current.map((record) => (
        record.soundName === sound
          ? { ...record, soundName: DEFAULT_SOUND_NAME, updatedAt: Date.now() }
          : record
      ))
      saveStateSnapshot(nextRecords, holidaySources, nextSounds, managedSystemAlarmIds, cleanupCandidateAlarmIds)
      return nextRecords
    })
  }

  async function openSoundSettings() {
    const nextSounds = await refreshAvailableSounds({ showError: false })
    await Navigation.present({
      element: (
        <SoundSettingsView
          sounds={nextSounds}
          onRefresh={refreshAvailableSounds}
          onSoundDeleted={removeSoundName}
          onSoundRenamed={replaceSoundName}
        />
      ),
    })
    await refreshAvailableSounds({ showError: false })
  }

  async function refreshBuiltinHolidayCalendar(options?: { showLoading?: boolean }) {
    if (busyRecordId) return
    const source = selectedHolidaySource
    if (!source) return

    if (options?.showLoading !== false) setCalendarRefreshing(true)
    try {
      const synced = await syncHolidayCalendarSource(source)
      const updatedSources = holidaySources.map((item) => (item.id === synced.id ? synced : item))
      await applyHolidaySources(updatedSources)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
    } finally {
      if (options?.showLoading !== false) setCalendarRefreshing(false)
    }
  }

  function accessoryIconName() {
    return lastContentTab === ALARMS_TAB ? "plus" : "arrow.clockwise"
  }

  return (
    <ZStack sheet={releaseNotesSheet}>
      <TabView
        selection={activeTab as any}
        tint="systemOrange"
        tabViewStyle={usesLiquidGlass ? "sidebarAdaptable" : "automatic"}
        tabBarMinimizeBehavior={usesLiquidGlass ? "onScrollDown" : undefined}
        tabViewSearchActivation={usesLiquidGlass ? "searchTabSelection" : undefined}
      >
        <Tab
          title="状态"
          systemImage="chart.bar.fill"
          value={STATUS_TAB}
        >
          {renderStatusTab()}
        </Tab>

        <Tab
          title="闹钟"
          systemImage="alarm.fill"
          value={ALARMS_TAB}
        >
          {renderAlarmsTab()}
        </Tab>

        <Tab
          title="日历"
          systemImage="calendar"
          value={CALENDARS_TAB}
        >
          {renderCalendarsTab()}
        </Tab>

        <Tab
          title={usesLiquidGlass ? "" : lastContentTab === ALARMS_TAB ? "添加" : "刷新"}
          systemImage={accessoryIconName()}
          value={ACTION_TAB}
          role={usesLiquidGlass ? "search" : undefined}
        >
          {lastContentTab === STATUS_TAB
            ? renderStatusTab()
            : lastContentTab === ALARMS_TAB
              ? renderAlarmsTab()
              : renderCalendarsTab()}
        </Tab>
      </TabView>

      {alarmWriting || alarmDeleting ? (
        <BlockingProgressOverlay message={alarmWriting ? "正在写入闹钟..." : "正在删除闹钟..."} />
      ) : null}
    </ZStack>
  )
}
