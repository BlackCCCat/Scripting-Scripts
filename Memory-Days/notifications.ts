import { AnniversaryEvent, Person, AppSettings } from './types'
import { localDate, getYearsPassed, getNextOccurrence } from './dateUtils'
import { Notification } from 'scripting'

// 通知范围：未来365天内（一个完整年度周期）
const NOTIFICATION_RANGE_DAYS = 365

// 计算提醒触发时间：目标日指定时间
function reminderDateFor(baseDate: Date, daysBefore: number, hour: number = 9, minute: number = 0): Date {
  const date = localDate(baseDate.getFullYear(), baseDate.getMonth() + 1, baseDate.getDate())
  date.setDate(date.getDate() - daysBefore)
  date.setHours(hour, minute, 0, 0)
  return date
}

// 获取人物显示名称
function displayName(person: Person): string {
  return person.name
}

// 根据事件类型生成标签
function eventLabel(event: AnniversaryEvent): string {
  switch (event.type) {
    case 'birthday': return '生日'
    case 'meet': return '相识'
    case 'love': return '恋爱'
    case 'wedding': return '结婚'
    case 'enrollment': return '入学'
    case 'graduation': return '毕业'
    case 'join': return '入职'
    default: return event.title || '时光纪念'
  }
}

// 生成周年描述（如「第3年」），首年返回空
function yearsSuffix(event: AnniversaryEvent, targetYear: number): string {
  const years = getYearsPassed(event, targetYear)
  if (!years || years <= 0) return ''
  if (event.type === 'birthday') return `${years}岁`
  return `第${years}年`
}

// 从事件与人物生成通知文案
function buildNotificationContent(
  event: AnniversaryEvent,
  person: Person,
  daysBefore: number,
  targetYear: number
): { title: string; body: string } {
  const name = displayName(person)
  const label = eventLabel(event)
  const suffix = yearsSuffix(event, targetYear)

  if (daysBefore === 0) {
    const titleText = `今天是 ${name} 的${label}`
    const body = buildTodayBody(event, name, label, suffix)
    return { title: titleText, body }
  }

  const timeHint = daysBefore === 1 ? '明天' : `${daysBefore}天后`
  const titleText = `${timeHint}是 ${name} 的${label}`
  const body = buildAheadBody(event, name, label, daysBefore)
  return { title: titleText, body }
}

// 当天 body 文案
function buildTodayBody(event: AnniversaryEvent, name: string, label: string, suffix: string): string {
  switch (event.type) {
    case 'birthday':
      return suffix
        ? `${name}今天${suffix}了，去说声生日快乐吧`
        : `今天是${name}的生日，去说声生日快乐吧`
    case 'love':
    case 'wedding': {
      const num = suffix.replace('第', '').replace('年', '')
      return suffix
        ? `不知不觉已经一起走过${num}年了，今天好好庆祝一下`
        : `和${name}的特别日子，今天好好庆祝一下`
    }
    case 'meet': {
      const num = suffix.replace('第', '').replace('年', '')
      return suffix
        ? `认识${name}已经${num}年了，真快`
        : `还记得和${name}第一次见面的那天吗`
    }
    case 'graduation':
      return `从校园到如今，值得记住的一天`
    default:
      return event.title
        ? `今天是${name}「${event.title}」的日子`
        : `今天是${name}的${label}`
  }
}

// 提前提醒 body 文案
function buildAheadBody(event: AnniversaryEvent, name: string, label: string, daysBefore: number): string {
  switch (event.type) {
    case 'birthday':
      if (daysBefore === 1) return `明天就是${name}的生日了`
      if (daysBefore <= 3) return `${name}的生日快到了，可以提前准备一下`
      return `距离${name}的生日还有${daysBefore}天`
    case 'love':
    case 'wedding':
      if (daysBefore === 1) return `明天是和${name}的${label}了`
      if (daysBefore <= 3) return `和${name}的${label}快到了`
      return `距离和${name}的${label}还有${daysBefore}天`
    default:
      if (daysBefore === 1) return `明天是${name}的${label}`
      return `距离${name}的${label}还有${daysBefore}天`
  }
}

// 调度单条通知
async function scheduleOne(
  event: AnniversaryEvent,
  person: Person,
  targetDate: Date,
  year: number,
  daysBefore: number,
  notificationHour: number = 9,
  notificationMinute: number = 0
): Promise<boolean> {
  const triggerDate = reminderDateFor(targetDate, daysBefore, notificationHour, notificationMinute)
  const now = new Date()
  // 不调度已经过期的时间点
  if (triggerDate <= now) return true

  const { title, body } = buildNotificationContent(event, person, daysBefore, year)
  const dateComponents = new DateComponents({
    year: triggerDate.getFullYear(),
    month: triggerDate.getMonth() + 1,
    day: triggerDate.getDate(),
    hour: triggerDate.getHours(),
    minute: triggerDate.getMinutes()
  })
  return await Notification.schedule({
    title,
    body,
    userInfo: { eventId: event.id, personId: person.id, daysBefore, year },
    trigger: new CalendarNotificationTrigger({ dateMatching: dateComponents, repeats: false })
  })
}

// 为某个事件调度通知（基于事件的周年周期，而非自然年）
async function scheduleForEvent(
  event: AnniversaryEvent,
  person: Person,
  settings: AppSettings
): Promise<void> {
  if (!settings.notificationsEnabled) return
  if (event.reminderDays.length === 0 && !event.remindOnDay) return

  const now = new Date()
  // 获取事件的下一个发生日期
  const nextDate = getNextOccurrence(event, now)
  if (!nextDate) return

  // 对于不重复事件，如果事件日期早于今天（不含今天），不创建通知
  // 今天的通知由 scheduleOne 判断触发时间是否已过
  if (!event.repeatYearly && !event.repeatMonthly) {
    const today = localDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
    const eventDay = localDate(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate())
    if (eventDay < today) return
  }

  // 计算事件日期到今天的天数差
  const daysUntilEvent = Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  // 如果事件超过通知范围，跳过
  if (daysUntilEvent > NOTIFICATION_RANGE_DAYS) return

  const year = nextDate.getFullYear()
  const notificationHour = settings.notificationHour ?? 9
  const notificationMinute = settings.notificationMinute ?? 0
  
  if (event.remindOnDay) {
    await scheduleOne(event, person, nextDate, year, 0, notificationHour, notificationMinute)
  }
  for (const days of event.reminderDays) {
    if (days > 0) {
      await scheduleOne(event, person, nextDate, year, days, notificationHour, notificationMinute)
    }
  }
}

// 重新调度全部通知
export async function refreshNotifications(
  events: AnniversaryEvent[],
  persons: Person[],
  settings: AppSettings
): Promise<void> {
  // 清除本脚本的全部待通知
  await Notification.removeAllPendingsOfCurrentScript()

  if (!settings.notificationsEnabled) return

  const personMap = new Map(persons.map(p => [p.id, p]))
  for (const event of events) {
    const person = personMap.get(event.personId)
    if (person) {
      await scheduleForEvent(event, person, settings)
    }
  }
}
