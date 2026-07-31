import { keyboardHasActiveTouches } from "./keyboard/utils";

export type PerformanceDiagnosticSample = {
  sampleId: number;
  timestamp: string;
  keyboardType: "qwerty" | "t9";
  action: string;
  processKeyMs: number;
  contextReadMs: number;
  candidateCompareMs: number;
  refreshMs: number;
  totalMs: number;
  stateChanged: boolean;
  candidateCount: number;
  preeditLength: number;
  renderCommitMs?: number;
  endToCommitMs?: number;
};

export type PendingPerformanceDiagnosticSample = {
  sampleId: number;
  startedAt: number;
  timestamp: string;
  keyboardType: "qwerty" | "t9";
  action: string;
  processKeyMs: number;
  renderScheduledAt?: number;
};

type StoredPerformanceDiagnostics = {
  version: 1;
  sampleInterval: number;
  updatedAt: string;
  samples: PerformanceDiagnosticSample[];
  pressVisualCommits: number[];
};

const STORAGE_KEY = "rime_keyboard_performance_diagnostics_v1";
const SAMPLE_INTERVAL = 10;
const SAMPLE_LIMIT = 240;
const PRESS_VISUAL_SAMPLE_INTERVAL = 10;
const FLUSH_DELAY_MS = 700;

export function performanceNow() {
  const clock = (globalThis as unknown as {
    performance?: { now?: () => number };
  }).performance;
  return typeof clock?.now === "function" ? clock.now() : Date.now();
}

function roundedMs(value: number) {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

function loadStoredDiagnostics(): StoredPerformanceDiagnostics {
  try {
    const stored = Storage.get<StoredPerformanceDiagnostics>(STORAGE_KEY);
    if (stored?.version === 1 && Array.isArray(stored.samples)) {
      return {
        version: 1,
        sampleInterval: SAMPLE_INTERVAL,
        updatedAt: stored.updatedAt || new Date().toISOString(),
        samples: stored.samples.slice(-SAMPLE_LIMIT),
        pressVisualCommits: Array.isArray(stored.pressVisualCommits)
          ? stored.pressVisualCommits.slice(-SAMPLE_LIMIT)
          : [],
      };
    }
  } catch {
    // Storage can be unavailable while the keyboard process is shutting down.
  }
  return {
    version: 1,
    sampleInterval: SAMPLE_INTERVAL,
    updatedAt: new Date().toISOString(),
    samples: [],
    pressVisualCommits: [],
  };
}

export class KeyboardPerformanceDiagnostics {
  private inputCount = 0;
  private sampleId = 0;
  private pressVisualCommitCount = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private stored: StoredPerformanceDiagnostics;

  constructor() {
    this.stored = loadStoredDiagnostics();
  }

  begin(
    action: string,
    keyboardType: "qwerty" | "t9",
  ): PendingPerformanceDiagnosticSample | null {
    this.inputCount += 1;
    if (this.inputCount % SAMPLE_INTERVAL !== 0) return null;
    return {
      sampleId: ++this.sampleId,
      startedAt: performanceNow(),
      timestamp: new Date().toISOString(),
      keyboardType,
      action,
      processKeyMs: 0,
    };
  }

  complete(
    pending: PendingPerformanceDiagnosticSample,
    values: Omit<
      PerformanceDiagnosticSample,
      | "timestamp"
      | "keyboardType"
      | "action"
      | "processKeyMs"
      | "totalMs"
      | "sampleId"
      | "renderCommitMs"
      | "endToCommitMs"
    >,
  ) {
    this.stored.samples.push({
      sampleId: pending.sampleId,
      timestamp: pending.timestamp,
      keyboardType: pending.keyboardType,
      action: pending.action,
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
    sample.endToCommitMs = roundedMs(committedAt - pending.startedAt);
    this.dirty = true;
    this.scheduleFlush();
  }

  recordPressVisualCommit(durationMs: number) {
    this.pressVisualCommitCount += 1;
    if (this.pressVisualCommitCount % PRESS_VISUAL_SAMPLE_INTERVAL !== 0) {
      return;
    }
    this.stored.pressVisualCommits.push(roundedMs(durationMs));
    if (this.stored.pressVisualCommits.length > SAMPLE_LIMIT) {
      this.stored.pressVisualCommits.splice(
        0,
        this.stored.pressVisualCommits.length - SAMPLE_LIMIT,
      );
    }
    this.dirty = true;
    this.scheduleFlush();
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

  private scheduleFlush() {
    if (this.flushTimer != null) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (keyboardHasActiveTouches()) {
        this.scheduleFlush();
        return;
      }
      this.flush();
    }, FLUSH_DELAY_MS);
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

export function performanceDiagnosticsReport(): string | null {
  const stored = loadStoredDiagnostics();
  const samples = stored.samples;
  if (samples.length === 0) return null;
  const changedCount = samples.filter((sample) => sample.stateChanged).length;
  const renderCommitSamples = samples.flatMap((sample) =>
    sample.renderCommitMs == null ? [] : [sample.renderCommitMs]
  );
  const endToCommitSamples = samples.flatMap((sample) =>
    sample.endToCommitMs == null ? [] : [sample.endToCommitMs]
  );
  const lines = [
    "Scripting Rime Keyboard 性能报告",
    `更新时间: ${stored.updatedAt}`,
    `样本数: ${samples.length}（每 ${SAMPLE_INTERVAL} 次 Rime 按键采样一次）`,
    `状态变化样本: ${changedCount}/${samples.length}`,
    metricLine("processKey", samples.map((sample) => sample.processKeyMs)),
    metricLine("contextRead", samples.map((sample) => sample.contextReadMs)),
    metricLine(
      "candidateCompare",
      samples.map((sample) => sample.candidateCompareMs),
    ),
    metricLine("refresh", samples.map((sample) => sample.refreshMs)),
    metricLine("total", samples.map((sample) => sample.totalMs)),
    metricLine("renderCommit", renderCommitSamples),
    metricLine("endToCommit", endToCommitSamples),
    metricLine("pressVisualCommit", stored.pressVisualCommits),
    "",
    "最近样本:",
    ...samples.slice(-30).map((sample) =>
      [
        sample.timestamp,
        sample.keyboardType,
        sample.action,
        `process=${sample.processKeyMs.toFixed(3)}`,
        `context=${sample.contextReadMs.toFixed(3)}`,
        `compare=${sample.candidateCompareMs.toFixed(3)}`,
        `refresh=${sample.refreshMs.toFixed(3)}`,
        `total=${sample.totalMs.toFixed(3)}`,
        `render=${sample.renderCommitMs?.toFixed(3) ?? "-"}`,
        `endToCommit=${sample.endToCommitMs?.toFixed(3) ?? "-"}`,
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
  } catch {
    // There is nothing else to clear when Storage is unavailable.
  }
}
