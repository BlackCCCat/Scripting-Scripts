// Scripting 组件与 API：
// - 列表与导航（List/Section/NavigationStack）
// - 图表（Chart/BarChart/DonutChart）
// - Hooks（useEffect/useMemo/useState）
import {
  BarChart,
  Button,
  Chart,
  Circle,
  Divider,
  DonutChart,
  HStack,
  List,
  Markdown,
  Navigation,
  NavigationStack,
  Section,
  ScrollView,
  Spacer,
  Text,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting";

// 任务结构
import type { Task } from "../types";
// 时间格式化工具
import { formatDateTime, formatDuration } from "../utils/time";

type TaskRecord = {
  id: string;
  startAt: Date;
  endAt: Date;
  durationMs: number;
  notes: string;
};

type StatCardProps = {
  title: string;
  value: string;
  tint?: string;
};

function StatCard(props: StatCardProps) {
  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
      spacing={6}
      padding={{ top: 2, bottom: 2 }}
    >
      <Text
        font="caption"
        foregroundStyle="secondaryLabel"
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        multilineTextAlignment="leading"
      >
        {props.title}
      </Text>
      <Text
        font="title3"
        foregroundStyle={props.tint ?? "primaryLabel"}
        monospacedDigit
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        multilineTextAlignment="leading"
      >
        {props.value}
      </Text>
    </VStack>
  );
}

function RecordMarkdownView(props: {
  title: string;
  content: string;
}) {
  const dismiss = Navigation.useDismiss();
  return (
    <NavigationStack>
      <ScrollView
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        padding={16}
        toolbar={{
          cancellationAction: <Button title="完成" action={() => dismiss()} />,
        }}
      >
        <VStack
          background="systemGray6"
          cornerRadius={18}
          padding={16}
          frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        >
          <Markdown content={props.content} />
        </VStack>
      </ScrollView>
    </NavigationStack>
  );
}

function buildRecordMarkdown(record: TaskRecord, task: Task): string {
  const trimmedNotes = record.notes.trim();
  const header = [
    `# ${task.name}`,
    "",
    `- 开始：${formatDateTime(record.startAt)}`,
    `- 结束：${formatDateTime(record.endAt)}`,
    `- 时长：${formatDuration(record.durationMs)}`,
    "",
  ];
  if (!trimmedNotes) {
    header.push("> 该条记录没有额外笔记。");
    return header.join("\n");
  }
  return [...header, "## 笔记", "", trimmedNotes].join("\n");
}

function buildRecordPreview(notes: string): string {
  const lines = notes
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !line.startsWith("分段：") &&
        !line.startsWith("开始：") &&
        !line.startsWith("结束：") &&
        !line.startsWith("时长：") &&
        !line.startsWith("累计有效时长："),
    );
  return lines.join(" ");
}

function formatMonthLabel(date: Date): string {
  return `${date.getMonth() + 1}月`;
}

function formatDayLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDurationMinutes(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${`${hours}`.padStart(2, "0")}:${`${minutes}`.padStart(2, "0")}`;
}

function formatDurationWithUnit(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0 || days > 0) parts.push(`${hours}小时`);
  parts.push(`${minutes}分钟`);
  return parts.join("");
}

function weekdayLabel(weekday: number): string {
  const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return labels[weekday] ?? "未知";
}

function buildWeekdayColorScale() {
  return {
    周一: "systemBlue",
    周二: "systemGreen",
    周三: "systemOrange",
    周四: "systemPink",
    周五: "systemPurple",
    周六: "systemTeal",
    周日: "systemRed",
  };
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function isSameTaskRecord(event: CalendarEvent, task: Task): boolean {
  // 先按日历精确匹配；若系统返回的日历对象不稳定，再退化到标题匹配。
  const eventCalendarId = String(event.calendar?.identifier ?? "");
  const eventTitle = normalizeText(event.title);
  const taskTitle = normalizeText(task.name);
  if (!taskTitle) return false;
  if (eventTitle !== taskTitle) return false;
  if (!task.calendarId) return true;
  return !eventCalendarId || eventCalendarId === task.calendarId;
}

async function loadCalendarEventsByChunks(task: Task): Promise<CalendarEvent[]> {
  // 避免一次性查询跨 20 多年区间导致系统返回空结果，这里按季度分片拉取。
  const results = new Map<string, CalendarEvent>();
  const now = new Date();
  const start = new Date(now.getFullYear() - 8, 0, 1);
  const endLimit = new Date(now.getFullYear() + 1, 0, 1);

  let cursor = new Date(start.getTime());
  while (cursor < endLimit) {
    const chunkEnd = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 3,
      1,
    );
    const events = await CalendarEvent.getAll(cursor, chunkEnd);
    for (const event of events ?? []) {
      if (!isSameTaskRecord(event, task)) continue;
      results.set(event.identifier, event);
    }
    cursor = chunkEnd;
  }

  return [...results.values()];
}

export function TaskStatsView(props: { task: Task }) {
  const dismiss = Navigation.useDismiss();
  const [records, setRecords] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadRecords();
  }, [props.task.id, props.task.calendarId, props.task.name]);

  async function openRecordMarkdown(record: TaskRecord) {
    await Navigation.present({
      element: (
        <RecordMarkdownView
          title="记录详情"
          content={buildRecordMarkdown(record, props.task)}
        />
      ),
    });
  }

  async function openCalendarEvent(record: TaskRecord) {
    try {
      const event = await CalendarEvent.get(record.id);
      if (!event) {
        await Dialog.alert({ message: "未找到对应的日历事件。" });
        return;
      }
      await event.presentEditView();
      await loadRecords();
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) });
    }
  }

  async function openRecordActions(record: TaskRecord) {
    const action = await Dialog.actionSheet({
      title: props.task.name,
      message: `${formatDateTime(record.startAt)} · ${formatDuration(record.durationMs)}`,
      actions: [
        { label: "查看日历事件" },
        { label: "Markdown 全屏查看" },
      ],
    });
    if (action === 0) {
      await openCalendarEvent(record);
      return;
    }
    if (action === 1) {
      await openRecordMarkdown(record);
    }
  }

  async function loadRecords() {
    try {
      setLoading(true);
      setError("");

      const events = await loadCalendarEventsByChunks(props.task);
      const next = events
        .map((event) => {
          const startAt = event.startDate;
          const endAt = event.endDate;
          return {
            id: event.identifier,
            startAt,
            endAt,
            durationMs: Math.max(0, endAt.getTime() - startAt.getTime()),
            notes: String(event.notes ?? ""),
          };
        })
        .filter((record) => record.durationMs > 0)
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

      setRecords(next);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  const summary = useMemo(() => {
    const totalMs = records.reduce((sum, item) => sum + item.durationMs, 0);
    const totalCount = records.length;
    const averageMs = totalCount ? Math.round(totalMs / totalCount) : 0;
    const longestMs = records.reduce(
      (max, item) => Math.max(max, item.durationMs),
      0,
    );
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    const monthMs = records
      .filter((item) => item.startAt >= monthStart)
      .reduce((sum, item) => sum + item.durationMs, 0);
    const last30Ms = records
      .filter((item) => item.startAt >= last30Start)
      .reduce((sum, item) => sum + item.durationMs, 0);
    return {
      totalMs,
      totalCount,
      averageMs,
      longestMs,
      monthMs,
      last30Ms,
    };
  }, [records]);

  const dailyMarks = useMemo(() => {
    const days: Array<{ label: string; value: number }> = [];
    const end = new Date();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(
        end.getFullYear(),
        end.getMonth(),
        end.getDate() - offset,
      );
      const nextDay = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate() + 1,
      );
      const totalMs = records
        .filter((item) => item.startAt >= day && item.startAt < nextDay)
        .reduce((sum, item) => sum + item.durationMs, 0);
      days.push({
        label: formatDayLabel(day),
        value: Math.round(totalMs / 60000),
      });
    }
    return days;
  }, [records]);

  const monthlyMarks = useMemo(() => {
    const marks: Array<{ label: string; value: number }> = [];
    const now = new Date();
    for (let offset = 5; offset >= 0; offset -= 1) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const monthEnd = new Date(
        monthStart.getFullYear(),
        monthStart.getMonth() + 1,
        1,
      );
      const totalMs = records
        .filter((item) => item.startAt >= monthStart && item.startAt < monthEnd)
        .reduce((sum, item) => sum + item.durationMs, 0);
      marks.push({
        label: formatMonthLabel(monthStart),
        value: Math.round(totalMs / 60000),
      });
    }
    return marks;
  }, [records]);

  const weekdayMarks = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of records) {
      const label = weekdayLabel(item.startAt.getDay());
      totals.set(label, (totals.get(label) ?? 0) + item.durationMs);
    }
    return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
      .map((label) => ({
        category: label,
        value: Math.max(0, Math.round((totals.get(label) ?? 0) / 60000)),
      }))
      .filter((item) => item.value > 0);
  }, [records]);

  const recentRecords = useMemo(() => {
    return [...records].sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
  }, [records]);

  const overviewColumns = useMemo(() => {
    return {
      left: [
        {
          title: "累计时长",
          value: formatDurationWithUnit(summary.totalMs),
          tint: "systemGreen",
        },
        {
          title: "平均单次",
          value: formatDurationWithUnit(summary.averageMs),
        },
        {
          title: "最长单次",
          value: formatDurationWithUnit(summary.longestMs),
          tint: "systemOrange",
        },
      ],
      right: [
        {
          title: "记录次数",
          value: `${summary.totalCount}`,
          tint: "systemTeal",
        },
        {
          title: "本月时长",
          value: formatDurationWithUnit(summary.monthMs),
          tint: "systemBlue",
        },
        {
          title: "最近 30 天",
          value: formatDurationWithUnit(summary.last30Ms),
          tint: "systemPurple",
        },
      ],
    };
  }, [summary]);

  return (
    <NavigationStack>
      <List
        navigationTitle={`${props.task.name} 统计`}
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{
          cancellationAction: (
            <Button title="完成" action={() => dismiss()} />
          ),
        }}
      >
        <Section header={<Text>概览</Text>}>
          {loading ? (
            <VStack spacing={12} padding={{ top: 4, bottom: 4 }}>
              <Text foregroundStyle="secondaryLabel">正在读取日历记录…</Text>
            </VStack>
          ) : error ? (
            <VStack spacing={12} padding={{ top: 4, bottom: 4 }}>
              <Text foregroundStyle="systemRed">{error}</Text>
            </VStack>
          ) : records.length ? (
            <HStack
              spacing={0}
              padding={{ top: 4, bottom: 4 }}
              frame={{ width: "100%" as any, alignment: "topLeading" as any }}
            >
              <VStack
                spacing={16}
                frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
              >
                {overviewColumns.left.map((item) => (
                  <StatCard
                    key={item.title}
                    title={item.title}
                    value={item.value}
                    tint={item.tint}
                  />
                ))}
              </VStack>
              <Divider opacity={0} frame={{ width: 24 }} />
              <VStack
                spacing={16}
                frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
              >
                {overviewColumns.right.map((item) => (
                  <StatCard
                    key={item.title}
                    title={item.title}
                    value={item.value}
                    tint={item.tint}
                  />
                ))}
              </VStack>
            </HStack>
          ) : (
            <VStack spacing={12} padding={{ top: 4, bottom: 4 }}>
              <Text foregroundStyle="secondaryLabel">该任务还没有任何日历记录。</Text>
            </VStack>
          )}
        </Section>

        {records.length ? (
          <Section header={<Text>最近 7 天趋势</Text>}>
            <Chart
              frame={{ height: 220 }}
              chartLegend="hidden"
              chartXAxis="visible"
              chartYAxis="visible"
              chartForegroundStyleScale={{ 专注: "systemGreen" }}
            >
              <BarChart
                marks={dailyMarks.map((item) => ({
                  label: item.label,
                  value: item.value,
                  foregroundStyle: "systemGreen",
                }))}
              />
            </Chart>
          </Section>
        ) : null}

        {records.length ? (
          <Section header={<Text>星期分布</Text>}>
            {weekdayMarks.length ? (
              <VStack spacing={14}>
                <VStack frame={{ maxWidth: "infinity", alignment: "center" as any }}>
                  <Chart
                    frame={{ width: 220, height: 220 }}
                    chartXAxis="hidden"
                    chartYAxis="hidden"
                    chartLegend="hidden"
                    chartForegroundStyleScale={buildWeekdayColorScale()}
                  >
                    <DonutChart
                      marks={weekdayMarks.map((item) => ({
                        category: item.category,
                        value: item.value,
                        innerRadius: {
                          type: "ratio",
                          value: 0.62,
                        },
                        outerRadius: {
                          type: "inset",
                          value: 8,
                        },
                        angularInset: 1,
                      }))}
                    />
                  </Chart>
                </VStack>
                <VStack spacing={8}>
                  {weekdayMarks.map((item) => (
                    <HStack key={item.category} spacing={10}>
                      <Circle
                        fill={buildWeekdayColorScale()[item.category] as any}
                        frame={{ width: 10, height: 10 }}
                      />
                      <Text>{item.category}</Text>
                      <Spacer />
                      <Text foregroundStyle="secondaryLabel">
                        {formatDuration(item.value * 60000)}
                      </Text>
                    </HStack>
                  ))}
                </VStack>
              </VStack>
            ) : (
              <Text foregroundStyle="secondaryLabel">暂无可用于统计的星期数据。</Text>
            )}
          </Section>
        ) : null}

        {records.length ? (
          <Section header={<Text>最近 6 个月</Text>}>
            <Chart
              frame={{ height: 220 }}
              chartLegend="hidden"
              chartXAxis="visible"
              chartYAxis="visible"
              chartForegroundStyleScale={{ 月度: "systemBlue" }}
            >
              <BarChart
                marks={monthlyMarks.map((item) => ({
                  label: item.label,
                  value: item.value,
                  foregroundStyle: "systemBlue",
                }))}
              />
            </Chart>
          </Section>
        ) : null}

        <Section header={<Text>最近记录</Text>}>
          {loading ? (
            <Text foregroundStyle="secondaryLabel">正在整理记录…</Text>
          ) : recentRecords.length ? (
            recentRecords.slice(0, 20).map((item) => {
              const preview = buildRecordPreview(item.notes);
              return (
                <HStack
                  key={item.id}
                  spacing={0}
                  onTapGesture={() => {
                    void openRecordActions(item);
                  }}
                  frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
                >
                  <VStack
                    spacing={6}
                    padding={{ top: 8, bottom: 8 }}
                    frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
                  >
                    <Text
                      font="headline"
                      monospacedDigit
                      frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
                      multilineTextAlignment="leading"
                    >
                      {`${formatDayLabel(item.startAt)} · ${formatDurationMinutes(item.durationMs)}`}
                    </Text>
                    <Text
                      foregroundStyle="secondaryLabel"
                      monospacedDigit
                      frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
                      multilineTextAlignment="leading"
                    >
                      {`${formatDateTime(item.startAt)} → ${formatDateTime(item.endAt)}`}
                    </Text>
                    <Text
                      lineLimit={3}
                      foregroundStyle={preview ? "secondaryLabel" : "tertiaryLabel"}
                      frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
                      multilineTextAlignment="leading"
                    >
                      {preview || "无笔记，点击可查看日历事件或 Markdown 详情"}
                    </Text>
                  </VStack>
                  <Spacer />
                </HStack>
              );
            })
          ) : error ? (
            <Text foregroundStyle="systemRed">{error}</Text>
          ) : (
            <Text foregroundStyle="secondaryLabel">没有可显示的记录。</Text>
          )}
        </Section>
      </List>
    </NavigationStack>
  );
}
