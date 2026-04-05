import {
  Button,
  ForEach,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Tab,
  TabView,
  Text,
  Toggle,
  VStack,
  modifiers,
  useEffect,
  useColorScheme,
  useMemo,
  useObservable,
  useState,
} from "scripting"

import type { AlarmDraft, AlarmRecord, HolidayCalendarSource } from "../types"
import { AddAlarmView } from "./AddAlarmView"
import { CalendarSettingsView } from "./CalendarSettingsView"
import { StatusView } from "./StatusView"
import { SystemAlarmSettingsView } from "./SystemAlarmSettingsView"
import {
  cancelManagedSystemAlarmIds,
  countExpectedRingsInYear,
  deleteAlarm,
  disableAlarm,
  displaySubtitle,
  displayTime,
  reconcileAlarmRecords,
  scheduleAlarm,
} from "../utils/alarm_runtime"
import { buildHolidayDayMap, syncHolidayCalendarSource } from "../utils/holiday_calendar"
import {
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
}

function isContentTab(value: RootTab): value is ContentTab {
  return value === STATUS_TAB || value === ALARMS_TAB || value === CALENDARS_TAB
}

function repeatIcon(record: AlarmRecord): string {
  switch (record.repeatRule.kind) {
    case "once":
      return "clock.badge"
    case "daily":
      return "repeat.circle.fill"
    case "weekly":
      return "calendar.badge.clock"
    case "monthly":
      return "calendar.circle.fill"
    case "holiday":
      return "flag.2.crossed.fill"
    case "custom":
      return "arrow.triangle.2.circlepath.circle.fill"
    default:
      return "alarm.fill"
  }
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

function AlarmRow(props: {
  record: AlarmRecord
  subtitle: string
  onToggle: (record: AlarmRecord, enabled: boolean) => void | Promise<void>
}) {
  const colorScheme = useColorScheme()

  return (
    <HStack
      spacing={14}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      padding={{ top: 16, bottom: 16, leading: 16, trailing: 16 }}
      modifiers={
        modifiers()
          .contentShape({
            kind: "interaction",
            shape: {
              type: "rect",
              cornerRadius: 22,
            },
          })
          .contentShape({
            kind: "dragPreview",
            shape: {
              type: "rect",
              cornerRadius: 22,
            },
          })
      }
      background={{
        style: colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground",
        shape: { type: "rect", cornerRadius: 22 },
      }}
      shadow={{
        color: colorScheme === "dark" ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.04)",
        radius: colorScheme === "dark" ? 0 : 12,
        y: colorScheme === "dark" ? 0 : 4,
      }}
    >
      <VStack
        frame={{ width: 30, alignment: "center" as any }}
        padding={{ top: 4 }}
      >
        <Image systemName={repeatIcon(props.record)} foregroundStyle="#FF9500" />
      </VStack>

      <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={4}>
        <Text
          font="title2"
          foregroundStyle={props.record.enabled ? "label" : "secondaryLabel"}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          {displayTime(props.record)}
        </Text>
        <Text
          font="subheadline"
          foregroundStyle={props.record.enabled ? "label" : "secondaryLabel"}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          {props.record.title}
        </Text>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          {props.subtitle}
        </Text>
      </VStack>

      <VStack frame={{ width: 56, alignment: "trailing" as any }}>
        <Toggle
          title=""
          value={props.record.enabled}
          onChanged={(value: boolean) => props.onToggle(props.record, value)}
          toggleStyle="switch"
        />
      </VStack>
    </HStack>
  )
}

export function HomeView() {
  const [initialState] = useState(() => loadCustomAlarmState())
  const [records, setRecords] = useState<AlarmRecord[]>(() => initialState.alarms)
  const [holidaySources, setHolidaySources] = useState<HolidayCalendarSource[]>(() => initialState.holidaySources)
  const [managedSystemAlarmIds, setManagedSystemAlarmIds] = useState<string[]>(() => initialState.managedSystemAlarmIds)
  const [cleanupCandidateAlarmIds, setCleanupCandidateAlarmIds] = useState<string[]>(() => initialState.cleanupCandidateAlarmIds)
  const [systemAlarms, setSystemAlarms] = useState<AlarmManager.Alarm[]>([])
  const [globalBusy, setGlobalBusy] = useState(false)
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null)
  const [calendarRefreshing, setCalendarRefreshing] = useState(false)
  const activeTab = useObservable<RootTab>(ALARMS_TAB)
  const [lastContentTab, setLastContentTab] = useState<ContentTab>(ALARMS_TAB)
  const [actionRunning, setActionRunning] = useState(false)

  const holidaySourceMap = useMemo(() => {
    return new Map(holidaySources.map((item) => [item.id, item]))
  }, [holidaySources])

  const enabledCount = useMemo(() => records.filter((item) => item.enabled).length, [records])
  const managedInstanceCount = useMemo(() => {
    return records.reduce((sum, item) => {
      return sum + countExpectedRingsInYear(item, holidaySourceMap)
    }, 0)
  }, [records, holidaySourceMap])
  const selectedHolidaySource = holidaySources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? holidaySources[0] ?? null
  const currentMonthSummary = useMemo(() => {
    if (!selectedHolidaySource) return { off: 0, work: 0 }

    const dayMap = buildHolidayDayMap(selectedHolidaySource)
    const now = new Date()
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-`
    let off = 0
    let work = 0

    for (const [dateKey, info] of dayMap.entries()) {
      if (!dateKey.startsWith(prefix)) continue
      if (info.kind === "off") off += 1
      if (info.kind === "work") work += 1
    }

    return { off, work }
  }, [selectedHolidaySource])

  function saveStateSnapshot(
    nextRecords: AlarmRecord[],
    nextHolidaySources = holidaySources,
    nextManagedSystemAlarmIds = managedSystemAlarmIds,
    nextCleanupCandidateAlarmIds = cleanupCandidateAlarmIds
  ) {
    saveCustomAlarmState({
      alarms: nextRecords,
      holidaySources: nextHolidaySources,
      managedSystemAlarmIds: nextManagedSystemAlarmIds,
      cleanupCandidateAlarmIds: nextCleanupCandidateAlarmIds,
    })
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

  useEffect(() => {
    saveCustomAlarmState({
      alarms: records,
      holidaySources,
      managedSystemAlarmIds,
      cleanupCandidateAlarmIds,
    })
  }, [records, holidaySources, managedSystemAlarmIds, cleanupCandidateAlarmIds])

  useEffect(() => {
    if (!AlarmManager.isAvailable) return

    const listener = () => {
      void refreshSystemState()
    }

    AlarmManager.addAlarmUpdateListener(listener)
    void refreshSystemState()

    return () => {
      AlarmManager.removeAlarmUpdateListener(listener)
    }
  }, [])

  useEffect(() => {
    const today = new Date()
    const isJanFirst = today.getMonth() === 0 && today.getDate() === 1
    if (!isJanFirst) return

    const source = holidaySources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? holidaySources[0] ?? null
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
      }
    }
    try {
      const storedState = loadCustomAlarmState()
      const alarms = await AlarmManager.alarms()
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
      if (orphanIds.length) {
        await cancelManagedSystemAlarmIds(orphanIds)
      }
      const cleanupCandidateSet = new Set(storedState.cleanupCandidateAlarmIds)
      const referencedIdSet = new Set(referencedIds)
      const nextCleanupCandidateIds = alarms
        .map((item) => item.id)
        .filter((id) => cleanupCandidateSet.has(id) && !referencedIdSet.has(id))
      setManagedSystemAlarmIds(referencedIds)
      setCleanupCandidateAlarmIds(nextCleanupCandidateIds)
      saveStateSnapshot(nextRecordsSnapshot, holidaySources, referencedIds, nextCleanupCandidateIds)
      return {
        items: buildAdvancedCleanupItems(alarms, nextRecordsSnapshot, nextCleanupCandidateIds),
      }
    } catch {
      return {
        items: buildAdvancedCleanupItems(systemAlarms, records, cleanupCandidateAlarmIds),
      }
    }
  }

  async function openSystemAlarmSettings() {
    await Navigation.present({
      element: (
        <SystemAlarmSettingsView
          items={buildAdvancedCleanupItems()}
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
      saveStateSnapshot(next, holidaySources, nextManagedIds, cleanupCandidateAlarmIds)
      return next
    })
  }

  function moveRecords(indices: number[], newOffset: number) {
    setRecords((current) => {
      const movingItems = indices.map((index) => current[index]).filter(Boolean)
      const next = current.filter((_, index) => !indices.includes(index))
      next.splice(newOffset, 0, ...movingItems)
      saveStateSnapshot(next, holidaySources, managedSystemAlarmIds, cleanupCandidateAlarmIds)
      return next
    })
  }

  async function addAlarm() {
    if (globalBusy) return
    const draft = await Navigation.present<AlarmDraft>({
      element: <AddAlarmView holidaySources={holidaySources} mode="create" />,
    })
    if (!draft) return

    if (!AlarmManager.isAvailable) {
      await Dialog.alert({ message: "当前系统不支持 AlarmManager。" })
      return
    }

    setGlobalBusy(true)
    try {
      const baseRecord: AlarmRecord = {
        id: UUID.string(),
        title: draft.title,
        enabled: true,
        snoozeMinutes: draft.snoozeMinutes,
        soundName: draft.soundName,
        repeatRule: draft.repeatRule,
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
      setGlobalBusy(false)
    }
  }

  async function applyHolidaySources(updatedSources: HolidayCalendarSource[], options?: { muteBusy?: boolean }) {
    // 节假日日历更新后，只重新排期受影响的节假日闹钟，避免把其他规则的闹钟也重排一遍。
    setHolidaySources(updatedSources)

    const holidaySourceMapAfterUpdate = new Map(updatedSources.map((item) => [item.id, item]))
    const affectedRecords = records.filter((item) => item.enabled && item.repeatRule.kind === "holiday")

    if (!affectedRecords.length || !AlarmManager.isAvailable) return

    if (!options?.muteBusy) setGlobalBusy(true)
    try {
      const updatedRecords: AlarmRecord[] = []
      for (const record of records) {
        if (record.repeatRule.kind !== "holiday" || !record.enabled) {
          updatedRecords.push(record)
          continue
        }
        if (!holidaySourceMapAfterUpdate.has(record.repeatRule.sourceId)) {
          updatedRecords.push(await disableAlarm(record))
          continue
        }
        updatedRecords.push(await scheduleAlarm(record, holidaySourceMapAfterUpdate))
      }
      setRecords(updatedRecords)
      const nextManagedIds = mergeManagedSystemAlarmIds(managedSystemAlarmIds, collectRecordSystemAlarmIds(updatedRecords))
      setManagedSystemAlarmIds(nextManagedIds)
      saveStateSnapshot(updatedRecords, updatedSources, nextManagedIds, cleanupCandidateAlarmIds)
      await refreshSystemState()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
    } finally {
      if (!options?.muteBusy) setGlobalBusy(false)
    }
  }

  async function editAlarm(record: AlarmRecord) {
    if (globalBusy || busyRecordId) return
    const draft = await Navigation.present<AlarmDraft>({
      element: (
        <AddAlarmView
          holidaySources={holidaySources}
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

    setGlobalBusy(true)
    try {
      const optimisticRecord: AlarmRecord = {
        ...record,
        title: draft.title,
        snoozeMinutes: draft.snoozeMinutes,
        soundName: draft.soundName,
        repeatRule: draft.repeatRule,
        enabled: record.enabled,
        updatedAt: Date.now(),
      }
      const optimisticRecords = records.map((item) => (item.id === record.id ? optimisticRecord : item))
      setRecords(optimisticRecords)
      saveStateSnapshot(optimisticRecords, holidaySources, managedSystemAlarmIds, cleanupCandidateAlarmIds)

      const nextRecord = await scheduleAlarm(optimisticRecord, holidaySourceMap)
      const nextRecords = optimisticRecords.map((item) => (item.id === record.id ? nextRecord : item))
      setRecords(nextRecords)
      const nextManagedIds = mergeManagedSystemAlarmIds(managedSystemAlarmIds, collectRecordSystemAlarmIds(nextRecords))
      setManagedSystemAlarmIds(nextManagedIds)
      saveStateSnapshot(nextRecords, holidaySources, nextManagedIds, cleanupCandidateAlarmIds)
      await refreshSystemState()
    } catch (error: any) {
      const rollbackRecords = records.map((item) => (item.id === record.id ? record : item))
      setRecords(rollbackRecords)
      saveStateSnapshot(rollbackRecords, holidaySources, managedSystemAlarmIds, cleanupCandidateAlarmIds)
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
    if (busyRecordId === record.id) return

    setBusyRecordId(record.id)
    try {
      const nextRecord = enabled
        ? await scheduleAlarm({
            ...record,
            enabled: true,
            updatedAt: Date.now(),
          }, holidaySourceMap)
        : await disableAlarm(record)
      const nextRecords = records.map((item) => (item.id === record.id ? nextRecord : item))
      setRecords(nextRecords)
      const nextManagedIds = mergeManagedSystemAlarmIds(managedSystemAlarmIds, collectRecordSystemAlarmIds(nextRecords))
      setManagedSystemAlarmIds(nextManagedIds)
      saveStateSnapshot(nextRecords, holidaySources, nextManagedIds, cleanupCandidateAlarmIds)
      await refreshSystemState()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
    } finally {
      setBusyRecordId(null)
    }
  }

  function renderStatusTab() {
    return (
      <NavigationStack>
        <StatusView
          embedded
          logicalAlarmCount={records.length}
          enabledCount={enabledCount}
          managedInstanceCount={managedInstanceCount}
          cleanupCandidateCount={cleanupCandidateAlarmIds.length}
          currentHolidayTitle={selectedHolidaySource?.title || ""}
          syncedHolidayCount={selectedHolidaySource?.holidayDates.length ?? 0}
          currentMonthOffCount={currentMonthSummary.off}
          currentMonthWorkCount={currentMonthSummary.work}
          lastSyncedAt={selectedHolidaySource?.lastSyncedAt ?? null}
        />
      </NavigationStack>
    )
  }

  function renderAlarmsTab() {
    return (
      <NavigationStack>
        <List
          navigationTitle="闹钟"
          navigationBarTitleDisplayMode="inline"
          listStyle="insetGroup"
          toolbar={{
            topBarTrailing: (
              <Button
                title=""
                systemImage="gearshape"
                action={() => {
                  void openSystemAlarmSettings()
                }}
              />
            ),
          }}
        >
          {!AlarmManager.isAvailable ? (
            <Text foregroundStyle="secondaryLabel">当前系统不支持 AlarmManager。</Text>
          ) : records.length ? (
            <ForEach
              count={records.length}
              onMove={moveRecords}
              itemBuilder={(index) => {
                const record = records[index]
                if (!record) return <Text> </Text>
                return (
                  <VStack
                    key={`${record.id}-${record.updatedAt}`}
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
                      onToggle={toggleAlarm}
                    />
                  </VStack>
                )
              }}
            />
          ) : (
            <Text foregroundStyle="secondaryLabel">点击底部右侧按钮创建一个闹钟。</Text>
          )}
        </List>
      </NavigationStack>
    )
  }

  function renderCalendarsTab() {
    return (
      <NavigationStack>
        <CalendarSettingsView
          embedded
          sources={holidaySources}
          isRefreshing={calendarRefreshing}
        />
      </NavigationStack>
    )
  }

  async function removeAlarm(record: AlarmRecord) {
    if (globalBusy || busyRecordId) return
    setGlobalBusy(true)
    try {
      const nextCleanupCandidateIds = mergeManagedSystemAlarmIds(cleanupCandidateAlarmIds, record.systemAlarmIds)
      setCleanupCandidateAlarmIds(nextCleanupCandidateIds)
      saveStateSnapshot(records, holidaySources, managedSystemAlarmIds, nextCleanupCandidateIds)

      // 先取消系统里已经注册的实例，再从首页记录里删掉它。
      await deleteAlarm(record)
      const nextRecords = records.filter((item) => item.id !== record.id)
      setRecords(nextRecords)
      saveStateSnapshot(nextRecords, holidaySources, managedSystemAlarmIds, nextCleanupCandidateIds)
      await refreshSystemState()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
    } finally {
      setGlobalBusy(false)
    }
  }

  async function deleteSystemAlarmIds(ids: string[]) {
    if (globalBusy || busyRecordId) return
    if (!ids.length) {
      return {
        items: buildAdvancedCleanupItems(systemAlarms, records, cleanupCandidateAlarmIds),
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
      saveStateSnapshot(nextRecords, holidaySources, nextManagedIds, nextCleanupCandidateIds)
      const snapshot = await refreshSystemState()
      return snapshot
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
      return {
        items: buildAdvancedCleanupItems(systemAlarms, records, cleanupCandidateAlarmIds),
      }
    } finally {
      setGlobalBusy(false)
    }
  }

  async function refreshStatusPanel() {
    if (busyRecordId) return
    await refreshSystemState()
  }

  async function refreshBuiltinHolidayCalendar(options?: { showLoading?: boolean }) {
    if (busyRecordId) return
    const source = holidaySources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? holidaySources[0] ?? null
    if (!source) return

    if (options?.showLoading !== false) setCalendarRefreshing(true)
    try {
      const synced = await syncHolidayCalendarSource(source)
      const updatedSources = holidaySources.map((item) => (item.id === synced.id ? synced : item))
      await applyHolidaySources(updatedSources, { muteBusy: true })
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
    <TabView
      selection={activeTab as any}
      tint="systemOrange"
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
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
        title=""
        systemImage={accessoryIconName()}
        value={ACTION_TAB}
        role="search"
      >
        {lastContentTab === STATUS_TAB
          ? renderStatusTab()
          : lastContentTab === ALARMS_TAB
            ? renderAlarmsTab()
            : renderCalendarsTab()}
      </Tab>
    </TabView>
  )
}
