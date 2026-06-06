// 单个任务的持久化结构
export type Task = {
  // 任务唯一 ID
  id: string
  // 任务名称
  name: string
  // 关联日历 ID
  calendarId: string
  // 关联日历名称（用于展示）
  calendarTitle: string
  // 历史兼容字段：现在所有任务都通过 AlarmManager 倒计时运行
  useCountdown?: boolean
  // 是否为不限时任务（内部使用系统可接受的倒计时承载）
  unlimited?: boolean
  // 倒计时总秒数
  countdownSeconds?: number
  // 是否使用通知
  useNotification?: boolean
  // 通知间隔分钟数
  notificationIntervalMinutes?: number
  // 笔记草稿（自动保存）
  noteDraft?: string
}

// Live Activity 需要的状态结构
export type TimerActivityState = {
  // 任务标题
  title: string
  // 右侧显示的日历名称
  calendarTitle?: string
  // 计时起点（毫秒时间戳）
  from: number
  // 计时终点（毫秒时间戳）
  to: number
  // 是否倒计时
  countsDown: boolean
  // 是否为不限时任务（用于选择无穷图标）
  unlimited?: boolean
  // 暂停时刻（用于暂停显示）
  pauseTime?: number
}
