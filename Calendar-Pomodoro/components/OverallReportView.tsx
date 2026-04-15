import {
  Button,
  Chart,
  Circle,
  DonutChart,
  HeatMapChart,
  HStack,
  LineChart,
  List,
  NavigationStack,
  Picker,
  ProgressView,
  ScrollView,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting";

import type { Task } from "../types";

type ReportRange = "day" | "week" | "month" | "year" | "all";

type AggregateRecord = {
  id: string;
  taskId: string;
  taskName: string;
  startAt: Date;
  endAt: Date;
  durationMs: number;
};

const RANGE_OPTIONS: Array<{ label: string; value: ReportRange }> = [
  { label: "日", value: "day" },
  { label: "周", value: "week" },
  { label: "月", value: "month" },
  { label: "年", value: "year" },
  { label: "所有", value: "all" },
];

function pad2(value: number): string {
  return `${value}`.padStart(2, "0");
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function formatDurationLong(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0 || days > 0) parts.push(`${hours}小时`);
  parts.push(`${minutes}分钟`);
  return parts.join("");
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function yearKey(date: Date): string {
  return `${date.getFullYear()}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
}

function buildTaskLookup(tasks: Task[]) {
  const byTitle = new Map<string, Task[]>();
  for (const task of tasks) {
    const title = normalizeText(task.name);
    const list = byTitle.get(title) ?? [];
    list.push(task);
    byTitle.set(title, list);
  }
  return byTitle;
}

function resolveTaskForEvent(
  event: CalendarEvent,
  byTitle: Map<string, Task[]>,
): Task | null {
  const title = normalizeText(event.title);
  if (!title) return null;
  const candidates = byTitle.get(title) ?? [];
  if (!candidates.length) return null;
  const calendarId = String(event.calendar?.identifier ?? "");
  return (
    candidates.find((task) => !task.calendarId || task.calendarId === calendarId) ??
    candidates[0] ??
    null
  );
}

async function loadAllTaskRecords(tasks: Task[]): Promise<AggregateRecord[]> {
  const byTitle = buildTaskLookup(tasks);
  const result = new Map<string, AggregateRecord>();
  const now = new Date();
  const start = new Date(now.getFullYear() - 8, 0, 1);
  const endLimit = new Date(now.getFullYear() + 1, 0, 1);

  let cursor = new Date(start.getTime());
  while (cursor < endLimit) {
    const chunkEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 3, 1);
    const events = await CalendarEvent.getAll(cursor, chunkEnd);
    for (const event of events ?? []) {
      const task = resolveTaskForEvent(event, byTitle);
      if (!task) continue;
      const startAt = event.startDate;
      const endAt = event.endDate;
      const durationMs = Math.max(0, endAt.getTime() - startAt.getTime());
      if (durationMs <= 0) continue;
      result.set(event.identifier, {
        id: event.identifier,
        taskId: task.id,
        taskName: task.name,
        startAt,
        endAt,
        durationMs,
      });
    }
    cursor = chunkEnd;
  }

  return [...result.values()].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
}

function filterRecordsByRange(
  records: AggregateRecord[],
  range: ReportRange,
): AggregateRecord[] {
  if (range === "all") return records;
  const now = new Date();
  const todayStart = startOfDay(now);
  let start = todayStart;
  if (range === "week") start = addDays(todayStart, -6);
  if (range === "month") start = addDays(todayStart, -29);
  if (range === "year") start = addDays(todayStart, -364);
  return records.filter((item) => item.startAt >= start);
}

function buildYearHeatMarks(records: AggregateRecord[]) {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const totals = new Map<string, number>();
  for (const item of records) {
    if (item.startAt < start || item.startAt >= end) continue;
    const key = dateKey(item.startAt);
    totals.set(key, (totals.get(key) ?? 0) + item.durationMs);
  }

  const marks: Array<{ x: string; y: string; value: number }> = [];
  let cursor = startOfDay(start);
  while (cursor < end) {
    const startOfYear = new Date(year, 0, 1);
    const dayOffset = Math.floor(
      (startOfDay(cursor).getTime() - startOfYear.getTime()) / 86400000,
    );
    const week = Math.floor((dayOffset + startOfYear.getDay()) / 7) + 1;
    marks.push({
      x: `W${week}`,
      y: ["日", "一", "二", "三", "四", "五", "六"][cursor.getDay()]!,
      value: Math.round((totals.get(dateKey(cursor)) ?? 0) / 60000),
    });
    cursor = addDays(cursor, 1);
  }
  return marks;
}

function currentYearLabel() {
  return `${new Date().getFullYear()} 年`;
}

function buildMonthAxisLabels() {
  const year = new Date().getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const labels = Array.from({ length: 53 }, () => "");
  for (let month = 0; month < 12; month += 1) {
    const firstDay = new Date(year, month, 1);
    const dayOffset = Math.floor(
      (firstDay.getTime() - startOfYear.getTime()) / 86400000,
    );
    const week = Math.floor((dayOffset + startOfYear.getDay()) / 7);
    labels[week] = `${month + 1}`;
  }
  return labels;
}

function buildWeekdayAxisLabels() {
  return ["日", "一", "二", "三", "四", "五", "六"];
}

function buildTrendMarks(records: AggregateRecord[], range: ReportRange) {
  const totals = new Map<string, number>();
  if (range === "day") {
    for (const item of records) {
      const label = `${pad2(item.startAt.getHours())}:00`;
      totals.set(label, (totals.get(label) ?? 0) + item.durationMs);
    }
    return Array.from({ length: 24 }, (_, hour) => {
      const label = `${pad2(hour)}:00`;
      return { label, value: Math.round((totals.get(label) ?? 0) / 60000) };
    });
  }

  if (range === "year") {
    for (const item of records) {
      const label = `${item.startAt.getMonth() + 1}月`;
      totals.set(label, (totals.get(label) ?? 0) + item.durationMs);
    }
    return Array.from({ length: 12 }, (_, idx) => {
      const label = `${idx + 1}月`;
      return { label, value: Math.round((totals.get(label) ?? 0) / 60000) };
    });
  }

  if (range === "all") {
    for (const item of records) {
      const label = yearKey(item.startAt);
      totals.set(label, (totals.get(label) ?? 0) + item.durationMs);
    }
    return [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, total]) => ({
        label,
        value: Math.round(total / 60000),
      }));
  }

  for (const item of records) {
    const label = `${item.startAt.getMonth() + 1}/${item.startAt.getDate()}`;
    totals.set(label, (totals.get(label) ?? 0) + item.durationMs);
  }
  return [...totals.entries()].map(([label, total]) => ({
    label,
    value: Math.round(total / 60000),
  }));
}

function buildRecentProgress(records: AggregateRecord[]) {
  const today = startOfDay(new Date());
  return [2, 1, 0].map((offset) => {
    const date = addDays(today, -offset);
    const next = addDays(date, 1);
    const total = records
      .filter((item) => item.startAt >= date && item.startAt < next)
      .reduce((sum, item) => sum + item.durationMs, 0);
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      totalMs: total,
    };
  });
}

function buildTaskShare(records: AggregateRecord[]) {
  const totals = new Map<string, number>();
  for (const item of records) {
    totals.set(item.taskName, (totals.get(item.taskName) ?? 0) + item.durationMs);
  }
  return [...totals.entries()]
    .map(([taskName, total]) => ({
      taskName,
      totalMs: total,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

const TASK_SHARE_COLORS = [
  "systemBlue",
  "systemGreen",
  "systemOrange",
  "systemPink",
  "systemPurple",
  "systemTeal",
  "systemRed",
  "systemIndigo",
];

function buildTaskShareLegend(
  records: ReturnType<typeof buildTaskShare>,
  totalMs: number,
) {
  if (!records.length || totalMs <= 0) return [];
  const raw = records.map((item, index) => ({
    ...item,
    color: TASK_SHARE_COLORS[index % TASK_SHARE_COLORS.length],
    exact: (item.totalMs / totalMs) * 100,
  }));
  const base = raw.map((item) => ({
    ...item,
    percent: Math.floor(item.exact),
    remainder: item.exact - Math.floor(item.exact),
  }));
  let remain = 100 - base.reduce((sum, item) => sum + item.percent, 0);
  const order = [...base]
    .map((item, index) => ({ index, remainder: item.remainder }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < order.length && remain > 0; i += 1) {
    base[order[i]!.index]!.percent += 1;
    remain -= 1;
  }
  return base;
}

function heatColor(minutes: number): string {
  if (minutes <= 0) return "systemGray5";
  if (minutes < 30) return "#6A2C00";
  if (minutes < 90) return "#B44A00";
  if (minutes < 180) return "#FF7A00";
  return "#FF453A";
}

export function OverallReportView(props: {
  tasks: Task[];
  onExit: () => void;
}) {
  const [range, setRange] = useState<ReportRange>("week");
  const [records, setRecords] = useState<AggregateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setError("");
        const next = await loadAllTaskRecords(props.tasks);
        setRecords(next);
      } catch (e: any) {
        setError(String(e?.message ?? e));
        setRecords([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [props.tasks]);

  const filteredRecords = useMemo(
    () => filterRecordsByRange(records, range),
    [records, range],
  );

  const totalMs = useMemo(
    () => filteredRecords.reduce((sum, item) => sum + item.durationMs, 0),
    [filteredRecords],
  );

  const heatMarks = useMemo(
    () =>
      buildYearHeatMarks(records).map((item) => ({
        ...item,
        foregroundStyle: heatColor(item.value),
      })),
    [records],
  );

  const trendMarks = useMemo(
    () => buildTrendMarks(filteredRecords, range),
    [filteredRecords, range],
  );

  const recentProgress = useMemo(
    () => buildRecentProgress(records),
    [records],
  );

  const maxProgressMs = useMemo(
    () => Math.max(...recentProgress.map((item) => item.totalMs), 1),
    [recentProgress],
  );

  const taskShare = useMemo(
    () => buildTaskShare(filteredRecords),
    [filteredRecords],
  );

  const taskShareLegend = useMemo(
    () => buildTaskShareLegend(taskShare, totalMs),
    [taskShare, totalMs],
  );

  const taskShareScale = useMemo(
    () =>
      Object.fromEntries(
        taskShareLegend.map((item) => [item.taskName, item.color]),
      ),
    [taskShareLegend],
  );
  const monthAxisLabels = useMemo(() => buildMonthAxisLabels(), []);
  const weekdayAxisLabels = useMemo(() => buildWeekdayAxisLabels(), []);

  return (
    <NavigationStack>
      <List
        navigationTitle="报告"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{
          topBarLeading: (
            <Button
              title=""
              systemImage="xmark.circle"
              action={() => props.onExit()}
            />
          ),
        }}
      >
        <Section header={<Text>时间范围</Text>}>
          <Picker
            title="范围"
            pickerStyle="segmented"
            value={range}
            onChanged={(value: any) => setRange(value as ReportRange)}
          >
            {RANGE_OPTIONS.map((item) => (
              <Text key={item.value} tag={item.value}>
                {item.label}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section header={<Text>总时长</Text>}>
          {loading ? (
            <Text foregroundStyle="secondaryLabel">正在汇总记录…</Text>
          ) : error ? (
            <Text foregroundStyle="systemRed">{error}</Text>
          ) : (
            <VStack spacing={6} alignment="leading">
              <Text font="largeTitle" monospacedDigit>
                {formatDurationLong(totalMs)}
              </Text>
              <Text foregroundStyle="secondaryLabel">
                共统计 {filteredRecords.length} 条记录
              </Text>
            </VStack>
          )}
        </Section>

        <Section header={<Text>热力图</Text>}>
          {heatMarks.length ? (
            <VStack spacing={10} alignment="leading">
              <Text foregroundStyle="secondaryLabel">{currentYearLabel()}</Text>
              <HStack alignment="top" spacing={8}>
                <VStack spacing={0}>
                  <Text opacity={0} frame={{ width: 18, height: 18 }}>
                    .
                  </Text>
                  {weekdayAxisLabels.map((label, index) => (
                    <Text
                      key={`weekday-axis-${index}`}
                      font="caption2"
                      foregroundStyle="secondaryLabel"
                      frame={{ width: 18, height: 16, alignment: "trailing" as any }}
                    >
                      {label}
                    </Text>
                  ))}
                </VStack>
                <ScrollView
                  axes="horizontal"
                  scrollIndicator="hidden"
                  frame={{ maxWidth: "infinity" }}
                >
                  <VStack spacing={0} alignment="leading">
                    <HStack spacing={0}>
                      {monthAxisLabels.map((label, index) => (
                        <Text
                          key={`month-axis-${index}`}
                          font="caption2"
                          foregroundStyle="secondaryLabel"
                          frame={{ width: 16, height: 18, alignment: "center" as any }}
                        >
                          {label}
                        </Text>
                      ))}
                    </HStack>
                    <Chart
                      frame={{ width: 848, height: 112 }}
                      chartLegend="hidden"
                      chartXAxis="hidden"
                      chartYAxis="hidden"
                    >
                      <HeatMapChart marks={heatMarks as any} />
                    </Chart>
                  </VStack>
                </ScrollView>
              </HStack>
            </VStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">今年暂无热力图数据。</Text>
          )}
        </Section>

        <Section header={<Text>时间趋势</Text>}>
          {filteredRecords.length ? (
            <Chart
              frame={{ height: 220 }}
              chartLegend="hidden"
              chartXAxis="visible"
              chartYAxis="visible"
            >
              <LineChart
                marks={trendMarks.map((item) => ({
                  label: item.label,
                  value: item.value,
                  foregroundStyle: "systemBlue",
                }))}
              />
            </Chart>
          ) : (
            <Text foregroundStyle="secondaryLabel">当前范围内暂无趋势数据。</Text>
          )}
        </Section>

        <Section header={<Text>近三天进度对比</Text>}>
          <VStack spacing={14}>
            {recentProgress.map((item) => (
              <VStack key={item.label} spacing={6}>
                <HStack>
                  <Text>{item.label}</Text>
                  <Spacer />
                  <Text foregroundStyle="secondaryLabel">
                    {formatDurationLong(item.totalMs)}
                  </Text>
                </HStack>
                <ProgressView
                  value={item.totalMs}
                  total={maxProgressMs}
                  progressViewStyle="linear"
                  frame={{ maxWidth: "infinity" }}
                />
              </VStack>
            ))}
          </VStack>
        </Section>

        <Section header={<Text>任务占比</Text>}>
          {taskShareLegend.length ? (
            <VStack key={range} spacing={12} padding={{ top: 4, bottom: 8 }}>
              <HStack frame={{ maxWidth: "infinity", alignment: "center" as any }}>
                <Chart
                  frame={{ width: 190, height: 190 }}
                  chartLegend="hidden"
                  chartXAxis="hidden"
                  chartYAxis="hidden"
                  chartForegroundStyleScale={taskShareScale as any}
                >
                  <DonutChart
                    marks={taskShareLegend.map((item) => ({
                      category: item.taskName,
                      value: Math.round(item.totalMs / 60000),
                      innerRadius: { type: "ratio", value: 0.62 },
                      outerRadius: { type: "inset", value: 8 },
                      angularInset: 1,
                    }))}
                  />
                </Chart>
              </HStack>
              <VStack spacing={8}>
                {taskShareLegend.map((item) => {
                  return (
                    <HStack key={item.taskName}>
                      <Circle
                        fill={item.color as any}
                        frame={{ width: 10, height: 10 }}
                      />
                      <Text>{item.taskName}</Text>
                      <Spacer />
                      <Text foregroundStyle="secondaryLabel">
                        {item.percent}%
                      </Text>
                    </HStack>
                  );
                })}
              </VStack>
            </VStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">当前范围内暂无任务占比数据。</Text>
          )}
        </Section>
      </List>
    </NavigationStack>
  );
}
