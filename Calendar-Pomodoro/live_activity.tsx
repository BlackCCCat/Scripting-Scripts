import { LiveActivity } from "scripting"
import { liveActivityBuilder } from "./live_activity_ui"

// Live Activity 独立脚本入口：注册并导出创建器
export const PomodoroLiveActivity = LiveActivity.register("calendar-pomodoro", liveActivityBuilder)
