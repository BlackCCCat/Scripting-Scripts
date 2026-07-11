// 数据存储的根目录名。历史沿用 CalendarLoger，改名会导致已有任务/设置读不到。
export const BASE_DIR_NAME = "CalendarLoger"
// 任务列表文件名
export const TASKS_FILE_NAME = "tasks.json"
// 正计时展示用的窗口长度（用于 Live Activity 的显示区间）
export const COUNT_UP_WINDOW_MS = 1000 * 60 * 60 * 24 * 7

// 预设的通知间隔选项
export const NOTIFICATION_INTERVAL_OPTIONS: { label: string; minutes: number }[] = [
  { label: "5 分钟", minutes: 5 },
  { label: "10 分钟", minutes: 10 },
  { label: "15 分钟", minutes: 15 },
  { label: "30 分钟", minutes: 30 },
  { label: "60 分钟", minutes: 60 },
]
