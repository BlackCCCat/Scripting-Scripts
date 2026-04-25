import {
  BarChart,
  BarStackChart,
  Chart,
  GeometryReader,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Script,
  Widget,
  ZStack,
} from "scripting";

import {
  buildDashboardBundle,
  type DashboardBundle,
  type DashboardDay,
} from "./data/dashboard";
import { loadMockSleepTrackerSnapshot } from "./data/mock";
import {
  loadCachedSleepTrackerSnapshot,
  refreshSleepTrackerSnapshot,
} from "./data/health";
import { loadSleepTrackerSettings } from "./data/settings";
import { bedtimeEmoji, bedtimeTone, palette, scoreTone } from "./theme";
import {
  average,
  chunkArray,
  dateKeyFromDate,
  effectiveInBedMinutes,
  formatClockFromISO,
  formatHoursMinutes,
  formatShortDateFromKey,
  sleepEfficiencyPercent,
  startOfDay,
} from "./utils";

// ── Constants ──

const FRAME_FILL = {
  maxWidth: "infinity" as any,
  maxHeight: "infinity" as any,
  alignment: "topLeading" as any,
};
const BG_SMALL = {
  style: "systemBackground" as any,
  shape: { type: "rect" as const, cornerRadius: 22 },
};
const BG_LARGE = {
  style: "systemBackground" as any,
  shape: { type: "rect" as const, cornerRadius: 24 },
};
const CHART_HIDDEN = { chartLegend: "hidden" as const };
const WIDGET_QUERY_DAYS = 60;
const WIDGET_RELOAD_TIMES = [
  { hour: 5, minute: 30 },
  { hour: 7, minute: 30 },
  { hour: 9, minute: 30 },
  { hour: 12, minute: 30 },
  { hour: 18, minute: 30 },
];

// ── Helpers ──

function reloadDateAt(base: Date, hour: number, minute: number): Date {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    hour,
    minute,
  );
}

function nextReloadDate(now = new Date()): Date {
  for (const item of WIDGET_RELOAD_TIMES) {
    const candidate = reloadDateAt(now, item.hour, item.minute);
    if (candidate.getTime() > now.getTime() + 60 * 1000) {
      return candidate;
    }
  }

  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  const firstReload = WIDGET_RELOAD_TIMES[0];
  return reloadDateAt(tomorrow, firstReload.hour, firstReload.minute);
}

function reloadPolicy() {
  return {
    policy: "after" as const,
    date: nextReloadDate(),
  };
}

type WidgetResolvedData = {
  settings: ReturnType<typeof loadSleepTrackerSettings>;
  dashboard: DashboardBundle | null;
  today: DashboardDay | null;
  latest: DashboardDay | null;
};

let resolvedData: WidgetResolvedData | null = null;
let emptyMessage = "请在 App 中授权 Health，稍后 widget 会自动同步。";

function todayDashboardDay(
  dashboard: DashboardBundle | null,
): DashboardDay | null {
  if (!dashboard) return null;
  const todayKey = dateKeyFromDate(startOfDay(new Date()));
  const today = dashboard.days.find((day) => day.dateKey === todayKey) ?? null;
  return (today?.totalSleepMinutes ?? 0) > 0 ? today : null;
}

async function resolveWidgetData(): Promise<WidgetResolvedData> {
  const settings = loadSleepTrackerSettings();

  if (settings.useMockData) {
    const snapshot = loadMockSleepTrackerSnapshot();
    const dashboard = buildDashboardBundle(snapshot, settings, 30);
    return {
      settings,
      dashboard,
      today: todayDashboardDay(dashboard),
      latest: dashboard?.latestDay ?? null,
    };
  }

  let snapshot = null;
  try {
    snapshot = await refreshSleepTrackerSnapshot(WIDGET_QUERY_DAYS);
  } catch {
    snapshot = loadCachedSleepTrackerSnapshot();
  }

  const dashboard = buildDashboardBundle(snapshot, settings, 30);
  if (snapshot?.generatedAtISO) {
    emptyMessage = "暂无可展示的睡眠数据。";
  }

  return {
    settings,
    dashboard,
    today: todayDashboardDay(dashboard),
    latest: dashboard?.latestDay ?? null,
  };
}

function effLabel(day: DashboardDay): string {
  return `${Math.round(sleepEfficiencyPercent(day.totalSleepMinutes, day.totalInBedMinutes))}%`;
}

function inBedLabel(day: DashboardDay): string {
  return formatHoursMinutes(
    effectiveInBedMinutes(
      day.totalSleepMinutes,
      day.totalInBedMinutes,
      day.awakeMinutes,
    ),
  );
}

function wrappedMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  let m = d.getHours() * 60 + d.getMinutes();
  if (m < 12 * 60) m += 24 * 60;
  return m;
}

function RegularityRangeChart({
  days,
  themeCore,
}: {
  days: any[];
  themeCore: string;
}) {
  return (
    <GeometryReader
      frame={{ maxWidth: "infinity" as any, maxHeight: "infinity" as any }}
    >
      {({ size }: any) => {
        const textH = 14;
        const spacingY = 6;
        const h = size.height - textH - spacingY;
        const barW = Math.max(
          12,
          Math.min(24, Math.round((size.width - 40) / 7) - 6),
        );

        return (
          <HStack
            frame={{ width: size.width, height: size.height }}
            alignment="bottom"
            spacing={0}
          >
            {/* ── Y Axis ── */}
            <VStack
              frame={{ height: size.height, alignment: "trailing" as any }}
              spacing={0}
            >
              <VStack frame={{ height: h }} spacing={0}>
                <HStack frame={{ height: 10, alignment: "topTrailing" as any }}>
                  <Text font="caption2" foregroundStyle="tertiaryLabel">
                    22:00
                  </Text>
                </HStack>
                <Spacer />
                <HStack frame={{ height: 10, alignment: "trailing" as any }}>
                  <Text font="caption2" foregroundStyle="tertiaryLabel">
                    04:00
                  </Text>
                </HStack>
                <Spacer />
                <HStack
                  frame={{ height: 10, alignment: "bottomTrailing" as any }}
                >
                  <Text font="caption2" foregroundStyle="tertiaryLabel">
                    10:00
                  </Text>
                </HStack>
              </VStack>
              <VStack frame={{ height: textH + spacingY }} />
            </VStack>

            <Spacer minLength={8} />

            {/* ── Days Grid ── */}
            {days.map((day: any) => {
              const s = wrappedMinutes(day.bedtimeISO) ?? 22 * 60;
              const e = wrappedMinutes(day.wakeISO) ?? s + 60;
              const startM = Math.max(22 * 60, Math.min(34 * 60, s));
              const endM = Math.max(startM + 30, Math.min(34 * 60, e));
              const top = Math.round(((startM - 22 * 60) / (12 * 60)) * h);
              const fill = Math.max(
                4,
                Math.round(((endM - startM) / (12 * 60)) * h),
              );

              return (
                <VStack
                  key={day.dateKey}
                  spacing={spacingY}
                  frame={{
                    maxWidth: "infinity" as any,
                    alignment: "center" as any,
                  }}
                >
                  <VStack
                    frame={{ width: barW, height: h }}
                    background={
                      {
                        style: "tertiarySystemFill" as any,
                        shape: { type: "rect", cornerRadius: 4 },
                      } as any
                    }
                  >
                    <VStack frame={{ width: barW, height: top }} />
                    <VStack
                      frame={{ width: barW, height: fill }}
                      background={
                        {
                          style: themeCore as any,
                          shape: { type: "rect", cornerRadius: 4 },
                        } as any
                      }
                    />
                    <Spacer />
                  </VStack>
                  <Text
                    font="caption2"
                    foregroundStyle="tertiaryLabel"
                    lineLimit={1}
                    frame={{ height: textH }}
                  >
                    {formatShortDateFromKey(day.dateKey).replace("周", "")}
                  </Text>
                </VStack>
              );
            })}
          </HStack>
        );
      }}
    </GeometryReader>
  );
}

function formatWrappedClock(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "-";
  const n = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${`${Math.floor(n / 60)}`.padStart(2, "0")}:${`${n % 60}`.padStart(2, "0")}`;
}

function bedtimeSummary(days: DashboardDay[]) {
  const sleepDays = days.filter((day) => day.bedtimeISO);
  const bedtimeValues = sleepDays
    .map((day) => wrappedMinutes(day.bedtimeISO))
    .filter((value): value is number => value != null);
  return {
    avgBedtime: bedtimeValues.length ? average(bedtimeValues) : null,
    earliest: bedtimeValues.length ? Math.min(...bedtimeValues) : null,
    latest: bedtimeValues.length ? Math.max(...bedtimeValues) : null,
    earlyCount: bedtimeValues.filter((value) => value <= 23 * 60).length,
  };
}

function BedtimeStrip(props: {
  days: DashboardDay[];
  count: number;
  rows?: number;
}) {
  const items = props.days.slice(-props.count);
  const rows = Math.max(1, props.rows ?? 1);
  const chunks = chunkArray(items, Math.ceil(items.length / rows));
  return (
    <VStack
      spacing={8}
      frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
    >
      {chunks.map((row, rowIndex) => (
        <HStack
          key={rowIndex}
          spacing={8}
          frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
        >
          {row.map((day) => (
            <VStack
              key={day.dateKey}
              spacing={4}
              frame={{
                maxWidth: "infinity" as any,
                alignment: "center" as any,
              }}
            >
              <Text
                font="caption2"
                foregroundStyle="secondaryLabel"
                lineLimit={1}
              >
                {formatShortDateFromKey(day.dateKey)}
              </Text>
              <Text
                font={{ size: 22 } as any}
                frame={{ width: 34, height: 34, alignment: "center" as any }}
                background={
                  {
                    style: bedtimeTone(wrappedMinutes(day.bedtimeISO)) as any,
                    shape: { type: "rect", cornerRadius: 17 },
                  } as any
                }
              >
                {day.bedtimeISO
                  ? bedtimeEmoji(wrappedMinutes(day.bedtimeISO))
                  : "—"}
              </Text>
              <Text
                font="caption2"
                foregroundStyle="secondaryLabel"
                lineLimit={1}
              >
                {day.bedtimeISO ? formatClockFromISO(day.bedtimeISO) : "--"}
              </Text>
            </VStack>
          ))}
        </HStack>
      ))}
    </VStack>
  );
}

// ── Empty Widget ──

function EmptyWidget(props: { message?: string } = {}) {
  return (
    <VStack
      padding={14}
      spacing={8}
      frame={FRAME_FILL}
      widgetBackground={BG_SMALL}
    >
      <Text font="headline">Sleep Tracker</Text>
      <Spacer />
      <Text font="footnote" foregroundStyle="secondaryLabel">
        {props.message ?? emptyMessage}
      </Text>
    </VStack>
  );
}

// ══════════════════════════════════════
//  SMALL WIDGETS  (daily data, SF symbols, no charts)
// ══════════════════════════════════════

function SmallWidget() {
  const data = resolvedData;
  const settings = data?.settings;
  const dashboard = data?.dashboard ?? null;
  const latest = data?.today ?? null;

  if (!settings || !dashboard || !latest) {
    return <EmptyWidget message="暂无昨晚到今早的睡眠数据。" />;
  }

  const style = settings.widgetStyleSmall;

  // ── Schedule + Regularity ──
  if (style === "schedule") {
    const recentDays = dashboard.days
      .filter((d) => d.bedtimeISO && d.wakeISO)
      .slice(-7);
    const bedtimeValues = recentDays
      .map((d) => wrappedMinutes(d.bedtimeISO))
      .filter((v): v is number => v != null);
    const avgBedtime = bedtimeValues.length ? average(bedtimeValues) : null;
    const wakeValues = recentDays
      .map((d) => wrappedMinutes(d.wakeISO))
      .filter((v): v is number => v != null);
    const avgWake = wakeValues.length ? average(wakeValues) : null;
    const stddev =
      bedtimeValues.length >= 2
        ? Math.sqrt(
            bedtimeValues
              .map((v) => (v - average(bedtimeValues)) ** 2)
              .reduce((a, b) => a + b, 0) / bedtimeValues.length,
          )
        : null;
    const regLabel =
      stddev != null
        ? stddev <= 15
          ? "非常规律"
          : stddev <= 30
            ? "较规律"
            : stddev <= 45
              ? "一般"
              : "不规律"
        : null;
    return (
      <VStack
        padding={14}
        spacing={0}
        frame={FRAME_FILL}
        widgetBackground={BG_SMALL}
      >
        {/* ── Header ── */}
        <HStack
          frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
        >
          <HStack frame={{ width: 24, alignment: "center" as any }}>
            <Image
              systemName="clock.arrow.circlepath"
              font={{ size: 14, weight: "bold" } as any}
              foregroundStyle={palette.sleepCore as any}
            />
          </HStack>
          {regLabel ? (
            <Text
              font={{ size: 14, weight: "bold" } as any}
              foregroundStyle={palette.accentDeep as any}
            >
              {regLabel}
            </Text>
          ) : (
            <Text
              font={{ size: 14, weight: "bold" } as any}
              foregroundStyle="secondaryLabel"
            >
              暂无规律
            </Text>
          )}
          <Spacer />
        </HStack>

        <Spacer />

        {/* ── Today's times ── */}
        <VStack spacing={12} frame={{ maxWidth: "infinity" as any }}>
          <HStack
            frame={{ maxWidth: "infinity" as any, alignment: "center" as any }}
          >
            <HStack frame={{ width: 24, alignment: "center" as any }}>
              <Image
                systemName="bed.double.fill"
                font="body"
                foregroundStyle={palette.sleepCore as any}
              />
            </HStack>
            <Text
              font={{ size: 15, weight: "medium" } as any}
              foregroundStyle="secondaryLabel"
            >
              入睡
            </Text>
            <Spacer />
            <Text
              font={{ size: 24, weight: "bold", design: "rounded" } as any}
              foregroundStyle="label"
            >
              {formatClockFromISO(latest.bedtimeISO)}
            </Text>
          </HStack>
          <HStack
            frame={{ maxWidth: "infinity" as any, alignment: "center" as any }}
          >
            <HStack frame={{ width: 24, alignment: "center" as any }}>
              <Image
                systemName="sun.max.fill"
                font="body"
                foregroundStyle={palette.okay as any}
              />
            </HStack>
            <Text
              font={{ size: 15, weight: "medium" } as any}
              foregroundStyle="secondaryLabel"
            >
              起床
            </Text>
            <Spacer />
            <Text
              font={{ size: 24, weight: "bold", design: "rounded" } as any}
              foregroundStyle="label"
            >
              {formatClockFromISO(latest.wakeISO)}
            </Text>
          </HStack>
        </VStack>

        <Spacer />

        {/* ── 7-day average ── */}
        <HStack
          frame={{ maxWidth: "infinity" as any, alignment: "center" as any }}
        >
          <Text font="caption2" foregroundStyle="tertiaryLabel">
            七日均值
          </Text>
          <Spacer />
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {formatWrappedClock(avgBedtime)} - {formatWrappedClock(avgWake)}
          </Text>
        </HStack>
      </VStack>
    );
  }

  // ── Score + Overview (default) ──
  const deepPct = Math.round(
    (latest.sleepStages.asleepDeep /
      Math.max(1, latest.totalSleepMinutes ?? 1)) *
      100,
  );
  return (
    <VStack
      padding={14}
      spacing={6}
      frame={FRAME_FILL}
      widgetBackground={BG_SMALL}
    >
      {/* ── Score Row ── */}
      <VStack
        spacing={8}
        frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
      >
        <HStack spacing={6} frame={{ maxWidth: "infinity" as any }}>
          <HStack frame={{ width: 22, alignment: "center" as any }}>
            <Image
              systemName="star.fill"
              font="subheadline"
              foregroundStyle={scoreTone(latest.sleepScore) as any}
            />
          </HStack>
          <Text font="subheadline" foregroundStyle="secondaryLabel">
            评分
          </Text>
          <Spacer />
          <Text
            font={{ size: 16, weight: "bold", design: "rounded" } as any}
            foregroundStyle={scoreTone(latest.sleepScore) as any}
          >
            {latest.sleepScore ?? "--"}
          </Text>
        </HStack>
        <GeometryReader frame={{ maxWidth: "infinity" as any, height: 10 }}>
          {({ size }: any) => {
            const ratio = latest.sleepScore
              ? Math.min(Math.max(latest.sleepScore / 100, 0), 1)
              : 0;
            return (
              <ZStack frame={{ width: size.width, height: 10 }}>
                <HStack
                  frame={{ width: size.width, height: 10 }}
                  background={
                    {
                      style: "tertiarySystemFill" as any,
                      shape: { type: "rect", cornerRadius: 0 },
                    } as any
                  }
                />
                <HStack spacing={0} frame={{ width: size.width, height: 10 }}>
                  <HStack
                    frame={{ width: size.width * ratio, height: 10 }}
                    background={
                      {
                        style: scoreTone(latest.sleepScore) as any,
                        shape: { type: "rect", cornerRadius: 0 },
                      } as any
                    }
                  />
                  <Spacer minLength={0} />
                </HStack>
              </ZStack>
            );
          }}
        </GeometryReader>
      </VStack>

      <Spacer />

      {/* ── 3 Metrics Rows ── */}
      <VStack
        spacing={8}
        frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
      >
        <HStack frame={{ maxWidth: "infinity" as any }}>
          <HStack spacing={6}>
            <HStack frame={{ width: 22, alignment: "center" as any }}>
              <Image
                systemName="clock.fill"
                font="subheadline"
                foregroundStyle={palette.sleepCore as any}
              />
            </HStack>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              时间
            </Text>
          </HStack>
          <Spacer />
          <Text
            font={{ size: 14, weight: "semibold" } as any}
            foregroundStyle="label"
          >
            {formatHoursMinutes(latest.totalSleepMinutes)}
          </Text>
        </HStack>

        <HStack frame={{ maxWidth: "infinity" as any }}>
          <HStack spacing={6}>
            <HStack frame={{ width: 22, alignment: "center" as any }}>
              <Image
                systemName="brain.head.profile"
                font="subheadline"
                foregroundStyle={palette.sleepDeep as any}
              />
            </HStack>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              深睡
            </Text>
          </HStack>
          <Spacer />
          <Text
            font={{ size: 14, weight: "semibold" } as any}
            foregroundStyle="label"
          >
            {formatHoursMinutes(latest.sleepStages.asleepDeep)}
          </Text>
        </HStack>

        <HStack frame={{ maxWidth: "infinity" as any }}>
          <HStack spacing={6}>
            <HStack frame={{ width: 22, alignment: "center" as any }}>
              <Image
                systemName="bed.double.fill"
                font="subheadline"
                foregroundStyle={palette.accentDeep as any}
              />
            </HStack>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              在床
            </Text>
          </HStack>
          <Spacer />
          <Text
            font={{ size: 14, weight: "semibold" } as any}
            foregroundStyle="label"
          >
            {inBedLabel(latest)}
          </Text>
        </HStack>
      </VStack>
    </VStack>
  );
}

// ══════════════════════════════════════
//  MEDIUM WIDGETS  (trend charts, compact)
// ══════════════════════════════════════

function MediumWidget() {
  const data = resolvedData;
  const settings = data?.settings;
  const dashboard = data?.dashboard ?? null;
  const latest = data?.latest ?? null;

  if (!settings || !dashboard || !latest) return <EmptyWidget />;

  const style = settings.widgetStyleMedium;
  const chartFrame = {
    maxWidth: "infinity" as any,
    maxHeight: "infinity" as any,
  };

  // ── Stages ──
  if (style === "stages") {
    return (
      <VStack
        padding={12}
        spacing={6}
        frame={FRAME_FILL}
        widgetBackground={BG_SMALL}
      >
        <HStack>
          <HStack spacing={4}>
            <Image
              systemName="chart.bar.fill"
              font="caption"
              foregroundStyle={palette.sleepDeep as any}
            />
            <Text font="caption" foregroundStyle="secondaryLabel">
              睡眠阶段
            </Text>
          </HStack>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel">
            {formatHoursMinutes(latest.totalSleepMinutes)}
          </Text>
        </HStack>
        <Chart frame={chartFrame} {...CHART_HIDDEN}>
          <BarStackChart marks={dashboard.stageStackMarks.slice(-28) as any} />
        </Chart>
      </VStack>
    );
  }

  // ── Regularity ──
  if (style === "regularity") {
    const sleepDays = dashboard.days
      .filter(
        (d) => d.bedtimeISO && d.wakeISO && (d.totalSleepMinutes ?? 0) > 0,
      )
      .slice(-7);
    const bedtimeValues = sleepDays
      .map((d) => wrappedMinutes(d.bedtimeISO))
      .filter((v): v is number => v != null);
    const wakeValues = sleepDays
      .map((d) => wrappedMinutes(d.wakeISO))
      .filter((v): v is number => v != null);
    const avgBedtime = bedtimeValues.length ? average(bedtimeValues) : null;
    const avgWake = wakeValues.length ? average(wakeValues) : null;
    return (
      <VStack
        padding={12}
        spacing={6}
        frame={FRAME_FILL}
        widgetBackground={BG_SMALL}
      >
        <HStack>
          <HStack spacing={4}>
            <Image
              systemName="calendar.badge.clock"
              font="caption"
              foregroundStyle={palette.sleepCore as any}
            />
            <Text font="caption" foregroundStyle="secondaryLabel">
              睡眠规律
            </Text>
          </HStack>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            入睡 {formatWrappedClock(avgBedtime)} · 起床{" "}
            {formatWrappedClock(avgWake)}
          </Text>
        </HStack>
        <RegularityRangeChart
          days={sleepDays}
          themeCore={palette.sleepCore as string}
        />
      </VStack>
    );
  }

  if (style === "bedtime") {
    const recentDays = dashboard.days.slice(-5);
    const sleepDays = dashboard.days.filter(
      (d) => (d.totalSleepMinutes ?? 0) > 0,
    );
    const summary = bedtimeSummary(sleepDays);
    return (
      <VStack
        padding={12}
        spacing={8}
        frame={FRAME_FILL}
        widgetBackground={BG_SMALL}
      >
        <HStack>
          <HStack spacing={4}>
            <Image
              systemName="moon.stars.fill"
              font="caption"
              foregroundStyle={palette.okay as any}
            />
            <Text font="caption" foregroundStyle="secondaryLabel">
              入睡时间
            </Text>
          </HStack>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel">
            23:00前 {summary.earlyCount}次
          </Text>
        </HStack>
        <HStack spacing={8}>
          <VStack
            spacing={2}
            padding={10}
            frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
            background={
              {
                style: "tertiarySystemFill" as any,
                shape: { type: "rect", cornerRadius: 16 },
              } as any
            }
          >
            <Text
              font="caption2"
              foregroundStyle="secondaryLabel"
              frame={{
                maxWidth: "infinity" as any,
                alignment: "leading" as any,
              }}
            >
              平均入睡
            </Text>
            <Text
              font={{ size: 22, weight: "bold", design: "rounded" } as any}
              foregroundStyle={palette.sleepCore as any}
              frame={{
                maxWidth: "infinity" as any,
                alignment: "leading" as any,
              }}
            >
              {formatWrappedClock(summary.avgBedtime)}
            </Text>
          </VStack>
          <VStack
            spacing={2}
            padding={10}
            frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
            background={
              {
                style: "tertiarySystemFill" as any,
                shape: { type: "rect", cornerRadius: 16 },
              } as any
            }
          >
            <Text
              font="caption2"
              foregroundStyle="secondaryLabel"
              frame={{
                maxWidth: "infinity" as any,
                alignment: "leading" as any,
              }}
            >
              最早 / 最晚
            </Text>
            <Text
              font={{ size: 18, weight: "bold", design: "rounded" } as any}
              foregroundStyle={palette.okay as any}
              lineLimit={1}
              frame={{
                maxWidth: "infinity" as any,
                alignment: "leading" as any,
              }}
            >
              {`${formatWrappedClock(summary.earliest)} / ${formatWrappedClock(summary.latest)}`}
            </Text>
          </VStack>
        </HStack>
        <BedtimeStrip days={recentDays} count={5} />
      </VStack>
    );
  }

  // ── Duration (default) ──
  return (
    <VStack
      padding={12}
      spacing={6}
      frame={FRAME_FILL}
      widgetBackground={BG_SMALL}
    >
      <HStack>
        <HStack spacing={4}>
          <Image
            systemName="moon.zzz.fill"
            font="caption"
            foregroundStyle={palette.sleepCore as any}
          />
          <Text font="caption" foregroundStyle="secondaryLabel">
            睡眠时长
          </Text>
        </HStack>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">
          均 {formatHoursMinutes(dashboard.averageSleepMinutes)} · 目标{" "}
          {dashboard.goalHours}h
        </Text>
      </HStack>
      <Chart frame={chartFrame} {...CHART_HIDDEN}>
        <BarChart marks={dashboard.durationTrendMarks.slice(-7) as any} />
      </Chart>
    </VStack>
  );
}

// ══════════════════════════════════════
//  LARGE WIDGETS  (trend charts, compact)
// ══════════════════════════════════════

function LargeWidget() {
  const data = resolvedData;
  const settings = data?.settings;
  const dashboard = data?.dashboard ?? null;
  const latest = data?.latest ?? null;

  if (!settings || !dashboard || !latest) return <EmptyWidget />;

  const style = settings.widgetStyleLarge;
  const chartFrame = {
    maxWidth: "infinity" as any,
    maxHeight: "infinity" as any,
  };

  // ── Stages ──
  if (style === "stages") {
    return (
      <VStack
        padding={16}
        spacing={8}
        frame={FRAME_FILL}
        widgetBackground={BG_LARGE}
      >
        <HStack>
          <HStack spacing={4}>
            <Image
              systemName="chart.bar.fill"
              font="subheadline"
              foregroundStyle={palette.sleepDeep as any}
            />
            <Text font="subheadline">睡眠阶段</Text>
          </HStack>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel">
            最近一晚 {formatHoursMinutes(latest.totalSleepMinutes)}
          </Text>
        </HStack>
        <Chart frame={chartFrame} {...CHART_HIDDEN}>
          <BarStackChart marks={dashboard.stageStackMarks.slice(-28) as any} />
        </Chart>
        <HStack>
          <HStack spacing={3}>
            <VStack
              frame={{ width: 8, height: 8 }}
              background={
                {
                  style: palette.sleepDeep,
                  shape: { type: "rect", cornerRadius: 2 },
                } as any
              }
            />
            <Text font="caption2" foregroundStyle="secondaryLabel">
              深睡
            </Text>
          </HStack>
          <Spacer />
          <HStack spacing={3}>
            <VStack
              frame={{ width: 8, height: 8 }}
              background={
                {
                  style: palette.sleepCore,
                  shape: { type: "rect", cornerRadius: 2 },
                } as any
              }
            />
            <Text font="caption2" foregroundStyle="secondaryLabel">
              核心
            </Text>
          </HStack>
          <Spacer />
          <HStack spacing={3}>
            <VStack
              frame={{ width: 8, height: 8 }}
              background={
                {
                  style: palette.sleepREM,
                  shape: { type: "rect", cornerRadius: 2 },
                } as any
              }
            />
            <Text font="caption2" foregroundStyle="secondaryLabel">
              REM
            </Text>
          </HStack>
          <Spacer />
          <HStack spacing={3}>
            <VStack
              frame={{ width: 8, height: 8 }}
              background={
                {
                  style: palette.awake,
                  shape: { type: "rect", cornerRadius: 2 },
                } as any
              }
            />
            <Text font="caption2" foregroundStyle="secondaryLabel">
              清醒
            </Text>
          </HStack>
        </HStack>
      </VStack>
    );
  }

  // ── Regularity ──
  if (style === "regularity") {
    const sleepDays = dashboard.days
      .filter(
        (d) => d.bedtimeISO && d.wakeISO && (d.totalSleepMinutes ?? 0) > 0,
      )
      .slice(-7);
    const bedtimeValues = sleepDays
      .map((d) => wrappedMinutes(d.bedtimeISO))
      .filter((v): v is number => v != null);
    const wakeValues = sleepDays
      .map((d) => wrappedMinutes(d.wakeISO))
      .filter((v): v is number => v != null);
    const avgBedtime = bedtimeValues.length ? average(bedtimeValues) : null;
    const avgWake = wakeValues.length ? average(wakeValues) : null;
    return (
      <VStack
        padding={16}
        spacing={8}
        frame={FRAME_FILL}
        widgetBackground={BG_LARGE}
      >
        <HStack>
          <HStack spacing={4}>
            <Image
              systemName="calendar.badge.clock"
              font="subheadline"
              foregroundStyle={palette.sleepCore as any}
            />
            <Text font="subheadline">睡眠规律</Text>
          </HStack>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            入睡 {formatWrappedClock(avgBedtime)} · 起床{" "}
            {formatWrappedClock(avgWake)}
          </Text>
        </HStack>
        <RegularityRangeChart
          days={sleepDays}
          themeCore={palette.sleepCore as string}
        />
      </VStack>
    );
  }

  if (style === "bedtime") {
    const recentDays = dashboard.days.slice(-15);
    const sleepDays = dashboard.days.filter(
      (d) => (d.totalSleepMinutes ?? 0) > 0,
    );
    const summary = bedtimeSummary(sleepDays);
    return (
      <VStack
        padding={16}
        spacing={10}
        frame={FRAME_FILL}
        widgetBackground={BG_LARGE}
      >
        <HStack>
          <HStack spacing={4}>
            <Image
              systemName="moon.stars.fill"
              font="subheadline"
              foregroundStyle={palette.okay as any}
            />
            <Text font="subheadline">入睡时间</Text>
          </HStack>
          <Spacer />
          <Text font="caption" foregroundStyle="secondaryLabel">
            23:00前 {summary.earlyCount}次
          </Text>
        </HStack>
        <HStack spacing={10}>
          <VStack
            spacing={3}
            padding={12}
            frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
            background={
              {
                style: "tertiarySystemFill" as any,
                shape: { type: "rect", cornerRadius: 18 },
              } as any
            }
          >
            <Text
              font="caption"
              foregroundStyle="secondaryLabel"
              frame={{
                maxWidth: "infinity" as any,
                alignment: "leading" as any,
              }}
            >
              平均入睡
            </Text>
            <Text
              font={{ size: 28, weight: "bold", design: "rounded" } as any}
              foregroundStyle={palette.sleepCore as any}
              frame={{
                maxWidth: "infinity" as any,
                alignment: "leading" as any,
              }}
            >
              {formatWrappedClock(summary.avgBedtime)}
            </Text>
          </VStack>
          <VStack
            spacing={3}
            padding={12}
            frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
            background={
              {
                style: "tertiarySystemFill" as any,
                shape: { type: "rect", cornerRadius: 18 },
              } as any
            }
          >
            <Text
              font="caption"
              foregroundStyle="secondaryLabel"
              frame={{
                maxWidth: "infinity" as any,
                alignment: "leading" as any,
              }}
            >
              最早 / 最晚
            </Text>
            <Text
              font={{ size: 22, weight: "bold", design: "rounded" } as any}
              foregroundStyle={palette.okay as any}
              lineLimit={1}
              frame={{
                maxWidth: "infinity" as any,
                alignment: "leading" as any,
              }}
            >
              {`${formatWrappedClock(summary.earliest)} / ${formatWrappedClock(summary.latest)}`}
            </Text>
          </VStack>
        </HStack>
        <BedtimeStrip days={recentDays} count={15} rows={3} />
      </VStack>
    );
  }

  // ── Duration (default) ──
  return (
    <VStack
      padding={16}
      spacing={8}
      frame={FRAME_FILL}
      widgetBackground={BG_LARGE}
    >
      <HStack>
        <HStack spacing={4}>
          <Image
            systemName="moon.zzz.fill"
            font="subheadline"
            foregroundStyle={palette.sleepCore as any}
          />
          <Text font="subheadline">睡眠时长</Text>
        </HStack>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">
          均 {formatHoursMinutes(dashboard.averageSleepMinutes)} · 目标{" "}
          {dashboard.goalHours}h
        </Text>
      </HStack>
      <Chart frame={chartFrame} {...CHART_HIDDEN}>
        <BarChart marks={dashboard.durationTrendMarks.slice(-7) as any} />
      </Chart>
      <Text font="caption" foregroundStyle="secondaryLabel">
        最近一晚 {formatHoursMinutes(latest.totalSleepMinutes)} · 效率{" "}
        {effLabel(latest)}
      </Text>
    </VStack>
  );
}

// ── Root ──

function RootWidget() {
  if (Widget.family === "systemLarge" || Widget.family === "systemExtraLarge") {
    return <LargeWidget />;
  }
  if (Widget.family === "systemMedium") return <MediumWidget />;
  return <SmallWidget />;
}

async function run() {
  resolvedData = await resolveWidgetData();

  Widget.present(<RootWidget />, {
    reloadPolicy: reloadPolicy(),
  });

  Script.exit();
}

void run();
