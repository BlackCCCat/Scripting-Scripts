import type { Task, TimerActivityState } from "../types";
import type { TimerSession, TimerSessionSegment } from "./session";
import { formatDateTime, formatDuration } from "./time";
import { loadSettings } from "./settings";
import { COUNT_UP_WINDOW_MS } from "../constants";

export const ACTIVITY_NAME = "calendar-pomodoro";

export function activityState(task: Task, session: TimerSession, now: number): TimerActivityState {
  const elapsed = session.accumulatedMs + (session.running && session.segmentStartAt
    ? Math.max(0, now - session.segmentStartAt) : 0);
  const remaining = Math.max(0, (session.countdownSeconds ?? 0) * 1000 - elapsed);
  const countsDown = (session.countdownSeconds ?? 0) > 0;
  const from = countsDown ? now : now - elapsed;
  return {
    runId: String(session.sessionStartAt),
    paused: session.paused,
    title: task.name,
    calendarTitle: task.calendarTitle,
    from,
    to: countsDown ? now + remaining : from + COUNT_UP_WINDOW_MS,
    countsDown,
    ...(session.paused ? { pauseTime: now } : {}),
  };
}

export function completedSession(session: TimerSession, now: number) {
  const rawTotal = session.accumulatedMs + (session.running && session.segmentStartAt
    ? Math.max(0, now - session.segmentStartAt) : 0);
  const total = session.countdownSeconds
    ? Math.min(rawTotal, session.countdownSeconds * 1000) : rawTotal;
  const segmentEnd = now - Math.max(0, rawTotal - total);
  const segments: TimerSessionSegment[] = [...(session.segments ?? [])];
  if (session.running && session.segmentStartAt && segmentEnd > session.segmentStartAt) {
    segments.push({ startAt: session.segmentStartAt, endAt: segmentEnd });
  }
  if (!segments.length && total > 0) {
    segments.push({ startAt: session.sessionStartAt, endAt: session.sessionStartAt + total });
  }
  return { total, segments };
}

export async function saveCompletedSession(task: Task, session: TimerSession, noteDraft: string, now: number, options?: {
  savedSegmentEnds?: Record<number, number>;
  onSegmentSaved?: (index: number, endAt: number) => void;
}) {
  const calendar = (await Calendar.forEvents()).find(item => item.identifier === task.calendarId);
  if (!calendar?.isForEvents || !calendar.allowsContentModifications) throw new Error("关联日历不可写，计时尚未结束");
  const { total, segments } = completedSession(session, now);
  const overallStart = segments[0]?.startAt ?? session.sessionStartAt;
  const overallEnd = segments[segments.length - 1]?.endAt ?? session.sessionStartAt + total;
  const summary = [
    `开始：${formatDateTime(new Date(overallStart))}`,
    `结束：${formatDateTime(new Date(overallEnd))}`,
    `累计有效时长：${formatDuration(total)}`,
  ].join("\n");
  const notePrefix = noteDraft.trim() ? `${noteDraft.trim()}\n\n` : "";
  let savedCount = 0;
  let savedDurationMs = 0;
  for (const [index, segment] of segments.entries()) {
    const duration = segment.endAt - segment.startAt;
    if (duration <= 0) continue;
    const eventStart = Math.max(segment.startAt, options?.savedSegmentEnds?.[index] ?? segment.startAt);
    if (eventStart >= segment.endAt) {
      savedCount++;
      savedDurationMs += duration;
      continue;
    }
    const event = new CalendarEvent();
    event.title = task.name;
    event.calendar = calendar;
    event.startDate = new Date(eventStart);
    event.endDate = new Date(segment.endAt);
    event.notes = `${notePrefix}分段：${index + 1}/${segments.length}\n开始：${formatDateTime(event.startDate)}\n结束：${formatDateTime(event.endDate)}\n时长：${formatDuration(segment.endAt - eventStart)}\n\n${summary}`;
    await event.save();
    options?.onSegmentSaved?.(index, segment.endAt);
    savedCount++;
    savedDurationMs += duration;
  }
  await saveMindfulMinutesIfNeeded(task, segments);
  return { savedCount, savedDurationMs, total };
}

async function saveMindfulMinutesIfNeeded(task: Task, segments: TimerSessionSegment[]) {
  if (!task.syncMindfulMinutes || !segments.length) return;
  try {
    if (!(await loadSettings()).linkAppleHealth) return;
    const health = (globalThis as any).Health;
    const factory = (globalThis as any).HealthCategorySample;
    const presence = (globalThis as any).HealthCategoryValuePresence?.present ?? 0;
    if (health?.isHealthDataAvailable === false || typeof health?.saveCategorySample !== "function" || typeof factory?.create !== "function") return;
    for (const segment of segments) {
      if (segment.endAt - segment.startAt < 1000) continue;
      const sample = factory.create({
        type: "mindfulSession", startDate: new Date(segment.startAt), endDate: new Date(segment.endAt),
        value: presence, metadata: { source: "Calendar Pomodoro", taskId: task.id, taskName: task.name },
      });
      if (sample) await health.saveCategorySample(sample);
    }
  } catch (error) {
    console.error("[Calendar Pomodoro] Apple Health 同步失败:", error);
  }
}
