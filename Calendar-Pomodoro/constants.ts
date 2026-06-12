// 数据存储的根目录名
export const BASE_DIR_NAME = "CalendarLoger"
// 任务列表文件名
export const TASKS_FILE_NAME = "tasks.json"
// 正计时展示用的窗口长度（用于 Live Activity 的显示区间）
export const COUNT_UP_WINDOW_MS = 1000 * 60 * 60 * 24 * 7

// 预设的倒计时选项
export const COUNTDOWN_OPTIONS: { label: string; seconds: number }[] = [
  { label: "5 分钟", seconds: 5 * 60 },
  { label: "10 分钟", seconds: 10 * 60 },
  { label: "15 分钟", seconds: 15 * 60 },
  { label: "25 分钟", seconds: 25 * 60 },
  { label: "30 分钟", seconds: 30 * 60 },
  { label: "45 分钟", seconds: 45 * 60 },
  { label: "60 分钟", seconds: 60 * 60 },
  { label: "90 分钟", seconds: 90 * 60 },
  { label: "120 分钟", seconds: 120 * 60 },
]

// 预设的通知间隔选项
export const NOTIFICATION_INTERVAL_OPTIONS: { label: string; minutes: number }[] = [
  { label: "5 分钟", minutes: 5 },
  { label: "10 分钟", minutes: 10 },
  { label: "15 分钟", minutes: 15 },
  { label: "30 分钟", minutes: 30 },
  { label: "60 分钟", minutes: 60 },
]
