// Scripting 组件与 API：
// - UI 组件（Button/Menu/ScrollView/Text 等）
// - Hooks（useState/useEffect/useMemo/useRef）
// - 系统能力（LiveActivity/Notification/Script）
import {
  Button,
  Circle,
  DragGesture,
  GeometryReader,
  HStack,
  Image,
  Menu,
  Navigation,
  NavigationStack,
  Rectangle,
  ScrollView,
  Spacer,
  Text,
  TextField,
  TimerIntervalLabel,
  VStack,
  ZStack,
  useEffect,
  useMemo,
  useRef,
  useState,
  LiveActivity,
  type LiveActivityState,
  Notification,
  ReorderableForEach,
  Script,
  useObservable,
} from "scripting";

// 业务常量（正计时 Live Activity 展示窗口）
import {
  COUNT_UP_WINDOW_MS,
} from "../constants";
// Live Activity UI 注册器
import { PomodoroLiveActivity } from "../live_activity";
// 类型定义
import type { Task, TimerActivityState } from "../types";
// 本地持久化（任务）
import { loadTasks, saveTasks } from "../utils/storage";
// 本地持久化（计时会话）
import {
  clearSession,
  loadSession,
  saveSession,
  type TimerSession,
  type TimerSessionSegment,
} from "../utils/session";
// 任务总时长缓存：先显示缓存，再异步校准日历数据
import {
  loadTaskDurationsCache,
  saveTaskDurationsCache,
} from "../utils/taskDurations";
// 全局设置：主题色、日历账户筛选等
import {
  DEFAULT_THEME_COLOR,
  loadSettings,
  type AppSettings,
} from "../utils/settings";
// 时间格式化工具
import { formatDateTime, formatDuration } from "../utils/time";
// 任务新增/编辑页面
import { TaskEditView } from "./TaskEditView";
// 任务统计页面
import { TaskStatsView, loadCalendarEventsByChunks } from "./TaskStatsView";
// 总体报告页
import { OverallReportView } from "./OverallReportView";
// 设置页
import { SettingsView } from "./SettingsView";

// Live Activity 创建器（用于 start/update/end）
const createTimerActivity = PomodoroLiveActivity;
const LIVE_ACTIVITY_NAME = "calendar-pomodoro";

function NoteEditorPage(props: { title: string; content: string }) {
  const dismiss = Navigation.useDismiss();
  const [content, setContent] = useState(props.content);

  return (
    <NavigationStack>
      <VStack
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button title="取消" action={() => dismiss(null)} />
          ),
          topBarTrailing: (
            <Button title="保存" action={() => dismiss(content)} />
          ),
        }}
        padding={16}
        spacing={12}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
      >
        <TextField
          title=""
          prompt="输入本次计时的笔记"
          value={content}
          onChanged={setContent}
          axis="vertical"
          autofocus
          textFieldStyle="plain"
          frame={{
            minHeight: 360,
            maxWidth: "infinity",
            maxHeight: "infinity",
            alignment: "topLeading" as any,
          }}
        />
      </VStack>
    </NavigationStack>
  );
}

type TaskDurationMap = Record<string, number>;

function formatCompactDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatClockTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function currentMinuteOfDay(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

function floorToTimelineStep(value: number): number {
  return Math.floor(value / TIMELINE_STEP_MINUTES) * TIMELINE_STEP_MINUTES;
}

function playTimelineTickSound() {
  try {
    const anyGlobal = globalThis as any;
    if (typeof anyGlobal.AudioServicesPlaySystemSound === "function") {
      anyGlobal.AudioServicesPlaySystemSound(1104);
    } else if (typeof anyGlobal.SystemSound?.play === "function") {
      anyGlobal.SystemSound.play(1104);
    }
  } catch {
    // 当前 dts 未暴露稳定的系统点击音 API；没有可用实现时静默跳过。
  }
}

let repeatingTimerIdSeed = 0;
const repeatingTimers = new Map<number, ReturnType<typeof setTimeout>>();

function setRepeatingTimer(action: () => void, delay: number): number {
  const nativeSetInterval = (globalThis as any).setInterval;
  if (typeof nativeSetInterval === "function") {
    return nativeSetInterval(action, delay) as number;
  }

  // Scripting 运行时没有稳定暴露 setInterval，这里用 setTimeout 递归模拟可清理的重复定时器。
  const id = ++repeatingTimerIdSeed;
  const tick = () => {
    if (!repeatingTimers.has(id)) return;
    try {
      action();
    } finally {
      if (repeatingTimers.has(id)) {
        repeatingTimers.set(id, setTimeout(tick, delay));
      }
    }
  };

  repeatingTimers.set(id, setTimeout(tick, delay));
  return id;
}

function clearRepeatingTimer(id: number) {
  const timer = repeatingTimers.get(id);
  if (timer != null) {
    clearTimeout(timer);
    repeatingTimers.delete(id);
    return;
  }

  const nativeClearInterval = (globalThis as any).clearInterval;
  if (typeof nativeClearInterval === "function") {
    nativeClearInterval(id);
  }
}

const TIMELINE_STEP_MINUTES = 5;
const TIMELINE_MAX_MINUTES = 24 * 60;
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundToTimelineStep(value: number): number {
  const rounded = Math.round(value / TIMELINE_STEP_MINUTES) * TIMELINE_STEP_MINUTES;
  return Math.max(0, Math.min(TIMELINE_MAX_MINUTES, rounded));
}

function TaskProgressLine(props: { ratio: number; active: boolean; tint: string }) {
  const ratio = clamp01(props.ratio);
  const tint = props.active ? "systemGreen" : props.tint;
  return (
    <GeometryReader frame={{ height: 16, maxWidth: "infinity" }}>
      {(proxy) => {
        const width = Math.max(1, proxy.size.width);
        const progressWidth = Math.max(2, width * ratio);
        const restWidth = Math.max(0, width - progressWidth);
        const dotX = Math.max(0, Math.min(width - 10, progressWidth - 5));
        return (
          <ZStack alignment="leading" frame={{ width, height: 16 }}>
            <HStack spacing={0} frame={{ width, height: 2 }}>
              <Rectangle fill={tint as any} frame={{ width: progressWidth, height: 2 }} />
              <Rectangle fill="separator" opacity={0.45} frame={{ width: restWidth, height: 2 }} />
            </HStack>
            <Circle fill={tint as any} frame={{ width: 10, height: 10 }} offset={{ x: dotX, y: 0 }} />
          </ZStack>
        );
      }}
    </GeometryReader>
  );
}

const TIMELINE_STEP_WIDTH = 18;

function TimeAxis(props: {
  value: number;
  targetLabel: string;
  durationLabel: string;
  currentMinute: number;
  tint: string;
  disabled: boolean;
  maxValue: number;
  onChanged: (value: number) => void;
}) {
  const dragStartRef = useRef(props.value);
  const draggingRef = useRef(false);
  const clampedValue = Math.max(0, Math.min(props.maxValue, props.value));
  const visibleSteps = 18;
  const maxSteps = Math.ceil(props.maxValue / TIMELINE_STEP_MINUTES);
  const centerShift = -(clampedValue / TIMELINE_STEP_MINUTES) * TIMELINE_STEP_WIDTH;
  const futureMarks = Array.from({ length: maxSteps + visibleSteps + 1 }, (_, index) => index);

  function valueFromDrag(translationX: number): number {
    const deltaSteps = Math.round(-translationX / TIMELINE_STEP_WIDTH);
    const next = dragStartRef.current + deltaSteps * TIMELINE_STEP_MINUTES;
    return Math.max(0, Math.min(props.maxValue, next));
  }

  const dragGesture = DragGesture({ minDistance: 1, coordinateSpace: "local" })
    .onChanged((details: any) => {
      if (props.disabled) return;
      if (!draggingRef.current) {
        draggingRef.current = true;
        dragStartRef.current = props.value;
      }
      props.onChanged(valueFromDrag(Number(details.translation?.width ?? 0)));
    })
    .onEnded((details: any) => {
      if (props.disabled) return;
      const next = valueFromDrag(Number(details.translation?.width ?? 0));
      draggingRef.current = false;
      dragStartRef.current = next;
      props.onChanged(next);
    });

  return (
    <VStack
      spacing={4}
      frame={{ height: 62, maxWidth: "infinity" }}
      background="rgba(0,0,0,0.001)"
      clipped
      gesture={dragGesture}
    >
      <Text foregroundStyle="secondaryLabel" monospacedDigit>
        {props.targetLabel}
      </Text>

      <ZStack frame={{ height: 18, maxWidth: "infinity" }} clipped allowsHitTesting={false}>
        <GeometryReader frame={{ height: 18, maxWidth: "infinity" }}>
          {(proxy) => {
            const width = Math.max(1, proxy.size.width);
            const centerX = width / 2;
            const axisY = 9;
            // 以时间轴自身为准：当前时间点左侧是已过去时间，右侧是未来时间。
            // 目标点固定在卡片中央，拖动时移动的是时间轴视窗，所以当前时间点会在视窗中平移。
            const rawCurrentTimeX = centerX + centerShift;
            const currentTimeX = Math.max(0, Math.min(width, rawCurrentTimeX));
            return (
              <ZStack frame={{ width, height: 18 }}>
                {currentTimeX > 0.5 ? (
                  <Rectangle
                    fill={props.tint as any}
                    opacity={0.65}
                    frame={{ width: currentTimeX, height: 2 }}
                    position={{ x: currentTimeX / 2, y: axisY }}
                  />
                ) : null}
                {futureMarks.map((index) => {
                  const x = rawCurrentTimeX + index * TIMELINE_STEP_WIDTH;
                  if (x < currentTimeX - 0.5 || x > width + 0.5) {
                    return null;
                  }
                  const absoluteMinute =
                    props.currentMinute + index * TIMELINE_STEP_MINUTES;
                  const isHourMark = absoluteMinute % 60 === 0;
                  const isQuarterMark = absoluteMinute % 15 === 0;
                  const dotSize = isHourMark ? 6 : isQuarterMark ? 4 : 3;
                  return (
                    <Circle
                      key={index}
                      fill={isHourMark ? "secondaryLabel" : "separator"}
                      opacity={isHourMark ? 0.9 : isQuarterMark ? 0.82 : 0.95}
                      frame={{ width: dotSize, height: dotSize }}
                      position={{ x, y: axisY }}
                    />
                  );
                })}
              </ZStack>
            );
          }}
        </GeometryReader>
        <Circle
          fill={props.tint as any}
          frame={{ width: 13, height: 13 }}
        />
      </ZStack>

      <Text foregroundStyle="secondaryLabel" monospacedDigit>
        {props.durationLabel}
      </Text>
    </VStack>
  );
}

function FocusActionButton(props: {
  title: string;
  systemImage: string;
  tint: string;
  disabled?: boolean;
  action: () => void;
}) {
  return (
    <Button
      buttonStyle="plain"
      disabled={props.disabled}
      action={props.action}
      tint={props.tint as any}
      glassEffect={{ type: "rect", cornerRadius: 24 } as any}
      frame={{ width: 92, height: 78 }}
    >
      <VStack spacing={8} frame={{ width: 92, height: 78, alignment: "center" as any }}>
        <Image systemName={props.systemImage} foregroundStyle={props.tint as any} imageScale="large" />
        <Text foregroundStyle="secondaryLabel">{props.title}</Text>
      </VStack>
    </Button>
  );
}

function FocusStopButton(props: {
  disabled?: boolean;
  action: () => void;
}) {
  return (
    <Button
      buttonStyle="plain"
      disabled={props.disabled}
      action={props.action}
      tint="systemRed"
      glassEffect={{ type: "rect", cornerRadius: 30 } as any}
      frame={{ maxWidth: "infinity", minHeight: 62 }}
    >
      <HStack spacing={10} frame={{ maxWidth: "infinity", minHeight: 62, alignment: "center" as any }}>
        <Image systemName="stop.fill" foregroundStyle="systemRed" imageScale="large" />
        <Text font="headline" fontWeight="bold" foregroundStyle="systemRed">
          停止并保存
        </Text>
      </HStack>
    </Button>
  );
}

function FocusTimerPage(props: {
  task: Task;
  calendarTitle: string;
  timerText: string;
  timerFrom: Date;
  timerTo: Date;
  timerPauseTime?: Date;
  timerCountsDown: boolean;
  modeText: string;
  statusText: string;
  paused: boolean;
  saving: boolean;
  onCancel: () => void;
  onPause: () => void;
  onStop: () => void;
  onNote: () => void;
}) {
  return (
    <NavigationStack>
      <VStack
        navigationTitle="专注中"
        navigationBarTitleDisplayMode="inline"
        spacing={28}
        padding={{ top: 28, bottom: 28, leading: 22, trailing: 22 }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" as any }}
      >
        <VStack spacing={8} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
          <Text font="title" fontWeight="bold" lineLimit={2}>
            {props.task.name}
          </Text>
          <Text foregroundStyle="secondaryLabel" lineLimit={1}>
            {props.calendarTitle}
          </Text>
          <Text foregroundStyle={props.modeText === "倒计时" ? "systemBlue" : "systemGreen"} font="headline">
            {props.modeText} · {props.statusText}
          </Text>
        </VStack>

        <Spacer />

        <VStack spacing={12} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
          <TimerIntervalLabel
            from={props.timerFrom}
            to={props.timerTo}
            pauseTime={props.timerPauseTime}
            countsDown={props.timerCountsDown}
            font={54}
            monospacedDigit
            fontWeight="heavy"
            foregroundStyle={props.timerCountsDown ? "systemBlue" : "systemGreen"}
          />
        </VStack>

        <Spacer />

        <FocusStopButton disabled={props.saving} action={props.onStop} />

        <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
          <FocusActionButton
            title="取消"
            systemImage="xmark"
            tint="secondaryLabel"
            disabled={props.saving}
            action={props.onCancel}
          />
          <FocusActionButton
            title={props.paused ? "继续" : "暂停"}
            systemImage={props.paused ? "play.fill" : "pause.fill"}
            tint="systemOrange"
            disabled={props.saving}
            action={props.onPause}
          />
          <FocusActionButton
            title="笔记"
            systemImage="square.and.pencil"
            tint="systemBlue"
            disabled={props.saving}
            action={props.onNote}
          />
        </HStack>
      </VStack>
    </NavigationStack>
  );
}

function OverallReportSheet(props: { tasks: Task[] }) {
  const dismiss = Navigation.useDismiss();
  return <OverallReportView tasks={props.tasks} onExit={() => dismiss()} />;
}

export function CalendarTimerView() {
  // 任务列表与当前选中任务
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [currentTimelineMinutes, setCurrentTimelineMinutes] = useState(() =>
    floorToTimelineStep(currentMinuteOfDay()),
  );
  // 时间轴保存的是“距离当前时间的偏移分钟”，0 表示从现在开始正计时。
  const [focusMinutes, setFocusMinutes] = useState(0);
  const [timelineTouched, setTimelineTouched] = useState(false);
  const [showFocusPage, setShowFocusPage] = useState(false);
  const [focusModeText, setFocusModeText] = useState("正计时");
  const [taskDurations, setTaskDurations] = useState<TaskDurationMap>({});
  const [taskDurationsLoading, setTaskDurationsLoading] = useState(false);
  const [themeColor, setThemeColor] = useState(DEFAULT_THEME_COLOR);
  const [uiTick, setUiTick] = useState(Date.now());
  const activeReorderTask = useObservable<Task | null>(null);
  const [runtimeCountdownSeconds, setRuntimeCountdownSeconds] = useState<
    number | null
  >(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  // 当前关联日历（保存事件时使用）
  const [activeCalendar, setActiveCalendar] = useState<Calendar | null>(null);
  // 会话开始时间（用于最终写入日历）
  const [sessionStartAt, setSessionStartAt] = useState<Date | null>(null);
  // 当前连续计时片段的起点（暂停后会重置）
  const [segmentStartAt, setSegmentStartAt] = useState<Date | null>(null);
  // 累积已计时毫秒数（暂停前的总和）
  const [accumulatedMs, setAccumulatedMs] = useState(0);
  // 计时显示用的累计毫秒
  const [elapsedMs, setElapsedMs] = useState(0);
  // 已完成的有效计时分段（暂停会切分）
  const [completedSegments, setCompletedSegments] = useState<
    TimerSessionSegment[]
  >([]);
  // 运行/暂停/保存状态
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  // 笔记草稿
  const [noteDraft, setNoteDraft] = useState("");
  // 当前环境是否支持脚本最小化。这里同步判断，避免首帧后再插入按钮导致导航栏抖动。
  const supportsMinimization =
    typeof Script.supportsMinimization === "function" &&
    Script.supportsMinimization();
  // 定时器与 Live Activity 的引用
  const timerIdRef = useRef<number | null>(null);
  const activityRef = useRef<LiveActivity<TimerActivityState> | null>(null);
  const activityStartRef = useRef<Promise<boolean> | null>(null);
  const activityReadyRef = useRef(false);
  const activityListenerRef = useRef<
    ((state: LiveActivityState) => void) | null
  >(null);
  const activeTaskRef = useRef<Task | null>(null);
  const sessionStartAtRef = useRef<Date | null>(null);
  const segmentStartAtRef = useRef<Date | null>(null);
  const accumulatedMsRef = useRef(0);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const runtimeCountdownSecondsRef = useRef<number | null>(null);
  const lastTimelineFeedbackRef = useRef<number | null>(null);
  const completedSegmentsRef = useRef<TimerSessionSegment[]>([]);
  const staleRefreshAtRef = useRef(0);
  const stoppingRef = useRef(false);
  const noteSaveTimerRef = useRef<number | null>(null);
  const tasksLoadedRef = useRef(false);
  const restoreDoneRef = useRef(false);
  useEffect(() => {
    // 首次进入：加载任务
    void refreshTasks();
    void refreshSettings();
  }, []);
  useEffect(() => {
    // 首页进入时刷新“当前时间”所在的时间轴位置；用户未手动滚动前，目标点始终跟随当前时间。
    const refreshNow = () => {
      const next = floorToTimelineStep(currentMinuteOfDay());
      setCurrentTimelineMinutes(next);
      if (!timelineTouched && !runningRef.current && !pausedRef.current) {
        setFocusMinutes(0);
      }
    };
    refreshNow();
    const id = setRepeatingTimer(refreshNow, 30000);
    return () => clearRepeatingTimer(id);
  }, [timelineTouched]);

  useEffect(() => {
    // 全屏计时页使用独立 UI tick，避免父级 elapsedMs 未触发渲染时页面读秒停住。
    if (!running && !paused && !showFocusPage) return;
    const update = () => setUiTick(Date.now());
    update();
    const id = setRepeatingTimer(update, 1000);
    return () => clearRepeatingTimer(id);
  }, [running, paused, showFocusPage]);


  useEffect(() => {
    // 任务加载完成后尝试恢复计时会话
    if (!tasksLoadedRef.current) return;
    if (restoreDoneRef.current) return;
    restoreDoneRef.current = true;
    void restoreSessionIfNeeded();
  }, [tasks]);

  // 根据 activeTaskId 取出当前任务
  const activeTask = useMemo(() => {
    if (!activeTaskId) return null;
    return tasks.find((t) => t.id === activeTaskId) ?? null;
  }, [tasks, activeTaskId]);

  useEffect(() => {
    // 将关键状态同步到 ref，供 Live Activity 回调使用
    activeTaskRef.current = activeTask;
    sessionStartAtRef.current = sessionStartAt;
    segmentStartAtRef.current = segmentStartAt;
    accumulatedMsRef.current = accumulatedMs;
    runningRef.current = running;
    pausedRef.current = paused;
    completedSegmentsRef.current = completedSegments;
    runtimeCountdownSecondsRef.current = runtimeCountdownSeconds;
  }, [
    activeTask,
    sessionStartAt,
    segmentStartAt,
    accumulatedMs,
    running,
    paused,
    completedSegments,
    runtimeCountdownSeconds,
  ]);

  const selectedTask = useMemo(() => {
    if ((running || paused) && activeTask) return activeTask;
    if (selectedTaskId) {
      const found = tasks.find((t) => t.id === selectedTaskId);
      if (found) return found;
    }
    return activeTask ?? tasks[0] ?? null;
  }, [activeTask, paused, running, selectedTaskId, tasks]);

  useEffect(() => {
    if (!selectedTaskId && tasks[0]) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [tasks]);

  // 当前任务的计时模式
  const effectiveCountdownSeconds =
    runtimeCountdownSeconds ??
    (activeTask?.useCountdown ? (activeTask.countdownSeconds ?? 0) : 0);
  const isCountdown = effectiveCountdownSeconds > 0;
  const countdownTotalMs = isCountdown
    ? effectiveCountdownSeconds * 1000
    : 0;
  const liveElapsedMs =
    running && segmentStartAt
      ? accumulatedMs + Math.max(0, uiTick - segmentStartAt.getTime())
      : elapsedMs;
  // 倒计时显示剩余；正计时显示已过
  const displayMs = isCountdown
    ? Math.max(0, countdownTotalMs - liveElapsedMs)
    : liveElapsedMs;
  const timerText = useMemo(() => formatDuration(displayMs), [displayMs]);
  const focusTimerNowMs = Date.now();
  const focusLiveElapsedMs =
    running && segmentStartAt
      ? accumulatedMs + Math.max(0, focusTimerNowMs - segmentStartAt.getTime())
      : elapsedMs;
  const focusTimerDisplayMs = isCountdown
    ? Math.max(0, countdownTotalMs - focusLiveElapsedMs)
    : focusLiveElapsedMs;
  const focusTimerFrom = isCountdown
    ? new Date(focusTimerNowMs)
    : new Date(focusTimerNowMs - focusTimerDisplayMs);
  const focusTimerTo = isCountdown
    ? new Date(focusTimerNowMs + focusTimerDisplayMs)
    : new Date(focusTimerFrom.getTime() + COUNT_UP_WINDOW_MS);
  const focusTimerPauseTime =
    paused || !running ? new Date(focusTimerNowMs) : undefined;

  useEffect(() => {
    // 切换任务时同步笔记草稿
    if (!activeTask) {
      setNoteDraft("");
      return;
    }
    setNoteDraft(activeTask.noteDraft ?? "");
  }, [activeTaskId, tasks]);

  useEffect(() => {
    // 笔记自动保存（防抖）
    if (!activeTask) return;
    if (noteDraft === (activeTask.noteDraft ?? "")) return;
    if (noteSaveTimerRef.current != null)
      clearTimeout(noteSaveTimerRef.current);
    noteSaveTimerRef.current = setTimeout(() => {
      setTasks((prev) => {
        const next = prev.map((t) =>
          t.id === activeTask.id ? { ...t, noteDraft } : t,
        );
        void saveTasks(next);
        return next;
      });
    }, 300);
    return () => {
      if (noteSaveTimerRef.current != null)
        clearTimeout(noteSaveTimerRef.current);
    };
  }, [noteDraft, activeTask]);

  useEffect(() => {
    // 根据运行状态控制后台保活
    const syncBackground = async () => {
      try {
        // 仅在计时中保持脚本后台存活，避免额外耗电
        if (running) {
          await BackgroundKeeper.keepAlive();
        } else {
          await BackgroundKeeper.stopKeepAlive();
        }
      } catch {
        // ignore keep-alive errors
      }
    };
    void syncBackground();
  }, [running]);

  useEffect(() => {
    // 计时器刷新逻辑：真实计时 + 整秒对齐刷新
    if (!running || !segmentStartAt) {
      clearTimer();
      return;
    }

    let cancelled = false;

    const tick = () => {
      if (cancelled || !segmentStartAt) return;
      // 用真实经过时间计算，避免累积误差
      const ms = accumulatedMs + (Date.now() - segmentStartAt.getTime());
      setElapsedMs(ms);
      // 倒计时到期自动结束
      if (isCountdown && countdownTotalMs > 0 && ms >= countdownTotalMs) {
        void stopTimer({ auto: true });
        return;
      }
      // 对齐到下一秒边界
      const nowMs = Date.now();
      const remainder = nowMs % 1000;
      const delay = remainder === 0 ? 1000 : 1000 - remainder;
      timerIdRef.current = setTimeout(tick, delay);
    };

    tick();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [
    running,
    segmentStartAt,
    accumulatedMs,
    isCountdown,
    countdownTotalMs,
    activeTaskId,
  ]);

  function clearTimer() {
    // 清除当前定时器
    if (timerIdRef.current != null) {
      clearTimeout(timerIdRef.current);
      timerIdRef.current = null;
    }
  }

  function sessionCountdownSecondsForTask(task: Task | null): number | undefined {
    const seconds =
      runtimeCountdownSecondsRef.current ??
      (task?.useCountdown ? (task.countdownSeconds ?? 0) : 0);
    return seconds > 0 ? seconds : undefined;
  }

  function buildCurrentSessionSnapshot(now = new Date()): TimerSession | null {
    // 将当前内存中的计时状态整理成可持久化的会话快照
    const task = activeTaskRef.current;
    const sessionStart = sessionStartAtRef.current;
    if (!task || !sessionStart) return null;

    const isRunning = runningRef.current;
    const segmentStart = segmentStartAtRef.current;
    const segmentElapsed =
      isRunning && segmentStart ? now.getTime() - segmentStart.getTime() : 0;

    return {
      taskId: task.id,
      sessionStartAt: sessionStart.getTime(),
      // 运行中时将当前片段推进到 now，避免恢复后重复累加这一段
      segmentStartAt: isRunning ? now.getTime() : undefined,
      accumulatedMs: accumulatedMsRef.current + Math.max(0, segmentElapsed),
      segments: completedSegmentsRef.current,
      running: isRunning,
      paused: pausedRef.current,
      countdownSeconds: sessionCountdownSecondsForTask(task),
      activityId: activityRef.current?.activityId,
    };
  }

  useEffect(() => {
    // 最小化前后补一次状态同步，避免 UI 收起/恢复后会话与灵动岛漂移
    const removeMinimize = Script.onMinimize(() => {
      void (async () => {
        const task = activeTaskRef.current;
        const snapshot = buildCurrentSessionSnapshot();
        if (snapshot) {
          await persistSessionState(snapshot);
        }
        if (!task || !snapshot) return;
        await updateLiveActivity(
          task,
          new Date(),
          snapshot.accumulatedMs,
          snapshot.paused ? new Date() : undefined,
        );
      })();
    });

    const removeResume = Script.onResume((details) => {
      void (async () => {
        if (!details?.resumeFromMinimized) return;

        const task = activeTaskRef.current;
        const snapshot = buildCurrentSessionSnapshot();
        if (task && snapshot) {
          await persistSessionState(snapshot);
          await updateLiveActivity(
            task,
            new Date(),
            snapshot.accumulatedMs,
            snapshot.paused ? new Date() : undefined,
          );
          return;
        }

        if (tasksLoadedRef.current) {
          await restoreSessionIfNeeded();
        }
      })();
    });

    return () => {
      removeMinimize?.();
      removeResume?.();
    };
  }, []);

  function appendCompletedSegment(
    base: TimerSessionSegment[],
    startAtMs: number | undefined,
    endAtMs: number,
  ): TimerSessionSegment[] {
    if (!startAtMs) return base;
    if (endAtMs <= startAtMs) return base;
    return [...base, { startAt: startAtMs, endAt: endAtMs }];
  }

  async function persistSessionState(next: TimerSession | null) {
    try {
      if (!next) {
        await clearSession();
        return;
      }
      await saveSession(next);
    } catch {
      // ignore session persistence errors
    }
  }

  async function refreshTasks(options?: { waitForDurations?: boolean }) {
    // 读取已保存的任务列表
    try {
      const list = await loadTasks();
      const cachedDurations = await loadTaskDurationsCache();
      const visibleDurations: TaskDurationMap = {};
      for (const task of list) {
        visibleDurations[task.id] = cachedDurations[task.id] ?? 0;
      }
      setTasks(list);
      setTaskDurations(visibleDurations);
      tasksLoadedRef.current = true;
      const durationRefresh = refreshTaskDurations(list, visibleDurations);
      if (options?.waitForDurations) {
        await durationRefresh;
      } else {
        void durationRefresh;
      }
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) });
    }
  }

  async function refreshTaskDurations(list: Task[], initial?: TaskDurationMap) {
    if (!list.length) {
      setTaskDurations({});
      setTaskDurationsLoading(false);
      void saveTaskDurationsCache({});
      return;
    }

    setTaskDurationsLoading(true);
    console.log("[Calendar Pomodoro] duration refresh start", JSON.stringify(list.map((task) => ({ id: task.id, name: task.name, calendarId: task.calendarId }))));
    const totals: TaskDurationMap = { ...(initial ?? taskDurations) };
    for (const task of list) {
      totals[task.id] = totals[task.id] ?? 0;
    }

    for (const task of list) {
      try {
        const events = await loadCalendarEventsByChunks(task);
        totals[task.id] = events.reduce((sum, event) => {
          const startMs = event.startDate?.getTime?.() ?? 0;
          const endMs = event.endDate?.getTime?.() ?? 0;
          return sum + Math.max(0, endMs - startMs);
        }, 0);
        console.log("[Calendar Pomodoro] duration loaded", task.name, events.length, totals[task.id]);
        setTaskDurations({ ...totals });
      } catch (e) {
        console.warn("[Calendar Pomodoro] failed to load task duration", task.name, e);
      }
    }
    setTaskDurationsLoading(false);
    const nextCache: TaskDurationMap = {};
    for (const task of list) {
      nextCache[task.id] = totals[task.id] ?? 0;
    }
    void saveTaskDurationsCache(nextCache);
  }

  function addTaskDurationToCache(
    taskId: string,
    durationMs: number,
  ): TaskDurationMap | null {
    if (durationMs <= 0) return null;
    const next = {
      ...taskDurations,
      [taskId]: (taskDurations[taskId] ?? 0) + durationMs,
    };
    setTaskDurations(next);
    void saveTaskDurationsCache(next);
    return next;
  }

  async function restoreSessionIfNeeded() {
    try {
      const session = await loadSession();
      const activities = await collectLiveActivities();

      // 没有进行中的会话时，清理掉残留的 Live Activity，避免“幽灵计时”
      if (!session || (!session.running && !session.paused)) {
        await endActivities(activities, null);
        await clearSession();
        setCompletedSegments([]);
        return;
      }

      if (!session) return;
      const task = tasks.find((t) => t.id === session.taskId);
      if (!task) {
        await clearSession();
        await endActivities(activities, null);
        setCompletedSegments([]);
        return;
      }

      const now = new Date();
      const sessionStart = new Date(session.sessionStartAt);
      const segmentStart = session.segmentStartAt
        ? new Date(session.segmentStartAt)
        : null;
      const elapsed =
        session.running && segmentStart
          ? session.accumulatedMs + (now.getTime() - segmentStart.getTime())
          : session.accumulatedMs;

      setActiveTaskId(task.id);
      setSessionStartAt(sessionStart);
      setAccumulatedMs(session.accumulatedMs);
      setElapsedMs(elapsed);
      setCompletedSegments(session.segments ?? []);
      setRunning(session.running);
      setPaused(session.paused);
      setSegmentStartAt(session.running ? segmentStart : null);
      const restoredCountdownSeconds =
        session.countdownSeconds ??
        (task.useCountdown ? (task.countdownSeconds ?? 0) : 0);
      setRuntimeCountdownSeconds(
        restoredCountdownSeconds > 0 ? restoredCountdownSeconds : null,
      );
      runtimeCountdownSecondsRef.current =
        restoredCountdownSeconds > 0 ? restoredCountdownSeconds : null;
      setFocusModeText(restoredCountdownSeconds > 0 ? "倒计时" : "正计时");
      setSelectedTaskId(task.id);
      setShowFocusPage(true);

      const calendar = await resolveCalendar(task);
      if (calendar) setActiveCalendar(calendar);

      // 保留当前会话对应的 Live Activity，其他残留的全部结束
      let keepActivity: LiveActivity<TimerActivityState> | null = null;
      let keepId = session.activityId;
      if (!keepId && activities.length) {
        keepId = activities[0]?.id;
        await saveSession({ ...session, activityId: keepId });
      }

      for (const item of activities) {
        if (keepId && item.id === keepId) {
          keepActivity = item.activity;
        } else {
          await endActivities([item], task);
        }
      }

      if (keepActivity) {
        activityRef.current = keepActivity;
        const state = await keepActivity.getActivityState();
        if (state !== "dismissed" && state !== "ended") {
          activityReadyRef.current = true;
          await updateLiveActivity(
            task,
            now,
            elapsed,
            session.paused ? now : undefined,
          );
          return;
        }
        activityRef.current = null;
        activityReadyRef.current = false;
      }

      if (session.running || session.paused) {
        const activityId = await startLiveActivity(task, now, elapsed);
        if (activityId) {
          await saveSession({ ...session, activityId });
        }
      }
    } catch {
      // ignore restore errors
    }
  }

  async function collectLiveActivities(): Promise<
    Array<{ id: string; activity: LiveActivity<TimerActivityState> }>
  > {
    try {
      const ids = await LiveActivity.getAllActivitiesIds();
      const list: Array<{
        id: string;
        activity: LiveActivity<TimerActivityState>;
      }> = [];
      for (const id of ids) {
        const activity = await LiveActivity.from<TimerActivityState>(
          id,
          LIVE_ACTIVITY_NAME,
        );
        if (activity) list.push({ id, activity });
      }
      return list;
    } catch {
      return [];
    }
  }

  function buildFallbackActivityState(now: Date): TimerActivityState {
    return {
      title: "已结束",
      calendarTitle: "",
      from: now.getTime(),
      to: now.getTime() + 1000,
      countsDown: false,
    };
  }

  async function endActivities(
    items: Array<{ id: string; activity: LiveActivity<TimerActivityState> }>,
    task: Task | null,
  ) {
    if (!items.length) return;
    const now = new Date();
    const state = task
      ? buildActivityState(task, now, 0)
      : buildFallbackActivityState(now);
    await Promise.all(
      items.map(async ({ activity }) => {
        try {
          await activity.end(state, { dismissTimeInterval: 0 });
        } catch {
          // ignore
        }
      }),
    );
  }

  async function persistTasks(next: Task[]) {
    // 保存任务，失败时回滚到磁盘内容
    setTasks(next);
    try {
      await saveTasks(next);
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) });
      await refreshTasks();
    }
  }

  async function addTask() {
    // 进入新增任务页
    const task = await Navigation.present<Task>({
      element: <TaskEditView title="添加任务" />,
    });
    if (!task) return;

    // 任务名去重
    if (tasks.some((t) => t.name === task.name)) {
      await Dialog.alert({ message: "任务名称已存在" });
      return;
    }

    await persistTasks([...tasks, task]);
  }

  async function editTask(task: Task) {
    // 计时中不允许编辑当前任务
    if ((running || paused) && activeTaskId === task.id) {
      await Dialog.alert({ message: "请先结束当前任务再编辑" });
      return;
    }
    // 进入编辑任务页
    const updated = await Navigation.present<Task>({
      element: <TaskEditView title="编辑任务" initial={task} />,
    });
    if (!updated) return;
    if (tasks.some((t) => t.id !== task.id && t.name === updated.name)) {
      await Dialog.alert({ message: "任务名称已存在" });
      return;
    }
    const next = tasks.map((t) => (t.id === task.id ? updated : t));
    await persistTasks(next);
  }

  async function openTaskStats(task: Task) {
    // 点击任务行时进入统计页；这里不改变当前计时状态。
    await Navigation.present({
      element: <TaskStatsView task={task} />,
    });
  }

  async function removeTask(task: Task) {
    // 计时中不允许删除当前任务
    if ((running || paused) && activeTaskId === task.id) {
      await Dialog.alert({ message: "请先结束当前任务" });
      return;
    }
    const ok = await Dialog.confirm({ message: `删除任务“${task.name}”？` });
    if (!ok) return;
    const next = tasks.filter((t) => t.id !== task.id);
    await persistTasks(next);
    if (activeTaskId === task.id) setActiveTaskId(null);
  }

  function moveTasks(indices: number[], newOffset: number) {
    // 按 Scripting 文档的 onMove 语义：先取出被拖动项，再插入目标位置。
    const movingItems = indices
      .map((index) => tasks[index])
      .filter((item): item is Task => Boolean(item));
    if (!movingItems.length) return;
    const next = tasks.filter((_, index) => !indices.includes(index));
    next.splice(newOffset, 0, ...movingItems);
    void persistTasks(next);
  }

  async function resolveCalendar(task: Task): Promise<Calendar | null> {
    // 根据任务保存的日历 ID 找到可写日历
    try {
      const list = await Calendar.forEvents();
      const found = list.find((c) => c.identifier === task.calendarId) ?? null;
      if (!found) {
        await Dialog.alert({
          message: `找不到日历：${task.calendarTitle}，请重新选择。`,
        });
        return null;
      }
      if (!found.isForEvents) {
        await Dialog.alert({ message: "所选日历不支持事件" });
        return null;
      }
      if (!found.allowsContentModifications) {
        await Dialog.alert({ message: "所选日历不可写" });
        return null;
      }
      return found;
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) });
      return null;
    }
  }

  async function clearNotifications() {
    // 清空本脚本的所有待发送通知
    try {
      await Notification.removeAllPendingsOfCurrentScript();
    } catch {
      // ignore
    }
  }

  async function scheduleNotifications(task: Task) {
    // 根据任务设置安排重复通知
    try {
      if (!task.useNotification) return;
      const minutes = task.notificationIntervalMinutes ?? 0;
      if (minutes <= 0) return;
      const Trigger = (globalThis as any).TimeIntervalNotificationTrigger;
      if (!Trigger) {
        await Dialog.alert({ message: "当前系统不支持通知触发器。" });
        return;
      }
      // 设置重复触发器（按分钟间隔）
      const trigger = new Trigger({
        timeInterval: minutes * 60,
        repeats: true,
      });
      await clearNotifications();
      const scheduled = await Notification.schedule({
        title: task.name,
        body: "计时提醒",
        threadIdentifier: "calendar-pomodoro",
        interruptionLevel: "active",
        trigger,
      });
      if (!scheduled) {
        await Dialog.alert({ message: "通知未能安排，请检查系统通知权限。" });
        return;
      }
      // 再次检查是否真的进入待发送队列
      const pendings = await Notification.getAllPendingsOfCurrentScript();
      if (!pendings || pendings.length === 0) {
        await Dialog.alert({
          message: "通知未生效，请在系统设置中允许该应用通知。",
        });
      }
    } catch {
      // ignore notification errors to avoid blocking Live Activity
    }
  }

  function buildActivityState(
    task: Task,
    now: Date,
    elapsed: number,
    pausedAt?: Date,
  ): TimerActivityState {
    // 生成 Live Activity 的状态（正计时/倒计时两套）
    const countdownSeconds =
      runtimeCountdownSecondsRef.current ??
      (task.useCountdown ? (task.countdownSeconds ?? 0) : 0);
    if (countdownSeconds > 0) {
      const remaining = Math.max(0, countdownSeconds * 1000 - elapsed);
      const base: TimerActivityState = {
        title: task.name,
        calendarTitle: task.calendarTitle,
        from: now.getTime(),
        to: now.getTime() + remaining,
        countsDown: true,
      };
      return pausedAt ? { ...base, pauseTime: pausedAt.getTime() } : base;
    }
    const from = now.getTime() - elapsed;
    const base: TimerActivityState = {
      title: task.name,
      calendarTitle: task.calendarTitle,
      from,
      to: from + COUNT_UP_WINDOW_MS,
      countsDown: false,
    };
    return pausedAt ? { ...base, pauseTime: pausedAt.getTime() } : base;
  }

  async function ensureLiveActivity(
    createNew = false,
  ): Promise<LiveActivity<TimerActivityState> | null> {
    // 检查系统是否允许 Live Activity
    try {
      const enabled = await LiveActivity.areActivitiesEnabled();
      if (!enabled) return null;
    } catch {
      return null;
    }
    // 需要新实例时重新创建
    if (createNew || !activityRef.current) {
      if (activityRef.current && activityListenerRef.current) {
        activityRef.current.removeUpdateListener(activityListenerRef.current);
      }
      activityRef.current = createTimerActivity();
      activityReadyRef.current = false;
      activityListenerRef.current = (state) => {
        if (state === "stale") {
          const nowTs = Date.now();
          if (nowTs - staleRefreshAtRef.current < 5000) return;
          staleRefreshAtRef.current = nowTs;
          const task = activeTaskRef.current;
          const sessionStart = sessionStartAtRef.current;
          if (task && sessionStart) {
            const now = new Date();
            const segmentStart = segmentStartAtRef.current;
            const segmentElapsed =
              runningRef.current && segmentStart
                ? now.getTime() - segmentStart.getTime()
                : 0;
            const elapsed =
              accumulatedMsRef.current + Math.max(0, segmentElapsed);
            void updateLiveActivity(
              task,
              now,
              elapsed,
              pausedRef.current ? now : undefined,
            );
          }
        }
        if (state === "dismissed" || state === "ended") {
          activityRef.current = null;
          activityReadyRef.current = false;
        }
      };
      activityRef.current.addUpdateListener(activityListenerRef.current);
    }
    return activityRef.current;
  }

  async function startLiveActivity(
    task: Task,
    now: Date,
    elapsed: number,
  ): Promise<string | null> {
    // 启动 Live Activity
    const activity = await ensureLiveActivity(true);
    if (!activity) return null;
    if (activityStartRef.current) {
      const ok = await activityStartRef.current;
      if (!ok) return null;
      activityReadyRef.current = true;
      return activity.activityId ?? null;
    }
    const startPromise = activity.start(
      buildActivityState(task, now, elapsed),
      {
        relevanceScore: 1,
        // 适当延长 staleDate，避免出现加载占位
        staleDate: now.getTime() + 1000 * 60 * 60 * 24,
      },
    );
    activityStartRef.current = startPromise;
    const ok = await startPromise;
    activityStartRef.current = null;
    if (!ok) {
      activityRef.current = null;
      activityReadyRef.current = false;
      return null;
    }
    activityReadyRef.current = true;
    return activity.activityId ?? null;
  }

  async function updateLiveActivity(
    task: Task,
    now: Date,
    elapsed: number,
    pausedAt?: Date,
  ) {
    // 更新 Live Activity 状态（暂停/继续/计时）
    const activity = await ensureLiveActivity();
    if (!activity) return;
    if (!activityReadyRef.current) {
      if (activityStartRef.current) {
        const ok = await activityStartRef.current;
        if (!ok) return;
        activityReadyRef.current = true;
      } else {
        return;
      }
    }
    if (!activity.started) return;
    const ok = await activity.update(
      buildActivityState(task, now, elapsed, pausedAt),
      {
        staleDate: now.getTime() + 1000 * 60 * 60 * 24,
      },
    );
    if (!ok) {
      activityRef.current = null;
      activityReadyRef.current = false;
      const activityId = await startLiveActivity(task, now, elapsed);
      if (activityId && sessionStartAt) {
        await persistSessionState({
          taskId: task.id,
          sessionStartAt: sessionStartAt.getTime(),
          segmentStartAt:
            running && segmentStartAt ? segmentStartAt.getTime() : undefined,
          accumulatedMs,
          segments: completedSegmentsRef.current,
          running,
          paused,
          countdownSeconds: sessionCountdownSecondsForTask(task),
          activityId,
        });
      }
    }
  }

  async function endLiveActivity(task: Task, now: Date, elapsed: number) {
    // 结束 Live Activity
    const activity = activityRef.current;
    if (!activity) return;
    if (!activityReadyRef.current) {
      if (activityStartRef.current) {
        const ok = await activityStartRef.current;
        if (!ok) return;
        activityReadyRef.current = true;
      } else {
        return;
      }
    }
    if (!activity.started) return;
    await activity.end(buildActivityState(task, now, elapsed), {
      dismissTimeInterval: 0,
    });
    if (activityListenerRef.current) {
      activity.removeUpdateListener(activityListenerRef.current);
      activityListenerRef.current = null;
    }
    activityRef.current = null;
    activityReadyRef.current = false;
  }

  async function startTask(task: Task) {
    // 已经在计时当前任务则忽略
    if (running && activeTaskId === task.id) return;

    // 若切换任务，先结束当前任务
    if ((running || paused) && activeTaskId && activeTaskId !== task.id) {
      const ok = await Dialog.confirm({
        message: `当前任务“${activeTask?.name ?? ""}”未结束，是否结束并切换任务？`,
      });
      if (!ok) return;
      await stopTimer();
    }

    // 从暂停状态继续
    if (!running && paused && activeTaskId === task.id && sessionStartAt) {
      const resumeAt = new Date();
      setSegmentStartAt(resumeAt);
      setRunning(true);
      setPaused(false);
      let activityId: string | null | undefined =
        activityRef.current?.activityId;
      if (activityRef.current?.started) {
        await updateLiveActivity(task, resumeAt, accumulatedMs);
      } else {
        activityId = await startLiveActivity(task, resumeAt, accumulatedMs);
      }
      await persistSessionState({
        taskId: task.id,
        sessionStartAt: sessionStartAt.getTime(),
        segmentStartAt: resumeAt.getTime(),
        accumulatedMs,
        segments: completedSegments,
        running: true,
        paused: false,
        countdownSeconds: sessionCountdownSecondsForTask(task),
        activityId: activityId ?? undefined,
      });
      return;
    }

    // 校验日历
    const calendar = await resolveCalendar(task);
    if (!calendar) return;
    if (task.useCountdown && (task.countdownSeconds ?? 0) <= 0) {
      await Dialog.alert({ message: "倒计时时长无效" });
      return;
    }

    // 启动新会话
    const start = new Date();
    setActiveTaskId(task.id);
    setActiveCalendar(calendar);
    setSessionStartAt(start);
    setSegmentStartAt(start);
    setAccumulatedMs(0);
    setElapsedMs(0);
    setCompletedSegments([]);
    setRunning(true);
    setPaused(false);

    // 通知与 Live Activity
    await scheduleNotifications(task);
    const activityId = await startLiveActivity(task, start, 0);
    await persistSessionState({
      taskId: task.id,
      sessionStartAt: start.getTime(),
      segmentStartAt: start.getTime(),
      accumulatedMs: 0,
      segments: [],
      running: true,
      paused: false,
      countdownSeconds: sessionCountdownSecondsForTask(task),
      activityId: activityId ?? undefined,
    });
  }

  async function pauseTimer() {
    // 暂停当前计时
    if (!running || !segmentStartAt) return;
    const now = new Date();
    const nowMs = now.getTime();
    const nextSegments = appendCompletedSegment(
      completedSegments,
      segmentStartAt.getTime(),
      nowMs,
    );
    const total = accumulatedMs + (now.getTime() - segmentStartAt.getTime());
    setAccumulatedMs(total);
    setElapsedMs(total);
    setCompletedSegments(nextSegments);
    setSegmentStartAt(null);
    setRunning(false);
    setPaused(true);
    await clearNotifications();
    if (activeTask) {
      await updateLiveActivity(activeTask, now, total, now);
      if (sessionStartAt) {
        await persistSessionState({
          taskId: activeTask.id,
          sessionStartAt: sessionStartAt.getTime(),
          segmentStartAt: undefined,
          accumulatedMs: total,
          segments: nextSegments,
          running: false,
          paused: true,
          countdownSeconds: sessionCountdownSecondsForTask(activeTask),
          activityId: activityRef.current?.activityId,
        });
      }
    }
  }

  async function cancelTimer() {
    // 取消计时但不写入日历事件
    if (!activeTask || (!running && !paused && !sessionStartAt)) return;
    const now = new Date();
    const segmentElapsed =
      running && segmentStartAt ? now.getTime() - segmentStartAt.getTime() : 0;
    const total = accumulatedMs + Math.max(0, segmentElapsed);
    setRunning(false);
    setPaused(false);
    clearTimer();
    setSessionStartAt(null);
    setSegmentStartAt(null);
    setAccumulatedMs(0);
    setElapsedMs(0);
    setCompletedSegments([]);
    setRuntimeCountdownSeconds(null);
    runtimeCountdownSecondsRef.current = null;
    await clearNotifications();
    await endLiveActivity(activeTask, now, total);
    await persistSessionState(null);

    // 取消后不应保留本次会话草稿，避免下次启动同任务时带出旧笔记。
    setTasks((prev) => {
      const next = prev.map((t) =>
        t.id === activeTask.id ? { ...t, noteDraft: "" } : t,
      );
      void saveTasks(next);
      return next;
    });
    setNoteDraft("");
  }

  async function stopTimer(options?: { auto?: boolean }) {
    // 结束计时并写入日历
    if (stoppingRef.current) return;
    if (!activeTask || !sessionStartAt || !activeCalendar) return;
    if (!running && !paused) return;

    stoppingRef.current = true;
    const now = new Date();
    const nowMs = now.getTime();
    const segmentElapsed =
      running && segmentStartAt ? nowMs - segmentStartAt.getTime() : 0;
    const rawTotal = accumulatedMs + Math.max(0, segmentElapsed);
    let total = rawTotal;
    if (isCountdown && countdownTotalMs > 0) {
      total = Math.min(total, countdownTotalMs);
    }
    const overflowMs = Math.max(0, rawTotal - total);
    let finalSegments = completedSegments;
    if (running && segmentStartAt) {
      const segmentEndMs = nowMs - overflowMs;
      finalSegments = appendCompletedSegment(
        completedSegments,
        segmentStartAt.getTime(),
        segmentEndMs,
      );
    }
    if (!finalSegments.length && total > 0) {
      finalSegments = appendCompletedSegment(
        [],
        sessionStartAt.getTime(),
        sessionStartAt.getTime() + total,
      );
    }
    setElapsedMs(total);
    setRunning(false);
    setPaused(false);
    clearTimer();
    await clearNotifications();

    const overallStartAt =
      finalSegments[0]?.startAt ?? sessionStartAt.getTime();
    const overallEndAt = finalSegments.length
      ? finalSegments[finalSegments.length - 1]!.endAt
      : sessionStartAt.getTime() + total;

    let finalNoteDraft = noteDraft;
    try {
      finalNoteDraft = await editNote(finalNoteDraft, "完成笔记");
      setNoteDraft(finalNoteDraft);
    } catch {
      // 若结束时无法弹出编辑器，则回退到当前草稿继续保存
    }

    // 组合笔记内容：用户笔记 + 总结信息
    const trimmedNote = finalNoteDraft.trim();
    const summaryLines = [
      `开始：${formatDateTime(new Date(overallStartAt))}`,
      `结束：${formatDateTime(new Date(overallEndAt))}`,
      `累计有效时长：${formatDuration(total)}`,
    ];
    const summaryText = summaryLines.join("\n");
    const notePrefix = trimmedNote ? `${trimmedNote}\n\n` : "";

    let savedDurationMs = 0;
    setSaving(true);
    try {
      // 按分段写入日历事件（暂停会切分为多段）
      let savedCount = 0;
      for (let i = 0; i < finalSegments.length; i += 1) {
        const segment = finalSegments[i];
        if (!segment) continue;
        const startDate = new Date(segment.startAt);
        const endDate = new Date(segment.endAt);
        const segmentDuration = Math.max(0, segment.endAt - segment.startAt);
        if (segmentDuration <= 0) continue;

        const event = new CalendarEvent();
        event.title = activeTask.name;
        event.calendar = activeCalendar;
        event.startDate = startDate;
        event.endDate = endDate;
        event.notes = `${notePrefix}分段：${i + 1}/${finalSegments.length}\n开始：${formatDateTime(startDate)}\n结束：${formatDateTime(endDate)}\n时长：${formatDuration(segmentDuration)}\n\n${summaryText}`;
        await event.save();
        savedCount += 1;
        savedDurationMs += segmentDuration;
      }
      if (!options?.auto) {
        const message =
          savedCount > 0
            ? `已保存到日历（共 ${savedCount} 段）`
            : "有效计时时长为 0，未写入日历";
        await Dialog.alert({ message });
      }
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) });
    } finally {
      setSaving(false);
    }

    // 清理 Live Activity，并刷新主页任务总时长。
    await endLiveActivity(activeTask, now, total);
    await persistSessionState(null);
    const refreshedBase =
      addTaskDurationToCache(activeTask.id, savedDurationMs) ?? taskDurations;
    void refreshTaskDurations(tasks, refreshedBase);

    // 清空该任务的笔记草稿
    setTasks((prev) => {
      const next = prev.map((t) =>
        t.id === activeTask.id ? { ...t, noteDraft: "" } : t,
      );
      void saveTasks(next);
      return next;
    });
    setNoteDraft("");

    setSessionStartAt(null);
    setSegmentStartAt(null);
    setAccumulatedMs(0);
    setElapsedMs(0);
    setCompletedSegments([]);
    setRuntimeCountdownSeconds(null);
    runtimeCountdownSecondsRef.current = null;
    stoppingRef.current = false;
  }

  async function editNote(content: string, title = "笔记"): Promise<string> {
    const next = await Navigation.present<string | null>({
      element: <NoteEditorPage title={title} content={content} />,
      modalPresentationStyle: "pageSheet",
    });
    return next == null ? content : String(next);
  }

  async function openNoteEditor() {
    const next = await editNote(noteDraft, "笔记");
    setNoteDraft(next);
  }

  async function toggleSelectedTimer() {
    if (running || paused) {
      await stopTimer();
      return;
    }
    if (!selectedTask) {
      await Dialog.alert({ message: "请先添加或选择一个任务" });
      return;
    }
    const countdownSeconds = Math.max(0, focusMinutes) * 60;
    const taskForSession: Task =
      countdownSeconds > 0
        ? {
            ...selectedTask,
            useCountdown: true,
            countdownSeconds,
          }
        : {
            ...selectedTask,
            useCountdown: false,
            countdownSeconds: undefined,
          };
    setRuntimeCountdownSeconds(countdownSeconds > 0 ? countdownSeconds : null);
    runtimeCountdownSecondsRef.current =
      countdownSeconds > 0 ? countdownSeconds : null;
    setFocusModeText(countdownSeconds > 0 ? "倒计时" : "正计时");
    setSelectedTaskId(selectedTask.id);
    await startTask(taskForSession);
    setShowFocusPage(true);
  }

  function openOverallReport() {
    void Navigation.present({
      element: <OverallReportSheet tasks={tasks} />,
    });
  }

  async function refreshSettings() {
    try {
      const settings = await loadSettings();
      setThemeColor(settings.themeColor || DEFAULT_THEME_COLOR);
    } catch {
      setThemeColor(DEFAULT_THEME_COLOR);
    }
  }

  async function openSettings() {
    const next = await Navigation.present<AppSettings>({
      element: <SettingsView />,
    });
    if (next?.themeColor) {
      setThemeColor(next.themeColor);
      return;
    }
    await refreshSettings();
  }

  async function refreshLiveActivityManually() {
    // 手动刷新 Live Activity（用于修复偶发的 UI 卡住/遮罩）
    const now = new Date();
    if (!activeTask || !sessionStartAt) {
      const activities = await collectLiveActivities();
      await endActivities(activities, null);
      await persistSessionState(null);
      return;
    }
    const segmentElapsed =
      running && segmentStartAt ? now.getTime() - segmentStartAt.getTime() : 0;
    const elapsed = accumulatedMs + Math.max(0, segmentElapsed);
    let activityId = activityRef.current?.activityId ?? null;
    if (activityRef.current?.started) {
      await updateLiveActivity(
        activeTask,
        now,
        elapsed,
        paused ? now : undefined,
      );
    } else {
      activityId = await startLiveActivity(activeTask, now, elapsed);
    }
    await persistSessionState({
      taskId: activeTask.id,
      sessionStartAt: sessionStartAt.getTime(),
      segmentStartAt:
        running && segmentStartAt ? segmentStartAt.getTime() : undefined,
      accumulatedMs,
      segments: completedSegments,
      running,
      paused,
      countdownSeconds: sessionCountdownSecondsForTask(activeTask),
      activityId: activityId ?? undefined,
    });
  }

  async function minimizeScript() {
    // 仅在当前环境支持时才执行最小化
    if (!supportsMinimization) return;
    try {
      await Script.minimize();
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) });
    }
  }

  // 按钮统一触觉反馈：mediumImpact
  const withButtonHaptic = (action: () => void | Promise<void>) => () => {
    HapticFeedback.mediumImpact();
    void action();
  };

  // 状态文案
  const selectedTaskTitle = selectedTask?.name ?? "未选择任务";
  const totalDurationMs = tasks.reduce(
    (sum, task) => sum + (taskDurations[task.id] ?? 0),
    0,
  );
  const maxTimelineOffset = Math.max(0, floorToTimelineStep(TIMELINE_MAX_MINUTES - currentTimelineMinutes));
  const countdownMinutes = Math.max(0, Math.min(maxTimelineOffset, focusMinutes));
  const targetClock = formatClockTime(new Date(Date.now() + countdownMinutes * 60000));
  const startButtonTitle = running || paused ? "Stop" : "Start";
  const timerModeText = countdownMinutes > 0
    ? formatCompactDuration(countdownMinutes * 60000)
    : "Count Up";

  function handleTimelineChanged(value: number) {
    const next = Math.max(0, Math.min(maxTimelineOffset, roundToTimelineStep(value)));
    setTimelineTouched(true);
    setFocusMinutes(next);
    if (lastTimelineFeedbackRef.current !== next) {
      lastTimelineFeedbackRef.current = next;
      HapticFeedback.selection();
      playTimelineTickSound();
    }
  }

  function resetTimelineToNow() {
    const next = floorToTimelineStep(currentMinuteOfDay());
    setCurrentTimelineMinutes(next);
    setFocusMinutes(0);
    setTimelineTouched(false);
  }

  async function refreshHome() {
    // 下拉刷新时重新对齐当前时间；计时中不改变用户当前会话。
    const next = floorToTimelineStep(currentMinuteOfDay());
    setCurrentTimelineMinutes(next);
    if (!runningRef.current && !pausedRef.current) {
      setFocusMinutes(0);
      setTimelineTouched(false);
    }
    await refreshTasks({ waitForDurations: true });
  }

  async function cancelFromFocusPage() {
    await cancelTimer();
    setShowFocusPage(false);
    resetTimelineToNow();
  }

  async function stopFromFocusPage() {
    await stopTimer();
    setShowFocusPage(false);
    resetTimelineToNow();
  }

  async function togglePauseFromFocusPage() {
    if (!activeTask) return;
    if (paused) {
      await startTask(activeTask);
    } else {
      await pauseTimer();
    }
  }

  const focusPage = activeTask ? (
    <FocusTimerPage
      task={activeTask}
      calendarTitle={activeTask.calendarTitle}
      timerText={timerText}
      timerFrom={focusTimerFrom}
      timerTo={focusTimerTo}
      timerPauseTime={focusTimerPauseTime}
      timerCountsDown={isCountdown}
      modeText={focusModeText}
      statusText={running ? "计时中" : paused ? "已暂停" : "已停止"}
      paused={paused}
      saving={saving}
      onCancel={withButtonHaptic(cancelFromFocusPage)}
      onPause={withButtonHaptic(togglePauseFromFocusPage)}
      onStop={withButtonHaptic(stopFromFocusPage)}
      onNote={withButtonHaptic(openNoteEditor)}
    />
  ) : (
    <Text> </Text>
  );

  return (
    <NavigationStack>
      <ZStack
        alignment="bottom"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        fullScreenCover={{
          isPresented: showFocusPage && Boolean(activeTask),
          onChanged: (value: boolean) => setShowFocusPage(value),
          content: focusPage,
        }}
      >
        <ScrollView
          navigationTitle="日历番茄钟"
          navigationBarTitleDisplayMode="inline"
          refreshable={refreshHome}
          toolbar={{
            topBarLeading: (
              <HStack>
                <Button
                  title=""
                  systemImage="xmark.circle"
                  action={withButtonHaptic(() => Script.exit())}
                />
                {supportsMinimization ? (
                  <Button
                    title=""
                    systemImage="minus.circle"
                    action={withButtonHaptic(minimizeScript)}
                  />
                ) : null}
              </HStack>
            ),
            topBarTrailing: (
              <HStack>
                <Menu title="" systemImage="ellipsis.circle">
                  <Button
                    title="刷新实时活动"
                    action={withButtonHaptic(refreshLiveActivityManually)}
                  />
                  <Button
                    title="显示报告"
                    action={withButtonHaptic(openOverallReport)}
                  />
                  <Button
                    title="设置"
                    action={withButtonHaptic(openSettings)}
                  />
                </Menu>
                <Button
                  title=""
                  systemImage="plus.circle"
                  action={withButtonHaptic(addTask)}
                />
              </HStack>
            ),
          }}
        >
          <VStack
            spacing={20}
            padding={{ top: 18, bottom: 230, leading: 18, trailing: 18 }}
            frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
          >
            {tasks.length ? (
              <ReorderableForEach
                data={tasks}
                active={activeReorderTask}
                onMove={moveTasks}
                builder={(task) => {
                  const duration = taskDurations[task.id] ?? 0;
                  const ratio = totalDurationMs > 0 ? duration / totalDurationMs : 0;
                  const isActive = activeTaskId === task.id && (running || paused);
                  const isReordering = activeReorderTask.value?.id === task.id;
                  return (
                    <VStack
                      key={task.id}
                      spacing={8}
                      padding={{ top: 8, bottom: 8, leading: 10, trailing: 10 }}
                      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                      background={isReordering ? "rgba(255, 90, 54, 0.14)" : "rgba(0,0,0,0.001)"}
                      clipShape={{ type: "rect", cornerRadius: 18 } as any}
                      contentShape="rect"
                      scaleEffect={isReordering ? 1.025 : 1}
                      shadow={
                        isReordering
                          ? ({ color: "rgba(255, 90, 54, 0.32)", radius: 16, x: 0, y: 8 } as any)
                          : undefined
                      }
                      zIndex={isReordering ? 20 : 0}
                      onTapGesture={() => {
                        if (saving) return;
                        HapticFeedback.mediumImpact();
                        setSelectedTaskId(task.id);
                        void openTaskStats(task);
                      }}
                      contextMenu={{
                        menuItems: (
                          <VStack>
                            <Button title="查看统计" action={withButtonHaptic(() => openTaskStats(task))} />
                            <Button title="编辑" action={withButtonHaptic(() => editTask(task))} />
                            <Button title="删除" role="destructive" action={withButtonHaptic(() => removeTask(task))} />
                          </VStack>
                        ),
                      }}
                    >
                      <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
                        <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                          <Text font="title3" fontWeight="bold" lineLimit={1}>
                            {task.name}
                          </Text>
                          <Text foregroundStyle="secondaryLabel" lineLimit={1}>
                            # {task.calendarTitle}
                          </Text>
                        </VStack>
                        <Spacer />
                        <Text foregroundStyle={themeColor as any} monospacedDigit>
                          {taskDurationsLoading && duration <= 0 ? "统计中" : formatCompactDuration(duration)}
                        </Text>
                      </HStack>
                      <TaskProgressLine ratio={ratio} active={isActive} tint={themeColor} />
                    </VStack>
                  );
                }}
              />
            ) : (
              <VStack spacing={10} padding={{ top: 40 }}>
                <Text font="title2" fontWeight="bold">暂无任务</Text>
                <Text foregroundStyle="secondaryLabel">点击右上角新增任务。</Text>
              </VStack>
            )}
          </VStack>
        </ScrollView>

        <VStack
          padding={{ bottom: 8, leading: 18, trailing: 18 }}
          frame={{ maxWidth: "infinity", alignment: "bottom" as any }}
        >
          <VStack
            spacing={10}
            padding={{ top: 13, bottom: 12, leading: 18, trailing: 18 }}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            glassEffect={{ type: "rect", cornerRadius: 34 } as any}
          >
            <HStack>
              <Menu
                label={
                  <HStack spacing={6}>
                    <Text foregroundStyle={themeColor as any} font="headline" lineLimit={1}>
                      {selectedTaskTitle}
                    </Text>
                    <Image systemName="play.fill" foregroundStyle={themeColor as any} imageScale="small" />
                  </HStack>
                }
              >
                {tasks.map((task) => (
                  <Button
                    key={task.id}
                    title={task.name}
                    action={withButtonHaptic(() => setSelectedTaskId(task.id))}
                  />
                ))}
              </Menu>
              <Spacer />
              <Button
                title={startButtonTitle}
                buttonStyle="borderedProminent"
                tint={running || paused ? "systemRed" : themeColor as any}
                disabled={!selectedTask || saving}
                action={withButtonHaptic(toggleSelectedTimer)}
              />
            </HStack>

            <TimeAxis
              value={focusMinutes}
              targetLabel={targetClock}
              durationLabel={timerModeText}
              currentMinute={currentTimelineMinutes}
              tint={themeColor}
              disabled={running || paused}
              maxValue={maxTimelineOffset}
              onChanged={handleTimelineChanged}
            />

        
          </VStack>
        </VStack>
      </ZStack>
    </NavigationStack>
  );
}
