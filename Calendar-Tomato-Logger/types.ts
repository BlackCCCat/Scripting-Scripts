export type Task = {
  id: string
  name: string
  calendarId: string
  calendarTitle: string
  useCountdown?: boolean
  countdownSeconds?: number
  useNotification?: boolean
  notificationIntervalMinutes?: number
  noteDraft?: string
}

export type TimerActivityState = {
  title: string
  calendarTitle?: string
  from: number
  to: number
  countsDown: boolean
  pauseTime?: number
}
