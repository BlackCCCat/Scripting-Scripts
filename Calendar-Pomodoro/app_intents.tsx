import { AppIntentManager, AppIntentProtocol, Notification } from "scripting";
import {
  controlWithoutMain, loadControlHandlerId, loadControlSnapshot, type LiveControlAction,
} from "./utils/liveActivityControls";

type Params = { runId: string };
type Reply = { ok: boolean; message: string | null };

async function dispatch(action: LiveControlAction, params: Params): Promise<void> {
  const handlerId = loadControlHandlerId();
  if (handlerId) {
    try {
      const result = await ScriptSession.request<Reply>(handlerId, { action, runId: params.runId }, {
        timeout: action === "stop" ? 30000 : 5000,
      });
      if (!result.ok) throw new Error(result.message ?? "主脚本操作失败");
      console.log(`[Calendar Pomodoro][Intent] ${action}:main`);
      return;
    } catch (error: any) {
      const code = String(error?.code ?? "");
      if (code.includes("TIMEOUT")) {
        const snapshot = loadControlSnapshot();
        // 主脚本已经接手保存时，不能在 Intent 中再写一次日历。
        if (action === "stop" && snapshot?.runId === params.runId && snapshot.phase === "saving") throw error;
        if (snapshot?.runId === params.runId &&
            ((action === "stop" && snapshot.phase === "stopped") ||
             (action === "cancel" && snapshot.phase === "cancelled") ||
             (action === "pause" && snapshot.phase === "paused") ||
             (action === "resume" && snapshot.phase === "running"))) return;
      }
      if (!/(NOT_FOUND|CLOSED|UNAVAILABLE|TIMEOUT)/.test(code)) throw error;
      console.warn(`[Calendar Pomodoro][Intent] ${action}:fallback`, code);
    }
  }
  await controlWithoutMain(action, params.runId);
  console.log(`[Calendar Pomodoro][Intent] ${action}:direct`);
}

const register = (name: string, action: LiveControlAction) => AppIntentManager.register<Params>({
  name,
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async params => {
    try {
      console.log(`[Calendar Pomodoro][Intent] ${action}:begin`, params.runId);
      await dispatch(action, params);
    } catch (error) {
      console.error(`[Calendar Pomodoro] 实时活动 ${action} 失败`, error);
      const reason = error instanceof Error ? error.message : String(error);
      await Notification.schedule({
        title: "日历番茄钟实时活动操作失败",
        body: reason.slice(0, 100),
      }).catch(() => false);
    }
  },
});

export const PausePomodoroIntent = register("CalendarPomodoroPause", "pause");
export const ResumePomodoroIntent = register("CalendarPomodoroResume", "resume");
export const StopPomodoroIntent = register("CalendarPomodoroStop", "stop");
export const CancelPomodoroIntent = register("CalendarPomodoroCancel", "cancel");
