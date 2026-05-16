import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

import type { AlarmRecord } from "./types"
import {
  loadCustomAlarmState,
  mergeManagedSystemAlarmIds,
  saveCustomAlarmState,
} from "./utils/storage"

type SnoozeIntentParams = {
  alarmId: string
  logicalAlarmId: string
  title: string
  snoozeMinutes: number
}

function buildSnoozeAttributes(
  title: string,
  logicalAlarmId: string,
  snoozeMinutes: number
): AlarmManager.Attributes {
  const alert = AlarmManager.AlertPresentation.create({
    title,
    stopButton: AlarmManager.Button.create({
      title: "关闭",
      textColor: "#FFFFFF",
      systemImageName: "xmark",
    }),
    secondaryButton: AlarmManager.Button.create({
      title: `推迟${snoozeMinutes}分钟`,
      textColor: "#FFFFFF",
      systemImageName: "timer",
    }),
    secondaryBehavior: "custom",
  })

  const attributes = AlarmManager.Attributes.create({
    alert,
    tintColor: "#FF9500",
    metadata: {
      source: "custom-alarm",
      logicalAlarmId,
      snoozeMinutes: String(snoozeMinutes),
    },
  })

  if (!attributes) throw new Error("推迟闹钟属性创建失败")
  return attributes
}

function buildSnoozeConfiguration(params: SnoozeIntentParams): AlarmManager.Configuration {
  // “推迟”会重新注册成一个新的固定时间闹钟，这样它会像正常闹钟一样再次响起。
  const fireDate = new Date(Date.now() + params.snoozeMinutes * 60 * 1000)
  fireDate.setSeconds(0, 0)

  const configuration = AlarmManager.Configuration.alarm({
    schedule: AlarmManager.Schedule.fixed(fireDate),
    attributes: buildSnoozeAttributes(
      params.title,
      params.logicalAlarmId,
      params.snoozeMinutes
    ),
    sound: AlarmManager.Sound.default(),
    secondaryIntent: SnoozeCustomAlarmIntent({
      ...params,
      alarmId: params.alarmId,
    }) as any,
  })

  if (!configuration) throw new Error("推迟闹钟配置创建失败")
  return configuration
}

function appendSnoozeAlarmId(record: AlarmRecord, nextAlarmId: string): AlarmRecord {
  // 把推迟出来的新实例挂回原闹钟记录，后面刷新和删除时才能一起清理。
  return {
    ...record,
    systemAlarmIds: Array.from(new Set([...record.systemAlarmIds, nextAlarmId])),
    lastScheduledAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export const SnoozeCustomAlarmIntent = AppIntentManager.register<SnoozeIntentParams>({
  name: "SnoozeCustomAlarmIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (params: SnoozeIntentParams) => {
    try {
      await AlarmManager.stop(params.alarmId)
    } catch {}

    const nextAlarmId = UUID.string()
    await AlarmManager.schedule(
      nextAlarmId,
      buildSnoozeConfiguration({
        ...params,
        alarmId: nextAlarmId,
      })
    )

    const state = loadCustomAlarmState()
    const nextAlarms = state.alarms.map((record) => {
      if (record.id !== params.logicalAlarmId) return record
      return appendSnoozeAlarmId(record, nextAlarmId)
    })
    saveCustomAlarmState({
      ...state,
      alarms: nextAlarms,
      managedSystemAlarmIds: mergeManagedSystemAlarmIds(state.managedSystemAlarmIds, [nextAlarmId]),
      cleanupCandidateAlarmIds: state.cleanupCandidateAlarmIds,
    })

    try {
      Widget.reloadAll()
    } catch {}
  },
})
