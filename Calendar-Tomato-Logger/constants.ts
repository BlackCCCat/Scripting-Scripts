export const BASE_DIR_NAME = "CalendarLoger"
export const TASKS_FILE_NAME = "tasks.json"
export const COUNT_UP_WINDOW_MS = 1000 * 60 * 60 * 24 * 7

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

export const NOTIFICATION_INTERVAL_OPTIONS: { label: string; minutes: number }[] = [
  { label: "5 分钟", minutes: 5 },
  { label: "10 分钟", minutes: 10 },
  { label: "15 分钟", minutes: 15 },
  { label: "30 分钟", minutes: 30 },
  { label: "60 分钟", minutes: 60 },
]
