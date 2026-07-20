// 人物档案
export interface Person {
  id: string
  name: string
  avatarPath: string | null
  relationship?: string // 人物关系
  notes: string
  isPinned?: boolean // 是否置顶
  createdAt: number
}

// 时光纪念类型
export type EventType =
  | 'birthday'     // 生日
  | 'meet'         // 相识
  | 'love'         // 恋爱
  | 'wedding'      // 结婚
  | 'enrollment'   // 入学
  | 'graduation'   // 毕业
  | 'join'         // 入职
  | 'custom'       // 其他自定义

export type AnniversaryWidgetSize =
  | 'systemSmall'  // 小组件小尺寸
  | 'systemMedium' // 小组件中尺寸
  | 'systemLarge'  // 小组件大尺寸

export type AnniversaryAvatarShape =
  | 'circle'
  | 'rounded'

export type AnniversaryAvatarPosition =
  | 'left'
  | 'right'

// 单条时光纪念/提醒事件
export interface AnniversaryEvent {
  id: string
  personId: string
  title: string
  type: EventType
  isLunar: boolean
  // 公历日期（ISO 字符串 yyyy-MM-dd），作为基准日期
  gregorianDate: string
  // 农历字段（当 isLunar 为 true 时有效）
  lunarYear: number | null
  lunarMonth: number | null
  lunarDay: number | null
  isLeapMonth: boolean
  // 提醒设置
  reminderDays: number[]
  remindOnDay: boolean
  repeatYearly: boolean
  repeatMonthly: boolean // 每月重复
  isPinned?: boolean // 是否置顶
  showYearsAndDays?: boolean // 倒数日是否显示年+天格式
  cardName?: string // 卡片名称，用于首页识别和小组件参数匹配
  denseWatermarkEnabled?: boolean // 中/大卡片非照片区域是否使用密集图标水印
  widgetGradientEnabled?: boolean // 桌面小组件是否使用照片主色渐变背景
  widgetSize?: AnniversaryWidgetSize // 首页卡片/小组件预览尺寸
  avatarShape?: AnniversaryAvatarShape // 首页卡片照片形状
  avatarPosition?: AnniversaryAvatarPosition // 中号卡片照片位置
  photoPath?: string | null // 当前时光纪念自定义照片，空值时使用人物照片
  largeGroupId?: string | null // 大号卡片的两段内容分组
  largePartIndex?: number | null // 大号卡片内的显示顺序：0=第一条，1=第二条
  createdAt: number
}

// 应用全局设置
export interface AppSettings {
  defaultReminderDays: number[]
  defaultRemindOnDay: boolean
  notificationsEnabled: boolean
  groupPastEvents: boolean // 是否将已过的时光纪念归入「时光纪念」分组
  iCloudSyncEnabled: boolean // 是否将时光纪念数据保存到 iCloud
  notificationHour: number // 通知时间（小时，0-23），默认9
  notificationMinute: number // 通知时间（分钟，0-59），默认0
}

// 完整持久化数据
export interface AppData {
  persons: Person[]
  events: AnniversaryEvent[]
  settings: AppSettings
  version: number
}

// 计算后的下次时光纪念信息
export interface OccurrenceInfo {
  event: AnniversaryEvent
  person: Person
  nextDate: Date
  daysLeft: number
  age?: number
  yearsPassed?: number
}
