import { LiveActivity, Notification } from "scripting";
import type { Task, TimerActivityState } from "../types";
import type { TimerSession } from "./session";
import { ACTIVITY_NAME, activityState, completedSession, saveCompletedSession } from "./activityControl";

const SNAPSHOT_KEY = "calendar-pomodoro:live-control-snapshot";
const HANDLER_KEY = "calendar-pomodoro:live-control-handler";
const STALE_MS = 24 * 60 * 60 * 1000;

export type LiveControlAction = "pause" | "resume" | "stop" | "cancel";
export type LiveControlSnapshot = {
  runId: string;
  task: Task;
  session: TimerSession;
  note: string;
  phase: "running" | "paused" | "saving" | "stopped" | "cancelled";
  updatedAt: number;
  savedSegmentEnds?: Record<number, number>;
};

export function loadControlSnapshot(): LiveControlSnapshot | null {
  return Storage.get<LiveControlSnapshot>(SNAPSHOT_KEY, { shared: true });
}

export function saveControlSnapshot(snapshot: LiveControlSnapshot): void {
  const previous = loadControlSnapshot();
  const next = { ...snapshot, updatedAt: Math.max(snapshot.updatedAt, (previous?.updatedAt ?? 0) + 1) };
  if (!Storage.set(SNAPSHOT_KEY, next, { shared: true })) {
    throw new Error("实时活动会话同步失败");
  }
}

export function publishControlSession(task: Task, session: TimerSession, note: string, allowTransition = false): boolean {
  const previous = loadControlSnapshot();
  const runId = String(session.sessionStartAt);
  if (previous?.runId === runId && (previous.phase === "saving" || previous.phase === "stopped" || previous.phase === "cancelled")) return false;
  if (previous?.runId === runId && !allowTransition && previous.phase !== (session.paused ? "paused" : "running")) return false;
  saveControlSnapshot({
    runId, task, session, note,
    phase: session.paused ? "paused" : "running",
    updatedAt: Date.now(),
    ...(previous?.runId === runId ? { savedSegmentEnds: previous.savedSegmentEnds } : {}),
  });
  return true;
}

export function finishControlSession(runId: string, phase: "stopped" | "cancelled"): void {
  const current = loadControlSnapshot();
  if (current?.runId === runId) saveControlSnapshot({ ...current, phase, updatedAt: Date.now() });
}

export function saveControlNote(runId: string, note: string): void {
  const current = loadControlSnapshot();
  if (current?.runId === runId && (current.phase === "running" || current.phase === "paused")) {
    saveControlSnapshot({ ...current, note, updatedAt: Date.now() });
  }
}

export function markControlSaving(runId: string): Record<number, number> {
  const current = loadControlSnapshot();
  if (!current || current.runId !== runId) return {};
  saveControlSnapshot({ ...current, phase: "saving", updatedAt: Date.now() });
  return current.savedSegmentEnds ?? {};
}

export function restoreControlAfterSaveFailure(runId: string): void {
  const current = loadControlSnapshot();
  if (current?.runId === runId && current.phase === "saving") {
    saveControlSnapshot({ ...current, phase: current.session.paused ? "paused" : "running", updatedAt: Date.now() });
  }
}

export function checkpointControlSegment(runId: string, index: number, endAt: number): void {
  const current = loadControlSnapshot();
  if (current?.runId === runId && (current.savedSegmentEnds?.[index] ?? 0) < endAt) {
    saveControlSnapshot({ ...current, savedSegmentEnds: { ...current.savedSegmentEnds, [index]: endAt }, updatedAt: Date.now() });
  }
}

export function loadControlHandlerId(): string | null {
  return Storage.get<string>(HANDLER_KEY, { shared: true });
}

export function saveControlHandlerId(id: string): void {
  if (!Storage.set(HANDLER_KEY, id, { shared: true })) throw new Error("实时活动控制通道保存失败");
}

export function clearControlHandlerId(id: string): void {
  if (loadControlHandlerId() === id) Storage.remove(HANDLER_KEY, { shared: true });
}

export async function controlWithoutMain(action: LiveControlAction, runId: string): Promise<void> {
  const snapshot = loadControlSnapshot();
  if (!snapshot || snapshot.runId !== runId) throw new Error("计时会话已变更");
  if (snapshot.phase === "saving") throw new Error("正在保存计时，请稍后");
  if (snapshot.phase === "stopped" || snapshot.phase === "cancelled") return;

  const activityId = snapshot.session.activityId;
  if (!activityId) throw new Error("找不到实时活动 ID");
  const activity = await LiveActivity.from<TimerActivityState>(activityId, ACTIVITY_NAME);
  if (!activity) throw new Error("找不到实时活动");
  const now = Date.now();
  const session = snapshot.session;

  if (action === "pause" || action === "resume") {
    if (action === "pause" && snapshot.phase === "paused") return;
    if (action === "resume" && snapshot.phase === "running") return;
    if (snapshot.phase !== (action === "pause" ? "running" : "paused")) throw new Error("当前状态无法执行此操作");
    const elapsed = session.accumulatedMs + (session.running && session.segmentStartAt ? Math.max(0, now - session.segmentStartAt) : 0);
    const nextSession: TimerSession = action === "pause"
      ? {
          ...session, accumulatedMs: elapsed, segmentStartAt: undefined,
          segments: session.segmentStartAt && now > session.segmentStartAt
            ? [...(session.segments ?? []), { startAt: session.segmentStartAt, endAt: now }]
            : session.segments,
          running: false, paused: true,
        }
      : { ...session, segmentStartAt: now, running: true, paused: false };
    if (!await activity.update(activityState(snapshot.task, nextSession, now), { staleDate: now + STALE_MS })) {
      throw new Error("实时活动更新失败");
    }
    saveControlSnapshot({ ...snapshot, session: nextSession, phase: action === "pause" ? "paused" : "running", updatedAt: now });
    if (action === "pause") {
      try { await Notification.removeAllPendingsOfCurrentScript(); }
      catch (error) { console.warn("暂停后清理通知失败", error); }
    }
    if (action === "resume" && snapshot.task.useNotification && (snapshot.task.notificationIntervalMinutes ?? 0) > 0) {
      const Trigger = (globalThis as any).TimeIntervalNotificationTrigger;
      if (Trigger) {
        try { await Notification.schedule({
          title: snapshot.task.name, body: "计时提醒", threadIdentifier: ACTIVITY_NAME,
          interruptionLevel: "active",
          trigger: new Trigger({ timeInterval: snapshot.task.notificationIntervalMinutes! * 60, repeats: true }),
        }); } catch (error) { console.warn("继续后安排通知失败", error); }
      }
    }
    return;
  }

  if (action === "stop") {
    const { total } = completedSession(session, now);
    const finishingSession: TimerSession = { ...session, accumulatedMs: total, segmentStartAt: undefined, running: false, paused: true };
    const saving = { ...snapshot, session: finishingSession, phase: "saving" as const, updatedAt: now };
    saveControlSnapshot(saving);
    try {
      await saveCompletedSession(snapshot.task, session, snapshot.note, now, {
        savedSegmentEnds: saving.savedSegmentEnds,
        onSegmentSaved: (index, endAt) => checkpointControlSegment(runId, index, endAt),
      });
    } catch (error) {
      const latest = loadControlSnapshot();
      if (latest?.runId === runId) saveControlSnapshot({ ...latest, phase: snapshot.phase, session, updatedAt: Date.now() });
      throw error;
    }
  }

  try { await Notification.removeAllPendingsOfCurrentScript(); }
  catch (error) { console.warn("结束后清理通知失败", error); }
  const latest = loadControlSnapshot();
  if (latest?.runId !== runId) throw new Error("计时会话已变更");
  const endedSession: TimerSession = { ...latest.session, running: false, paused: false, activityId: undefined };
  saveControlSnapshot({ ...latest, session: endedSession, phase: action === "stop" ? "stopped" : "cancelled", updatedAt: Date.now() });
  if (!await activity.end(activityState(snapshot.task, endedSession, Date.now()), { dismissTimeInterval: 0 })) {
    throw new Error("操作已完成，但实时活动结束失败");
  }
}
