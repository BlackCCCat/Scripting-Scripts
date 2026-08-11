import { type KeyboardActionDiagnosticContext } from "./keyboard/utils";

type PerformanceDiagnosticSample = {
  sampleId: number;
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
  keyId: string;
  pressed: boolean;
  durationMs: number;
};

type TouchDiagnosticSample = {
  touchId: number;
  keyId: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
};

type StoredPerformanceDiagnostics = {
  version: 3;
  sampleInterval: number;
  updatedAt: string;
  samples: PerformanceDiagnosticSample[];
  pressVisualCommits: PressVisualDiagnosticSample[];
  touches: TouchDiagnosticSample[];
};

type PerformanceCompletionValues = {
  contextReadMs: number;
  candidateCompareMs: number;
  refreshMs: number;
  stateChanged: boolean;
  candidateCount: number;
  preeditLength: number;
};

const STORAGE_KEY = "rime_keyboard_performance_diagnostics_v3";
const LEGACY_STORAGE_KEYS = [
  "rime_keyboard_performance_diagnostics_v2",
  "rime_keyboard_performance_diagnostics_v1",
];
const SAMPLE_INTERVAL = 4;
const SAMPLE_LIMIT = 400;
const FLUSH_DELAY_MS = 15000;
const SLOW_QUEUE_SAMPLE_THRESHOLD_MS = 8;
const SLOW_VISUAL_SAMPLE_THRESHOLD_MS = 50;
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

export function performanceNow() {
  const clock = (globalThis as unknown as {
    performance?: { now?: () => number };
  }).performance;
  return typeof clock?.now === "function" ? clock.now() : Date.now();
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

function isPriorityDiagnosticKey(keyId: string) {
  return keyId === "space" || keyId === "numeric-space" ||
    keyId === "comma" || keyId === "backspace" ||
    keyId === "numeric-backspace" || keyId === "t9-backspace";
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
  };
}

export class KeyboardPerformanceDiagnostics {
  private sampleId: number;
  private touchId: number;
  private actionCount = 0;
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

  constructor() {
    this.stored = loadStoredDiagnostics();
    this.sampleId = this.stored.samples.reduce(
      (maximum, sample) => Math.max(maximum, sample.sampleId),
      0,
    );
    this.touchId = this.stored.touches.reduce(
      (maximum, touch) => Math.max(maximum, touch.touchId),
      0,
    );
  }

  begin(
    action: string,
    keyboardType: "qwerty" | "t9",
    context: KeyboardActionDiagnosticContext | null = null,
  ): PendingPerformanceDiagnosticSample | null {
    const keyId = context?.keyId || action;
    const previousKeyId = this.previousKeyId;
    this.previousKeyId = keyId;
    this.actionCount += 1;
    const queueWait = context == null
      ? 0
      : context.actionStartedAt - context.enqueuedAt;
    const shouldSample = this.actionCount % SAMPLE_INTERVAL === 0 ||
      isPriorityDiagnosticKey(keyId) || context?.gesture !== "tap" ||
      queueWait >= SLOW_QUEUE_SAMPLE_THRESHOLD_MS;
    if (!shouldSample) return null;
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
  const samples = stored.samples;
  if (samples.length === 0) return null;
  const changedCount = samples.filter((sample) => sample.stateChanged).length;
  const unresolvedTouchCount =
    stored.touches.filter((touch) => touch.endedAt == null).length;
  const keyGroups = groupedSamples(samples, (sample) => sample.keyId);
  const pairGroups = groupedSamples(samples, (sample) => sample.keyPair);
  const lines = [
    "Scripting Rime Keyboard 增强性能报告",
    `更新时间: ${chinaTime(stored.updatedAt)}`,
    `样本数: ${samples.length}（常规动作每 ${stored.sampleInterval} 次采样，关键动作与慢样本保留）`,
    `状态变化样本: ${changedCount}/${samples.length}`,
    `触摸样本: ${stored.touches.length}，未收到抬起: ${unresolvedTouchCount}`,
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
    ...touchDiagnosticLines(stored.touches, samples),
    "",
    "按压视觉提交统计:",
    ...pressVisualLines(stored.pressVisualCommits),
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
