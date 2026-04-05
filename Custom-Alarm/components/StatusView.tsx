import {
  Form,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  Section,
  Text,
} from "scripting"

import {
  formatDateTime,
} from "../utils/alarm_runtime"
import { CenterRowButton } from "./CenterRowButton"

function MetricRow(props: {
  icon: string
  title: string
  value: string
  tint?: string
}) {
  const tint = (props.tint ?? "#FF9500") as any
  return (
    <HStack spacing={12}>
      <Image
        systemName={props.icon}
        foregroundStyle={tint}
        frame={{ width: 20, alignment: "center" as any }}
      />
      <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        {props.title}
      </Text>
      <Text foregroundStyle="secondaryLabel">{props.value}</Text>
    </HStack>
  )
}

export function StatusView(props: {
  logicalAlarmCount: number
  enabledCount: number
  managedInstanceCount: number
  currentHolidayTitle: string
  syncedHolidayCount: number
  currentMonthOffCount: number
  currentMonthWorkCount: number
  lastSyncedAt: number | null
  embedded?: boolean
}) {
  const dismiss = Navigation.useDismiss()
  const content = (
    <Form
      navigationTitle="状态"
      navigationBarTitleDisplayMode="inline"
      formStyle="grouped"
    >
      <Section
        header={<Text>闹钟</Text>}
        footer={
          <Text>
            注册到系统闹钟：按当前启用规则计算的本年应响次数
          </Text>
        }
      >
        <MetricRow icon="alarm.fill" title="逻辑闹钟" value={String(props.logicalAlarmCount)} />
        <MetricRow icon="checkmark.circle.fill" title="已启用" value={String(props.enabledCount)} tint="#16A34A" />
        <MetricRow icon="bell.and.waves.left.and.right.fill" title="注册到系统闹钟" value={String(props.managedInstanceCount)} />
      </Section>

      <Section header={<Text>节假日日历</Text>}>
        <MetricRow icon="calendar" title="当前日历" value={props.currentHolidayTitle || "未配置"} />
        <MetricRow icon="flag.fill" title="已同步节假日" value={String(props.syncedHolidayCount)} tint="#EA580C" />
        <MetricRow icon="clock.arrow.circlepath" title="上次同步" value={props.lastSyncedAt ? formatDateTime(props.lastSyncedAt) : "尚未同步"} />
      </Section>

      <Section header={<Text>本月信息</Text>}>
        <MetricRow icon="sun.max.fill" title="可休假天数" value={String(props.currentMonthOffCount)} tint="#EA580C" />
        <MetricRow icon="briefcase.fill" title="调班天数" value={String(props.currentMonthWorkCount)} tint="#2563EB" />
      </Section>

      {!props.embedded && (
        <Section>
          <CenterRowButton title="完成" onPress={() => dismiss()} />
        </Section>
      )}
    </Form>
  )

  if (props.embedded) return content

  return (
    <NavigationStack>
      {content}
    </NavigationStack>
  )
}
