import {
  BarChart,
  Button,
  Chart,
  GeometryReader,
  HStack,
  NavigationStack,
  Picker,
  ProgressView,
  ScrollView,
  ScrollViewReader,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
} from "scripting"
import { buildDashboardBundle, type DashboardDay } from "../data/dashboard"
import { DatePill, MetricTile, SoftCard } from "../components/common"
import { palette, scoreEmoji, scoreLabel, scoreTone, stageColor } from "../theme"
import type { SleepNight, SleepTrackerSettings, SleepTrackerSnapshot } from "../types"
import { DAILY_AROUND_TODAY_DAYS } from "../data/mock"
import {
  addDays,
  average,
  clamp,
  dateKeyFromDate,
  effectiveInBedMinutes,
  formatClockFromISO,
  formatHoursMinutes,
  formatMonthDayFromKey,
  formatPercent,
  formatUpdatedAt,
  sleepEfficiencyRatio,
  startOfDay,
  weekdayLabelFromKey,
} from "../utils"

function emptyStages() {
  return {
    inBed: 0,
    awake: 0,
    asleepUnspecified: 0,
    asleepCore: 0,
    asleepDeep: 0,
    asleepREM: 0,
  }
}

function placeholderDay(date: Date): DashboardDay {
  return {
    dateKey: dateKeyFromDate(date),
    dateISO: startOfDay(date).toISOString(),
    sleepNightKey: null,
    bedtimeISO: null,
    wakeISO: null,
    totalSleepMinutes: null,
    totalInBedMinutes: null,
    awakeMinutes: null,
    napMinutes: null,
    napCount: 0,
    sleepStages: emptyStages(),
    stepCount: null,
    activeEnergyKcal: null,
    moveGoalKcal: null,
    exerciseMinutes: null,
    exerciseGoalMinutes: null,
    standHours: null,
    standGoalHours: null,
    daylightMinutes: null,
    mindfulMinutes: null,
    apneaEvents: 0,
    avgHeartRate: null,
    restingHeartRate: null,
    hrvMs: null,
    respiratoryRate: null,
    oxygenSaturationPercent: null,
    wristTemperatureCelsius: null,
    sleepScore: null,
  }
}

function buildPlaceholderCalendarDays(count: number): DashboardDay[] {
  const today = startOfDay(new Date())
  return new Array(count).fill(null).map((_, index) => placeholderDay(addDays(today, -(count - 1 - index))))
}

function buildCenteredCalendarDays(days: DashboardDay[], today: Date): DashboardDay[] {
  const map = new Map(days.map((day) => [day.dateKey, day]))
  const items: DashboardDay[] = []

  for (let offset = -DAILY_AROUND_TODAY_DAYS; offset <= DAILY_AROUND_TODAY_DAYS; offset += 1) {
    const date = addDays(today, offset)
    const key = dateKeyFromDate(date)
    items.push(map.get(key) ?? placeholderDay(date))
  }

  return items
}

function buildPlaceholderStageRows() {
  return [
    { label: "清醒", minutes: null, ratio: 0, displayRatio: "--", tone: stageColor("awake") },
    { label: "眼动", minutes: null, ratio: 0, displayRatio: "--", tone: stageColor("asleepREM") },
    { label: "核心", minutes: null, ratio: 0, displayRatio: "--", tone: stageColor("asleepCore") },
    { label: "深度", minutes: null, ratio: 0, displayRatio: "--", tone: stageColor("asleepDeep") },
    { label: "恢复性", minutes: null, ratio: 0, displayRatio: "--", tone: palette.accent },
  ]
}

function sleepRatio(day: NonNullable<ReturnType<typeof buildDashboardBundle>>["latestDay"], minutes: number) {
  return clamp(minutes / Math.max(1, day?.totalSleepMinutes ?? 1), 0, 1)
}

function buildStageRows(day: NonNullable<ReturnType<typeof buildDashboardBundle>>["latestDay"]) {
  if (!day || !day.totalSleepMinutes) return []
  const restorativeMinutes = day.sleepStages.asleepDeep + day.sleepStages.asleepREM
  const awakeMinutes = Math.max(0, day.awakeMinutes ?? 0)
  const effectiveInBed = effectiveInBedMinutes(day.totalSleepMinutes, day.totalInBedMinutes, awakeMinutes)
  const awakeRatio = clamp(awakeMinutes / Math.max(1, effectiveInBed), 0, 1)

  return [
    {
      label: "清醒",
      minutes: awakeMinutes,
      ratio: awakeRatio,
      displayRatio: `${Math.round(awakeRatio * 100)}%`,
      tone: stageColor("awake"),
    },
    {
      label: "眼动",
      minutes: day.sleepStages.asleepREM,
      ratio: sleepRatio(day, day.sleepStages.asleepREM),
      displayRatio: `${Math.round(sleepRatio(day, day.sleepStages.asleepREM) * 100)}%`,
      tone: stageColor("asleepREM"),
    },
    {
      label: "核心",
      minutes: day.sleepStages.asleepCore,
      ratio: sleepRatio(day, day.sleepStages.asleepCore),
      displayRatio: `${Math.round(sleepRatio(day, day.sleepStages.asleepCore) * 100)}%`,
      tone: stageColor("asleepCore"),
    },
    {
      label: "深度",
      minutes: day.sleepStages.asleepDeep,
      ratio: sleepRatio(day, day.sleepStages.asleepDeep),
      displayRatio: `${Math.round(sleepRatio(day, day.sleepStages.asleepDeep) * 100)}%`,
      tone: stageColor("asleepDeep"),
    },
    {
      label: "恢复性",
      minutes: restorativeMinutes,
      ratio: sleepRatio(day, restorativeMinutes),
      displayRatio: `${Math.round(sleepRatio(day, restorativeMinutes) * 100)}%`,
      tone: palette.accent,
    },
  ]
}

function buildNightTimeline(night: SleepNight | null) {
  if (!night || !night.segments.length) return []
  const totalMinutes = Math.max(1, night.segments.reduce((sum, segment) => sum + segment.minutes, 0))

  return night.segments.map((segment) => ({
    id: segment.id,
    minutes: segment.minutes,
    width: `${(segment.minutes / totalMinutes) * 100}%`,
    tone: stageColor(segment.stage),
  }))
}

function buildDailyStageChartMarks(day: DashboardDay | null) {
  if (!day || !day.totalSleepMinutes) return []
  const restorative = day.sleepStages.asleepDeep + day.sleepStages.asleepREM
  return [
    { label: "清醒", value: Math.round(((day.awakeMinutes ?? 0) / 60) * 10) / 10, foregroundStyle: stageColor("awake"), width: { type: "ratio", value: 0.85 } },
    { label: "眼动", value: Math.round((day.sleepStages.asleepREM / 60) * 10) / 10, foregroundStyle: stageColor("asleepREM"), width: { type: "ratio", value: 0.85 } },
    { label: "核心", value: Math.round((day.sleepStages.asleepCore / 60) * 10) / 10, foregroundStyle: stageColor("asleepCore"), width: { type: "ratio", value: 0.85 } },
    { label: "深度", value: Math.round((day.sleepStages.asleepDeep / 60) * 10) / 10, foregroundStyle: stageColor("asleepDeep"), width: { type: "ratio", value: 0.85 } },
    { label: "恢复性", value: Math.round((restorative / 60) * 10) / 10, foregroundStyle: palette.accent, width: { type: "ratio", value: 0.85 } },
  ].filter((item) => item.value > 0)
}

type DailyStageFilter = "全部" | "清醒" | "眼动" | "核心" | "深度" | "恢复性"
const DAILY_STAGE_FILTERS: DailyStageFilter[] = ["全部", "清醒", "眼动", "核心", "深度", "恢复性"]

function filterDailyStageChartMarks(
  marks: Array<{ label: string; value: number; foregroundStyle: string }>,
  filter: DailyStageFilter
) {
  if (filter === "全部") return marks
  return marks.filter((item) => item.label === filter)
}

function buildDailyStageAxisValues(marks: Array<{ value: number }>) {
  const maxValue = Math.max(0.01, ...marks.map((item) => item.value))
  const ceiling =
    maxValue <= 0.25
      ? 0.25
      : maxValue <= 0.5
        ? 0.5
        : maxValue <= 0.75
          ? 0.75
          : maxValue <= 1
            ? 1
            : maxValue <= 2
              ? Math.ceil(maxValue * 2) / 2
              : Math.ceil(maxValue)
  return [ceiling, ceiling * 0.66, ceiling * 0.33, 0]
}

function formatStageAxisValue(value: number) {
  if (value <= 0) return "0"
  if (value < 1) return `${Math.round(value * 60)}m`
  if (Number.isInteger(value)) return `${value}h`
  return `${Math.round(value * 10) / 10}h`
}

function wrappedMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null
  const date = new Date(iso)
  let minutes = date.getHours() * 60 + date.getMinutes()
  if (minutes < 12 * 60) minutes += 24 * 60
  return minutes
}

function formatWrappedClock(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "-"
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440
  const hour = Math.floor(normalized / 60)
  const minute = normalized % 60
  return `${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}`
}

export function DailyTab(props: {
  isActive: boolean
  snapshot: SleepTrackerSnapshot | null
  settings: SleepTrackerSettings
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const dashboard = buildDashboardBundle(props.snapshot, props.settings, props.snapshot?.queryDays ?? 30)
  const today = startOfDay(new Date())
  const todayKey = dateKeyFromDate(today)
  const realDays = dashboard?.days.filter((day) => (day.totalSleepMinutes ?? 0) > 0) ?? []
  const calendarDays = buildCenteredCalendarDays(realDays.length ? realDays : buildPlaceholderCalendarDays(31), today)
  const [selectedKey, setSelectedKey] = useState<string | null>(todayKey)
  const [stageFilter, setStageFilter] = useState<DailyStageFilter>("全部")
  const scrollProxyRef = useRef<any>(null)

  useEffect(() => {
    const selectedIndex = calendarDays.findIndex((day) => day.dateKey === selectedKey)
    if (selectedIndex === -1) {
      setSelectedKey(todayKey)
    }
  }, [selectedKey, calendarDays, todayKey])

  useEffect(() => {
    if (!selectedKey || props.loading) return
    setTimeout(() => {
      scrollProxyRef.current?.scrollTo(selectedKey, "center")
    }, 50)
  }, [selectedKey, props.loading, calendarDays.length])

  useEffect(() => {
    if (props.loading) return
    setTimeout(() => {
      scrollProxyRef.current?.scrollTo(todayKey, "center")
    }, 50)
  }, [todayKey, props.loading, calendarDays.length])

  useEffect(() => {
    if (!props.isActive || props.loading) return
    setSelectedKey(todayKey)
    setTimeout(() => {
      scrollProxyRef.current?.scrollTo(todayKey, "center")
    }, 50)
  }, [props.isActive, todayKey, props.loading])

  const selectedDay =
    dashboard?.days.find((day) => day.dateKey === selectedKey) ??
    calendarDays.find((day) => day.dateKey === selectedKey) ??
    null
  const selectedNight =
    props.snapshot?.nights.find((night) => night.nightKey === selectedDay?.sleepNightKey) ?? null
  const stageRows = selectedDay?.totalSleepMinutes ? buildStageRows(selectedDay) : buildPlaceholderStageRows()
  const stageChartMarks = buildDailyStageChartMarks(selectedDay)
  const fullStageChartMarks =
    stageChartMarks.length
      ? stageChartMarks
      : buildPlaceholderStageRows().map((row) => ({
          label: row.label,
          value: Math.round(row.ratio * 80) / 10,
          foregroundStyle: row.tone,
        }))
  const visibleStageChartMarks = filterDailyStageChartMarks(stageChartMarks, stageFilter)
  const displayStageChartMarks =
    visibleStageChartMarks.length
      ? visibleStageChartMarks
      : buildPlaceholderStageRows().map((row) => ({
          label: row.label,
          value: Math.round(row.ratio * 80) / 10,
          foregroundStyle: row.tone,
        }))
  const stageAxisValues = buildDailyStageAxisValues(fullStageChartMarks)
  const timeline = buildNightTimeline(selectedNight)
  const restorativeMinutes =
    (selectedDay?.sleepStages.asleepDeep ?? 0) + (selectedDay?.sleepStages.asleepREM ?? 0)
  const restorativeRatio = selectedDay?.totalSleepMinutes
    ? restorativeMinutes / Math.max(1, selectedDay.totalSleepMinutes)
    : 0
  const restorativePercent = selectedDay?.totalSleepMinutes ? Math.round(restorativeRatio * 100) : null
  const restorativeTone =
    restorativePercent == null
      ? palette.line
      : restorativePercent >= 40
        ? palette.accentDeep
        : restorativePercent >= 30
          ? palette.sleepCore
          : restorativePercent >= 20
            ? palette.okay
            : palette.poor
  const regularityDays = realDays.filter((day) => day.bedtimeISO && day.wakeISO).slice(-7)
  const averageBedtime = average(
    regularityDays.map((day) => wrappedMinutes(day.bedtimeISO)).filter((value): value is number => value != null)
  )
  const averageWake = average(
    regularityDays.map((day) => wrappedMinutes(day.wakeISO)).filter((value): value is number => value != null)
  )

  return (
    <NavigationStack>
      <ScrollView navigationTitle="每日" navigationBarTitleDisplayMode="large">
        <VStack
          spacing={16}
          padding={16}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          background={{ style: palette.page } as any}
        >
          <SoftCard>
            <ScrollViewReader>
              {(scrollProxy) => {
                scrollProxyRef.current = scrollProxy

                return (
                  <ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity" }}>
                    <HStack spacing={8}>
                      {calendarDays.map((day) => (
                        <DatePill
                          key={day.dateKey}
                          id={day.dateKey}
                          labelTop={weekdayLabelFromKey(day.dateKey)}
                          labelBottom={day.dateKey.slice(-2)}
                          selected={day.dateKey === selectedDay?.dateKey}
                          onPress={() => setSelectedKey(day.dateKey)}
                        />
                      ))}
                    </HStack>
                  </ScrollView>
                )
              }}
            </ScrollViewReader>
            <HStack alignment="center">
              <Text font="caption" foregroundStyle={palette.mutedInk}>
                {props.loading ? "生成中…" : `更新于 ${dashboard ? formatUpdatedAt(props.snapshot?.generatedAtISO ?? "") : "--"}`}
              </Text>
              <Spacer />
              <Button
                title="今天"
                action={() => {
                  setSelectedKey(todayKey)
                  scrollProxyRef.current?.scrollTo(todayKey, "center")
                }}
              />
            </HStack>
            {props.error ? (
              <Text font="caption" foregroundStyle={palette.poor}>
                {props.error}
              </Text>
            ) : (null as any)}
            {props.loading && !dashboard ? <ProgressView progressViewStyle="circular" /> : (null as any)}
          </SoftCard>

          <SoftCard
            title="睡眠充能"
            subtitle={
              selectedDay?.bedtimeISO
                ? `${formatClockFromISO(selectedDay.bedtimeISO)} - ${formatClockFromISO(selectedDay.wakeISO)}`
                : "选择日期后显示当天的睡眠数据"
            }
            trailing={<Text font="title2">{scoreEmoji(selectedDay?.sleepScore ?? null)}</Text>}
          >
            <HStack alignment="bottom">
              <Text font={{ size: 72, weight: "light" } as any} foregroundStyle={scoreTone(selectedDay?.sleepScore ?? null) as any}>
                {selectedDay?.sleepScore == null ? "--" : `${selectedDay.sleepScore}%`}
              </Text>
              <Spacer />
              <Text font="headline" foregroundStyle={scoreTone(selectedDay?.sleepScore ?? null) as any}>
                {scoreLabel(selectedDay?.sleepScore ?? null)}
              </Text>
            </HStack>
            <ProgressView
              value={clamp((selectedDay?.sleepScore ?? 0) / 100, 0, 1)}
              total={1}
              progressViewStyle="linear"
              tint={(selectedDay?.sleepScore == null ? palette.line : scoreTone(selectedDay.sleepScore)) as any}
            />
          </SoftCard>

          <SoftCard title="睡眠总览">
            <HStack spacing={12}>
              <VStack
                spacing={6}
                padding={14}
                frame={{ maxWidth: "infinity", minHeight: 130, alignment: "leading" as any }}
                background={{ style: palette.cardSoft, shape: { type: "rect", cornerRadius: 18 } }}
              >
                <Text font="caption" foregroundStyle={palette.mutedInk} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  睡眠时长
                </Text>
                <Text font="title2" foregroundStyle={palette.sleepCore} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  {formatHoursMinutes(selectedDay?.totalSleepMinutes)}
                </Text>
                <Text font="caption2" foregroundStyle={palette.mutedInk} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  目标 {formatHoursMinutes(props.settings.sleepGoalMinutes)}
                </Text>
              </VStack>
              <VStack
                spacing={6}
                padding={14}
                frame={{ maxWidth: "infinity", minHeight: 130, alignment: "leading" as any }}
                background={{ style: palette.cardSoft, shape: { type: "rect", cornerRadius: 18 } }}
              >
                <Text font="caption" foregroundStyle={palette.mutedInk} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  恢复性睡眠
                </Text>
                <Text font="title2" foregroundStyle={restorativeTone} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  {formatHoursMinutes(restorativeMinutes)}
                </Text>
                <Text font="caption2" foregroundStyle={restorativeTone} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  {selectedDay?.totalSleepMinutes
                    ? `${Math.round((restorativeMinutes / Math.max(1, selectedDay.totalSleepMinutes)) * 100)}%`
                    : "--"}
                </Text>
                <ProgressView
                  value={selectedDay?.totalSleepMinutes ? restorativeMinutes / Math.max(1, selectedDay.totalSleepMinutes) : 0}
                  total={1}
                  progressViewStyle="linear"
                  tint={restorativeTone}
                />
              </VStack>
            </HStack>
          </SoftCard>

          <SoftCard title="作息时间">
            <HStack spacing={12}>
              <MetricTile label="入睡时间" value={formatClockFromISO(selectedDay?.bedtimeISO)} tone={palette.sleepCore} />
              <MetricTile label="起床时间" value={formatClockFromISO(selectedDay?.wakeISO)} tone={palette.okay} />
            </HStack>
          </SoftCard>

          <SoftCard
            title="睡眠阶段"
            subtitle={`睡眠效率 ${
              selectedDay?.totalSleepMinutes ? formatPercent(sleepEfficiencyRatio(selectedDay.totalSleepMinutes, selectedDay.totalInBedMinutes)) : "--"
            }`}
          >
            <Picker
              title="睡眠阶段筛选"
              pickerStyle="segmented"
              value={stageFilter}
              onChanged={(value: any) => setStageFilter(value as DailyStageFilter)}
            >
              {DAILY_STAGE_FILTERS.map((filter) => (
                <Text key={filter} tag={filter}>
                  {filter}
                </Text>
              ))}
            </Picker>

            <HStack alignment="top" spacing={10}>
              <VStack spacing={0}>
                {stageAxisValues.map((value) => (
                  <Text
                    key={value}
                    font="caption2"
                    foregroundStyle={palette.mutedInk}
                    frame={{ height: 44, alignment: "trailing" as any }}
                  >
                    {formatStageAxisValue(value)}
                  </Text>
                ))}
              </VStack>
              <VStack spacing={8} frame={{ width: "100%" as any, maxWidth: "infinity" as any }}>
                <Chart
                  frame={{ width: "100%" as any, height: 180 }}
                  chartLegend="hidden"
                  chartXAxis="hidden"
                  chartYAxis="hidden"
                  chartYScale={{ from: 0, to: stageAxisValues[0] ?? 1 } as any}
                >
                  <BarChart marks={displayStageChartMarks as any} />
                </Chart>
                <HStack alignment="top" spacing={12} frame={{ width: "100%" as any }}>
                  {displayStageChartMarks.map((item) => (
                    <Text
                      key={item.label}
                      font="caption2"
                      foregroundStyle={palette.mutedInk}
                      frame={{ maxWidth: "infinity", alignment: "center" as any }}
                    >
                      {item.label}
                    </Text>
                  ))}
                </HStack>
              </VStack>
            </HStack>

            <VStack spacing={8}>
              <HStack
                spacing={0}
                frame={{ width: "100%" as any, height: 16 }}
                background={{ style: palette.cardSoft, shape: { type: "rect", cornerRadius: 999 } }}
              >
                {timeline.length
                  ? timeline.filter((s) => s.minutes > 0).map((segment) => (
                      <HStack
                        key={segment.id}
                        frame={{ width: segment.width as any, height: 16 }}
                        background={{ style: segment.tone as any, shape: { type: "rect", cornerRadius: 999 } }}
                      />
                    ))
                  : stageRows.filter((r) => r.ratio > 0).map((row) => (
                      <HStack
                        key={row.label}
                        frame={{ width: `${row.ratio * 100}%` as any, height: 16 }}
                        background={{ style: row.tone as any, shape: { type: "rect", cornerRadius: 999 } }}
                      />
                    ))}
              </HStack>
              <HStack>
                <Text font="caption2" foregroundStyle={palette.mutedInk}>
                  {formatClockFromISO(selectedDay?.bedtimeISO)}
                </Text>
                <Spacer />
                <Text font="caption2" foregroundStyle={palette.mutedInk}>
                  {formatClockFromISO(selectedDay?.wakeISO)}
                </Text>
              </HStack>
            </VStack>

            {(stageRows.map((row) => (
              <HStack
                key={row.label}
                spacing={10}
                alignment="center"
                frame={{ width: "100%" as any, maxWidth: "infinity" as any, alignment: "leading" as any }}
              >
                <GeometryReader frame={{ maxWidth: "infinity" as any, height: 28 }}>
                  {({ size }: any) => {
                    const fillWidth = Math.max(0, Math.min(size.width, size.width * row.ratio))

                    return (
                      <ZStack frame={{ width: size.width, height: 28, alignment: "leading" as any }}>
                        <HStack
                          frame={{ width: size.width, height: 28 }}
                          background={{ style: palette.cardSoft, shape: { type: "rect", cornerRadius: 999 } }}
                        >
                          <Spacer />
                        </HStack>
                        <HStack frame={{ width: size.width, height: 28 }}>
                          <HStack
                            frame={{ width: fillWidth, height: 28 }}
                            background={{ style: row.tone as any, shape: { type: "rect", cornerRadius: 999 } }}
                          >
                            <Spacer />
                          </HStack>
                          <Spacer />
                        </HStack>
                        <Text
                          font="body"
                          foregroundStyle={palette.ink}
                          padding={{ horizontal: 12 }}
                          lineLimit={1}
                          frame={{ width: size.width, alignment: "leading" as any }}
                        >
                          {`${row.label} ${formatHoursMinutes(row.minutes as any)}`}
                        </Text>
                      </ZStack>
                    )
                  }}
                </GeometryReader>
                <Text font="body" foregroundStyle={row.tone as any} frame={{ width: 52, height: 28, alignment: "trailing" as any }}>
                  {row.displayRatio}
                </Text>
              </HStack>
            )) as any)}
          </SoftCard>

          <SoftCard title="睡眠规律" subtitle="最近 7 次睡眠的入睡和起床均值">
            <HStack spacing={12}>
              <MetricTile label="平均入睡" value={formatWrappedClock(averageBedtime)} tone={palette.sleepCore} />
              <MetricTile label="平均起床" value={formatWrappedClock(averageWake)} tone={palette.accentDeep} />
            </HStack>
          </SoftCard>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}
