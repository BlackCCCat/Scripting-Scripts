import {
  isPriorityDiagnosticKey,
  KEYBOARD_ACTION_DIAGNOSTIC_SAMPLE_INTERVAL,
  type KeyboardActionDiagnosticContext,
} from "./keyboard/utils";

type PerformanceDiagnosticSample = {
  sampleId: number;
  runId?: number;
  timestamp: number;
  keyboardType: "qwerty" | "t9";
  keyId: string;
  gesture: string;
  keyPair?: string;
  actionSequence?: number;
  touchDurationMs?: number;
  touchToProcessMs?: number;
  releaseToProcessMs?: number;
  queueWaitMs?: number;
  queueDepthAtEnqueue?: number;
  processKeyMs: number;
  contextReadMs: number;
  candidateCompareMs: number;
  refreshMs: number;
  commitInsertMs?: number;
  markedTextMs?: number;
  totalMs: number;
  stateChanged: boolean;
  candidateCount: number;
  preeditLength: number;
  renderCommitMs?: number;
  processToCommitMs?: number;
  touchToCommitMs?: number;
  releaseToCommitMs?: number;
};

export type PendingPerformanceDiagnosticSample = {
  sampleId: number;
  startedAt: number;
  timestamp: number;
  keyboardType: "qwerty" | "t9";
  keyId: string;
  gesture: string;
  keyPair?: string;
  actionSequence?: number;
  touchStartedAt?: number;
  touchEndedAt?: number;
  touchDurationMs?: number;
  touchToProcessMs?: number;
  releaseToProcessMs?: number;
  queueWaitMs?: number;
  queueDepthAtEnqueue?: number;
  processKeyMs: number;
  renderScheduledAt?: number;
};

type PressVisualDiagnosticSample = {
  runId?: number;
  keyId: string;
  pressed: boolean;
  durationMs: number;
};

type TouchDiagnosticSample = {
  runId?: number;
  touchId: number;
  keyId: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
};

type StartupEvent = {
  name: string;
  timestamp: number;
  detail?: string;
};

type StartupRun = {
  id: number;
  startedAt: number;
  events: StartupEvent[];
};

export type MemorySample = {
  runId: number;
  timestamp: number;
  processBytes: number | null;
  availableBytes: number;
};

type StoredPerformanceDiagnostics = {
  version: 3;
  sampleInterval: number;
  updatedAt: string;
  samples: PerformanceDiagnosticSample[];
  pressVisualCommits: PressVisualDiagnosticSample[];
  touches: TouchDiagnosticSample[];
  startupRuns?: StartupRun[];
};

type PerformanceCompletionValues = {
  contextReadMs: number;
  candidateCompareMs: number;
  refreshMs: number;
  commitInsertMs?: number;
  markedTextMs?: number;
  stateChanged: boolean;
  candidateCount: number;
  preeditLength: number;
};

const STORAGE_KEY = "rime_keyboard_performance_diagnostics_v3";
const MEMORY_STORAGE_KEY = "rime_keyboard_memory_diagnostics_v1";
const LEGACY_STORAGE_KEYS = [
  "rime_keyboard_performance_diagnostics_v2",
  "rime_keyboard_performance_diagnostics_v1",
];
const SAMPLE_INTERVAL = KEYBOARD_ACTION_DIAGNOSTIC_SAMPLE_INTERVAL;
const SAMPLE_LIMIT = 400;
const STARTUP_RUN_LIMIT = 10;
const FLUSH_DELAY_MS = 15000;
const MEMORY_SAMPLE_INTERVAL_MS = 250;
const MEMORY_FLUSH_INTERVAL_MS = 5000;
const MEMORY_SAMPLE_LIMIT = 4800;
const SLOW_VISUAL_SAMPLE_THRESHOLD_MS = 50;
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

export function performanceNow() {
  const clock = (globalThis as unknown as {
    performance?: { now?: () => number };
  }).performance;
  return typeof clock?.now === "function" ? clock.now() : Date.now();
}

function loadMemorySamples(): MemorySample[] {
  try {
    const samples = Storage.get<MemorySample[]>(MEMORY_STORAGE_KEY);
    return Array.isArray(samples) ? samples.slice(-MEMORY_SAMPLE_LIMIT) : [];
  } catch {
    return [];
  }
}

export function memoryDiagnosticsData() {
  const samples = loadMemorySamples();
  const runId = samples.at(-1)?.runId;
  return runId == null ? [] : samples.filter((sample) => sample.runId === runId);
}

export function formatMemoryMiB(bytes: number | null) {
  return bytes == null ? "不可用" : `${(bytes / 1048576).toFixed(1)} MiB`;
}

export class KeyboardMemoryDiagnostics {
  private memorySamples = loadMemorySamples();
  private memoryTimer: ReturnType<typeof setInterval>;
  private memoryDirty = false;
  private lastMemoryFlushAt: number;

  constructor(private readonly runId = Date.now()) {
    this.lastMemoryFlushAt = runId;
    this.recordMemory();
    this.flushMemory();
    this.memoryTimer = setInterval(
      () => this.recordMemory(),
      MEMORY_SAMPLE_INTERVAL_MS,
    );
  }

  private recordMemory() {
    let processBytes: number | null;
    let availableBytes: number;
    try {
      processBytes = Device.processMemoryUsage;
      availableBytes = Device.availableMemory;
    } catch {
      return;
    }
    if (processBytes === undefined) return;
    if (processBytes != null && !Number.isFinite(processBytes)) return;
    if (!Number.isFinite(availableBytes)) availableBytes = 0;
    this.memorySamples.push({
      runId: this.runId,
      timestamp: Date.now(),
      processBytes,
      availableBytes,
    });
    if (this.memorySamples.length > MEMORY_SAMPLE_LIMIT) {
      this.memorySamples = this.memorySamples.filter((_, index) =>
        index % 2 === 0 || index === this.memorySamples.length - 1
      );
    }
    this.memoryDirty = true;
    if (Date.now() - this.lastMemoryFlushAt >= MEMORY_FLUSH_INTERVAL_MS) {
      this.flushMemory();
    }
  }

  private flushMemory() {
    if (!this.memoryDirty) return;
    this.lastMemoryFlushAt = Date.now();
    try {
      Storage.set(MEMORY_STORAGE_KEY, this.memorySamples);
      this.memoryDirty = false;
    } catch {
      // Retry at the next flush interval or when the keyboard closes.
    }
  }

  dispose() {
    clearInterval(this.memoryTimer);
    this.recordMemory();
    this.flushMemory();
  }
}

function roundedMs(value: number) {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

function chinaTime(value: string | number) {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return String(value);
  return new Date(timestamp + CHINA_TIME_OFFSET_MS).toISOString()
    .replace("T", " ")
    .replace("Z", " +08:00");
}

function loadStoredDiagnostics(): StoredPerformanceDiagnostics {
  try {
    const stored = Storage.get<StoredPerformanceDiagnostics>(STORAGE_KEY);
    if (stored?.version === 3 && Array.isArray(stored.samples)) {
      return {
        version: 3,
        sampleInterval: SAMPLE_INTERVAL,
        updatedAt: stored.updatedAt || new Date().toISOString(),
        samples: stored.samples.slice(-SAMPLE_LIMIT),
        pressVisualCommits: Array.isArray(stored.pressVisualCommits)
          ? stored.pressVisualCommits.slice(-SAMPLE_LIMIT)
          : [],
        touches: Array.isArray(stored.touches)
          ? stored.touches.slice(-SAMPLE_LIMIT)
          : [],
        startupRuns: Array.isArray(stored.startupRuns)
          ? stored.startupRuns.slice(-STARTUP_RUN_LIMIT)
          : [],
      };
    }
  } catch {
    // Storage can be unavailable while the keyboard process is shutting down.
  }
  return {
    version: 3,
    sampleInterval: SAMPLE_INTERVAL,
    updatedAt: new Date().toISOString(),
    samples: [],
    pressVisualCommits: [],
    touches: [],
    startupRuns: [],
  };
}

export class KeyboardPerformanceDiagnostics {
  private readonly run: StartupRun;
  private readonly firstEvents = new Set<string>();
  private sampleId: number;
  private touchId: number;
  private touchCount = 0;
  private pressVisualCount = 0;
  private previousKeyId: string | null = null;
  private openTouchesByKey = new Map<
    string,
    Array<TouchDiagnosticSample | null>
  >();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivityAt = 0;
  private dirty = false;
  private stored: StoredPerformanceDiagnostics;

  constructor(startedAt = Date.now()) {
    this.stored = loadStoredDiagnostics();
    this.run = { id: startedAt, startedAt, events: [] };
    this.stored.startupRuns ??= [];
    this.stored.startupRuns.push(this.run);
    if (this.stored.startupRuns.length > STARTUP_RUN_LIMIT) {
      this.stored.startupRuns.shift();
    }
    this.sampleId = this.stored.samples.reduce(
      (maximum, sample) => Math.max(maximum, sample.sampleId),
      0,
    );
    this.touchId = this.stored.touches.reduce(
      (maximum, touch) => Math.max(maximum, touch.touchId),
      0,
    );
  }

  recordStartup(name: string, timestamp = Date.now(), detail?: string) {
    this.run.events.push({ name, timestamp, detail });
    this.lastActivityAt = performanceNow();
    this.dirty = true;
    this.scheduleFlush();
  }

  recordStartupOnce(name: string, detail?: string) {
    if (this.firstEvents.has(name)) return false;
    this.firstEvents.add(name);
    this.recordStartup(name, Date.now(), detail);
    return true;
  }

  begin(
    action: string,
    keyboardType: "qwerty" | "t9",
    context: KeyboardActionDiagnosticContext | null = null,
  ): PendingPerformanceDiagnosticSample | null {
    const firstRimeAction = this.recordStartupOnce(
      "首个 Rime 按键处理",
      action,
    );
    const keyId = context?.keyId || action;
    const previousKeyId = this.previousKeyId;
    this.previousKeyId = keyId;
    const queueWait = context == null
      ? 0
      : context.actionStartedAt - context.enqueuedAt;
    const shouldSample = firstRimeAction || context == null ||
      context.forceSample ||
      context.sampleRequested && !context.sampleConsumed;
    if (!shouldSample) return null;
    if (context && !context.forceSample) context.sampleConsumed = true;
    const startedAt = performanceNow();
    const keyPair = previousKeyId ? `${previousKeyId}→${keyId}` : undefined;
    return {
      sampleId: ++this.sampleId,
      startedAt,
      timestamp: Date.now(),
      keyboardType,
      keyId,
      gesture: context?.gesture ?? "direct",
      keyPair,
      actionSequence: context?.actionSequence,
      touchStartedAt: context?.touchStartedAt,
      touchEndedAt: context?.touchEndedAt,
      touchDurationMs: context?.touchStartedAt == null
        ? undefined
        : roundedMs(context.touchEndedAt - context.touchStartedAt),
      touchToProcessMs: context?.touchStartedAt == null
        ? undefined
        : roundedMs(startedAt - context.touchStartedAt),
      releaseToProcessMs: context == null
        ? undefined
        : roundedMs(startedAt - context.touchEndedAt),
      queueWaitMs: context == null ? undefined : roundedMs(queueWait),
      queueDepthAtEnqueue: context?.queueDepthAtEnqueue,
      processKeyMs: 0,
    };
  }

  complete(
    pending: PendingPerformanceDiagnosticSample,
    values: PerformanceCompletionValues,
  ) {
    this.stored.samples.push({
      sampleId: pending.sampleId,
      runId: this.run.id,
      timestamp: pending.timestamp,
      keyboardType: pending.keyboardType,
      keyId: pending.keyId,
      gesture: pending.gesture,
      keyPair: pending.keyPair,
      actionSequence: pending.actionSequence,
      touchDurationMs: pending.touchDurationMs,
      touchToProcessMs: pending.touchToProcessMs,
      releaseToProcessMs: pending.releaseToProcessMs,
      queueWaitMs: pending.queueWaitMs,
      queueDepthAtEnqueue: pending.queueDepthAtEnqueue,
      processKeyMs: roundedMs(pending.processKeyMs),
      contextReadMs: roundedMs(values.contextReadMs),
      candidateCompareMs: roundedMs(values.candidateCompareMs),
      refreshMs: roundedMs(values.refreshMs),
      commitInsertMs: values.commitInsertMs == null
        ? undefined
        : roundedMs(values.commitInsertMs),
      markedTextMs: values.markedTextMs == null
        ? undefined
        : roundedMs(values.markedTextMs),
      totalMs: roundedMs(performanceNow() - pending.startedAt),
      stateChanged: values.stateChanged,
      candidateCount: values.candidateCount,
      preeditLength: values.preeditLength,
    });
    if (this.stored.samples.length > SAMPLE_LIMIT) {
      this.stored.samples.splice(0, this.stored.samples.length - SAMPLE_LIMIT);
    }
    this.lastActivityAt = performanceNow();
    this.dirty = true;
    this.scheduleFlush();
  }

  recordRimeRenderCommit(pending: PendingPerformanceDiagnosticSample) {
    if (pending.renderScheduledAt == null) return;
    let sample: PerformanceDiagnosticSample | undefined;
    for (let index = this.stored.samples.length - 1; index >= 0; index -= 1) {
      const candidate = this.stored.samples[index];
      if (candidate.sampleId === pending.sampleId) {
        sample = candidate;
        break;
      }
    }
    if (!sample) return;
    const committedAt = performanceNow();
    sample.renderCommitMs = roundedMs(
      committedAt - pending.renderScheduledAt,
    );
    sample.processToCommitMs = roundedMs(committedAt - pending.startedAt);
    if (pending.touchStartedAt != null) {
      sample.touchToCommitMs = roundedMs(committedAt - pending.touchStartedAt);
    }
    if (pending.touchEndedAt != null) {
      sample.releaseToCommitMs = roundedMs(committedAt - pending.touchEndedAt);
    }
    this.lastActivityAt = performanceNow();
    this.dirty = true;
    this.scheduleFlush();
  }

  recordPressVisualCommit(commit: {
    keyId: string;
    pressed: boolean;
    durationMs: number;
  }) {
    this.pressVisualCount += 1;
    if (
      this.pressVisualCount % SAMPLE_INTERVAL !== 0 &&
      !isPriorityDiagnosticKey(commit.keyId) &&
      commit.durationMs < SLOW_VISUAL_SAMPLE_THRESHOLD_MS
    ) return;
    this.stored.pressVisualCommits.push({
      runId: this.run.id,
      keyId: commit.keyId,
      pressed: commit.pressed,
      durationMs: roundedMs(commit.durationMs),
    });
    if (this.stored.pressVisualCommits.length > SAMPLE_LIMIT) {
      this.stored.pressVisualCommits.splice(
        0,
        this.stored.pressVisualCommits.length - SAMPLE_LIMIT,
      );
    }
    this.lastActivityAt = performanceNow();
    this.dirty = true;
    this.scheduleFlush();
  }

  recordTouchStart(keyId: string) {
    this.recordStartupOnce("首次触摸按键", keyId);
    this.touchCount += 1;
    const shouldSample = this.touchCount % SAMPLE_INTERVAL === 0 ||
      isPriorityDiagnosticKey(keyId);
    const openTouches = this.openTouchesByKey.get(keyId);
    if (!shouldSample) {
      if (openTouches) openTouches.push(null);
      else this.openTouchesByKey.set(keyId, [null]);
      return;
    }
    const touch: TouchDiagnosticSample = {
      runId: this.run.id,
      touchId: ++this.touchId,
      keyId,
      startedAt: performanceNow(),
    };
    this.stored.touches.push(touch);
    if (openTouches) openTouches.push(touch);
    else this.openTouchesByKey.set(keyId, [touch]);
    if (this.stored.touches.length > SAMPLE_LIMIT) {
      this.stored.touches.splice(0, this.stored.touches.length - SAMPLE_LIMIT);
    }
    this.lastActivityAt = performanceNow();
    this.dirty = true;
    this.scheduleFlush();
  }

  recordTouchEnd(keyId: string) {
    this.recordStartupOnce("首次抬起按键", keyId);
    const openTouches = this.openTouchesByKey.get(keyId);
    const touch = openTouches?.pop();
    if (openTouches?.length === 0) this.openTouchesByKey.delete(keyId);
    if (!touch) return;
    const endedAt = performanceNow();
    touch.endedAt = endedAt;
    touch.durationMs = roundedMs(endedAt - touch.startedAt);
    this.lastActivityAt = endedAt;
    this.dirty = true;
    this.scheduleFlush();
  }

  cancelOpenTouches() {
    this.openTouchesByKey.clear();
  }

  flush() {
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty) return;
    this.stored.updatedAt = new Date().toISOString();
    try {
      Storage.set(STORAGE_KEY, this.stored);
      this.dirty = false;
    } catch {
      // Keep the in-memory samples for a later flush attempt.
    }
  }

  dispose() {
    this.flush();
  }

  private scheduleFlush(delayMs = FLUSH_DELAY_MS) {
    if (this.flushTimer != null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const idleFor = performanceNow() - this.lastActivityAt;
      if (this.openTouchesByKey.size > 0 || idleFor < FLUSH_DELAY_MS) {
        this.scheduleFlush(Math.max(100, FLUSH_DELAY_MS - idleFor));
        return;
      }
      this.flush();
    }, delayMs);
  }
}

type MetricSummary = {
  average: number;
  p50: number;
  p95: number;
  maximum: number;
};

function summarize(values: number[]): MetricSummary {
  if (values.length === 0) {
    return { average: 0, p50: 0, p95: 0, maximum: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (value: number) =>
    sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))
    ];
  return {
    average: values.reduce((total, value) => total + value, 0) / values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    maximum: sorted[sorted.length - 1],
  };
}

function metricLine(name: string, values: number[]) {
  const summary = summarize(values);
  return `${name}: avg=${summary.average.toFixed(3)}ms, p50=${
    summary.p50.toFixed(3)
  }ms, p95=${summary.p95.toFixed(3)}ms, max=${summary.maximum.toFixed(3)}ms`;
}

function optionalMetric(
  samples: PerformanceDiagnosticSample[],
  value: (sample: PerformanceDiagnosticSample) => number | undefined,
) {
  return samples.flatMap((sample) => {
    const result = value(sample);
    return result == null ? [] : [result];
  });
}

function groupedSamples(
  samples: PerformanceDiagnosticSample[],
  key: (sample: PerformanceDiagnosticSample) => string | undefined,
) {
  const groups = new Map<string, PerformanceDiagnosticSample[]>();
  for (const sample of samples) {
    const groupKey = key(sample);
    if (!groupKey) continue;
    const group = groups.get(groupKey);
    if (group) group.push(sample);
    else groups.set(groupKey, [sample]);
  }
  return [...groups.entries()].sort((left, right) =>
    right[1].length - left[1].length || left[0].localeCompare(right[0])
  );
}

function groupedPerformanceLine(
  name: string,
  samples: PerformanceDiagnosticSample[],
) {
  const queue = summarize(
    optionalMetric(samples, (sample) => sample.queueWaitMs),
  );
  const process = summarize(samples.map((sample) => sample.processKeyMs));
  const commit = summarize(
    optionalMetric(samples, (sample) => sample.releaseToCommitMs),
  );
  const maxDepth = samples.reduce(
    (maximum, sample) => Math.max(maximum, sample.queueDepthAtEnqueue ?? 0),
    0,
  );
  return `${name}: n=${samples.length} | queue p50=${
    queue.p50.toFixed(3)
  } p95=${queue.p95.toFixed(3)} max=${queue.maximum.toFixed(3)} | process p50=${
    process.p50.toFixed(3)
  } p95=${process.p95.toFixed(3)} max=${
    process.maximum.toFixed(3)
  } | releaseToCommit p50=${commit.p50.toFixed(3)} p95=${
    commit.p95.toFixed(3)
  } max=${commit.maximum.toFixed(3)} | maxDepth=${maxDepth}`;
}

function pressVisualLines(commits: PressVisualDiagnosticSample[]) {
  const groups = new Map<string, number[]>();
  for (const commit of commits) {
    const key = `${commit.keyId}:${commit.pressed ? "down" : "up"}`;
    const values = groups.get(key);
    if (values) values.push(commit.durationMs);
    else groups.set(key, [commit.durationMs]);
  }
  return [...groups.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, 30)
    .map(([key, values]) =>
      `${key} | n=${values.length} | ${metricLine("commit", values)}`
    );
}

function touchDiagnosticLines(
  touches: TouchDiagnosticSample[],
  samples: PerformanceDiagnosticSample[],
) {
  const groups = new Map<string, TouchDiagnosticSample[]>();
  const actionCounts = new Map<string, number>();
  for (const touch of touches) {
    const group = groups.get(touch.keyId);
    if (group) group.push(touch);
    else groups.set(touch.keyId, [touch]);
  }
  for (const sample of samples) {
    actionCounts.set(sample.keyId, (actionCounts.get(sample.keyId) ?? 0) + 1);
  }
  return [...groups.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, 40)
    .map(([key, values]) => {
      const ended = values.filter((touch) => touch.endedAt != null);
      const duration = ended.flatMap((touch) =>
        touch.durationMs == null ? [] : [touch.durationMs]
      );
      return `${key}: starts=${values.length} | ends=${ended.length} | unresolved=${
        values.length - ended.length
      } | rimeActions=${actionCounts.get(key) ?? 0} | ${
        metricLine("duration", duration)
      }`;
    });
}

export function performanceDiagnosticsReport(): string | null {
  const stored = loadStoredDiagnostics();
  const latestRun = stored.startupRuns?.at(-1);
  const memorySamples = memoryDiagnosticsData();
  const measuredMemory = memorySamples.flatMap((sample) =>
    sample.processBytes == null ? [] : [sample.processBytes]
  );
  const samples = latestRun
    ? stored.samples.filter((sample) => sample.runId === latestRun.id)
    : stored.samples;
  const touches = latestRun
    ? stored.touches.filter((touch) => touch.runId === latestRun.id)
    : stored.touches;
  const pressVisualCommits = latestRun
    ? stored.pressVisualCommits.filter((commit) =>
      commit.runId === latestRun.id
    )
    : stored.pressVisualCommits;
  if (samples.length === 0 && !latestRun && memorySamples.length === 0) {
    return null;
  }
  const changedCount = samples.filter((sample) => sample.stateChanged).length;
  const unresolvedTouchCount =
    touches.filter((touch) => touch.endedAt == null).length;
  const keyGroups = groupedSamples(samples, (sample) => sample.keyId);
  const pairGroups = groupedSamples(samples, (sample) => sample.keyPair);
  const startupEvents = [...(latestRun?.events ?? [])].sort((a, b) =>
    a.timestamp - b.timestamp
  );
  const readyEvent = startupEvents.find((event) =>
    event.name === "Rime 可输入" ||
    event.name === "键盘可输入（无方案）" ||
    event.name === "Rime 准备失败，键盘回退输入"
  );
  const firstTouchEvent = startupEvents.find((event) =>
    event.name === "首次触摸按键"
  );
  const lines = [
    "Scripting Rime Keyboard 增强性能报告",
    `更新时间: ${chinaTime(stored.updatedAt)}`,
    `样本数: ${samples.length}（本次运行；常规动作每 ${stored.sampleInterval} 次采样，关键动作与慢样本保留）`,
    `状态变化样本: ${changedCount}/${samples.length}`,
    `触摸样本: ${touches.length}，未收到抬起: ${unresolvedTouchCount}`,
    "",
    "键盘启动与 Rime 准备时间线:",
    ...(readyEvent && latestRun
      ? [`启动到可输入: ${roundedMs(readyEvent.timestamp - latestRun.startedAt).toFixed(3)}ms`]
      : []),
    ...(readyEvent && firstTouchEvent
      ? [`首次触摸相对可输入: ${(
        firstTouchEvent.timestamp - readyEvent.timestamp
      ).toFixed(3)}ms（负数表示 Rime 就绪前触摸）`]
      : []),
    ...(startupEvents.length && latestRun
      ? startupEvents.map((event, index) => {
        const elapsed = roundedMs(event.timestamp - latestRun.startedAt);
        const gap = roundedMs(
          event.timestamp -
            (startupEvents[index - 1]?.timestamp ?? latestRun.startedAt),
        );
        return `${chinaTime(event.timestamp)} | +${elapsed.toFixed(3)}ms | 距前节点 ${gap.toFixed(3)}ms | ${event.name}${event.detail ? ` | ${event.detail}` : ""}`;
      })
      : ["无启动记录（旧版报告）"]),
    "",
    "键盘扩展宿主进程内存（含宿主及同进程脚本）:",
    ...(memorySamples.length && latestRun?.id !== memorySamples[0].runId
      ? ["内存记录与按键统计来自不同次键盘运行；可能是上次运行在写入性能统计前退出。"]
      : []),
    `原始采样间隔: ${MEMORY_SAMPLE_INTERVAL_MS}ms，样本数: ${memorySamples.length}，有效占用样本: ${measuredMemory.length}（超限时压缩较早的采样）`,
    ...(measuredMemory.length
      ? [
        `占用: 初始 ${formatMemoryMiB(measuredMemory[0])}，当前 ${formatMemoryMiB(measuredMemory.at(-1)!)}，最低 ${formatMemoryMiB(Math.min(...measuredMemory))}，峰值 ${formatMemoryMiB(Math.max(...measuredMemory))}，平均 ${formatMemoryMiB(measuredMemory.reduce((sum, value) => sum + value, 0) / measuredMemory.length)}`,
      ]
      : []),
    `当前可用额度估计: ${formatMemoryMiB(memorySamples.at(-1)?.availableBytes || null)}（0 可能表示不可用）`,
    ...memorySamples.map((sample) =>
      `${chinaTime(sample.timestamp)} | 占用=${formatMemoryMiB(sample.processBytes)} | 可用额度=${formatMemoryMiB(sample.availableBytes || null)}`
    ),
    "",
    metricLine(
      "touchDuration",
      optionalMetric(samples, (sample) => sample.touchDurationMs),
    ),
    metricLine(
      "touchToProcess",
      optionalMetric(samples, (sample) => sample.touchToProcessMs),
    ),
    metricLine(
      "releaseToProcess",
      optionalMetric(samples, (sample) => sample.releaseToProcessMs),
    ),
    metricLine(
      "queueWait",
      optionalMetric(samples, (sample) => sample.queueWaitMs),
    ),
    metricLine("processKey", samples.map((sample) => sample.processKeyMs)),
    metricLine("contextRead", samples.map((sample) => sample.contextReadMs)),
    metricLine(
      "candidateCompare",
      samples.map((sample) => sample.candidateCompareMs),
    ),
    metricLine("refresh", samples.map((sample) => sample.refreshMs)),
    metricLine(
      "commitInsert",
      optionalMetric(samples, (sample) => sample.commitInsertMs),
    ),
    metricLine(
      "markedText",
      optionalMetric(samples, (sample) => sample.markedTextMs),
    ),
    metricLine("processTotal", samples.map((sample) => sample.totalMs)),
    metricLine(
      "renderCommit",
      optionalMetric(samples, (sample) => sample.renderCommitMs),
    ),
    metricLine(
      "processToCommit",
      optionalMetric(samples, (sample) => sample.processToCommitMs),
    ),
    metricLine(
      "touchToCommit",
      optionalMetric(samples, (sample) => sample.touchToCommitMs),
    ),
    metricLine(
      "releaseToCommit",
      optionalMetric(samples, (sample) => sample.releaseToCommitMs),
    ),
    `queueDepth: max=${
      samples.reduce((maximum, sample) =>
        Math.max(maximum, sample.queueDepthAtEnqueue ?? 0), 0)
    }`,
    "",
    "按键统计:",
    ...keyGroups.slice(0, 40).map(([key, group]) =>
      groupedPerformanceLine(key, group)
    ),
    "",
    "相邻按键组合统计:",
    ...pairGroups.slice(0, 40).map(([pair, group]) =>
      groupedPerformanceLine(pair, group)
    ),
    "",
    "触摸事件统计:",
    ...touchDiagnosticLines(touches, samples),
    "",
    "按压视觉提交统计:",
    ...pressVisualLines(pressVisualCommits),
    "",
    "最近样本:",
    ...samples.slice(-40).map((sample) =>
      [
        chinaTime(sample.timestamp),
        `seq=${sample.actionSequence ?? "-"}`,
        sample.keyboardType,
        `key=${sample.keyId}`,
        `gesture=${sample.gesture}`,
        `pair=${sample.keyPair ?? "-"}`,
        `touch=${sample.touchDurationMs?.toFixed(3) ?? "-"}`,
        `touchToProcess=${sample.touchToProcessMs?.toFixed(3) ?? "-"}`,
        `releaseToProcess=${sample.releaseToProcessMs?.toFixed(3) ?? "-"}`,
        `queue=${sample.queueWaitMs?.toFixed(3) ?? "-"}`,
        `depth=${sample.queueDepthAtEnqueue ?? "-"}`,
        `process=${sample.processKeyMs.toFixed(3)}`,
        `context=${sample.contextReadMs.toFixed(3)}`,
        `compare=${sample.candidateCompareMs.toFixed(3)}`,
        `refresh=${sample.refreshMs.toFixed(3)}`,
        `insert=${sample.commitInsertMs?.toFixed(3) ?? "-"}`,
        `marked=${sample.markedTextMs?.toFixed(3) ?? "-"}`,
        `total=${sample.totalMs.toFixed(3)}`,
        `render=${sample.renderCommitMs?.toFixed(3) ?? "-"}`,
        `processToCommit=${sample.processToCommitMs?.toFixed(3) ?? "-"}`,
        `touchToCommit=${sample.touchToCommitMs?.toFixed(3) ?? "-"}`,
        `releaseToCommit=${sample.releaseToCommitMs?.toFixed(3) ?? "-"}`,
        `changed=${sample.stateChanged ? 1 : 0}`,
        `candidates=${sample.candidateCount}`,
        `preeditLength=${sample.preeditLength}`,
      ].join(" | ")
    ),
  ];
  return lines.join("\n");
}

export function clearPerformanceDiagnostics() {
  try {
    Storage.remove(STORAGE_KEY);
    for (const key of LEGACY_STORAGE_KEYS) Storage.remove(key);
  } catch {
    // There is nothing else to clear when Storage is unavailable.
  }
}

export function clearMemoryDiagnostics() {
  try {
    Storage.remove(MEMORY_STORAGE_KEY);
  } catch {
    // There is nothing else to clear when Storage is unavailable.
  }
}
