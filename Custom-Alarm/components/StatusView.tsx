import {
  Button,
  Divider,
  Form,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  type Color,
} from "scripting"

import { formatDateTime } from "../utils/alarm_runtime"
import { GlassSection, GradientPage, GRADIENT_SCROLL_APPEARANCE } from "./PageAppearance"

function MetricIcon(props: { icon: string; tint?: Color }) {
  return (
    <Image
      systemName={props.icon}
      foregroundStyle={props.tint ?? "systemOrange"}
      frame={{ width: 20 }}
      accessibilityHidden
    />
  )
}

function MetricRow(props: {
  icon: string
  title: string
  value: string
  tint?: Color
}) {
  return (
    <HStack spacing={12}>
      <MetricIcon icon={props.icon} tint={props.tint} />
      <Text frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {props.title}
      </Text>
      <Text foregroundStyle="secondaryLabel">{props.value}</Text>
    </HStack>
  )
}

function OverviewMetric(props: { title: string; value: number; icon: string; tint: Color }) {
  return (
    <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="largeTitle" fontWeight="bold" monospacedDigit>{String(props.value)}</Text>
      <HStack spacing={5}>
        <MetricIcon icon={props.icon} tint={props.tint} />
        <Text font="subheadline" foregroundStyle="secondaryLabel">{props.title}</Text>
      </HStack>
    </VStack>
  )
}

function MonthMetric(props: { label: string; value: number; icon: string; tint: Color }) {
  return (
    <HStack spacing={2} frame={{ minWidth: 62 }}>
      <MetricIcon icon={props.icon} tint={props.tint} />
      <Text font="subheadline" monospacedDigit accessibilityLabel={`${props.label} ${props.value}`}>
        {String(props.value)}
      </Text>
    </HStack>
  )
}

export function StatusView(props: {
  logicalAlarmCount: number
  enabledCount: number
  managedInstanceCount: number
  cleanupCandidateCount: number
  availableSoundCount: number
  currentHolidayTitle: string
  syncedHolidayCount: number
  currentMonthTotalOffCount: number
  currentMonthRemainingOffCount: number
  currentMonthTotalWorkCount: number
  currentMonthRemainingWorkCount: number
  lastSyncedAt: number | null
  onOpenSoundSettings: () => void
}) {
  const form = (
    <Form
      navigationTitle="状态"
      navigationBarTitleDisplayMode="large"
      formStyle="grouped"
      {...GRADIENT_SCROLL_APPEARANCE}
    >
      <GlassSection
        header={<Text>闹钟</Text>}
        footer={
          <Text>
            注册到系统闹钟：当前仍登记在系统中的闹钟实例
            {"\n"}
            残留闹钟：首页删除后由于意外错误仍残留在系统中的闹钟实例
            {"\n"}
            声音：点击声音行可进入声音管理，导入、编辑或删除自定义闹钟声音
          </Text>
        }
      >
        <HStack spacing={18} padding={{ top: 7, bottom: 9 }}>
          <OverviewMetric title="已启用" value={props.enabledCount} icon="checkmark.circle.fill" tint="systemGreen" />
          <Divider frame={{ height: 50 }} />
          <OverviewMetric title="逻辑闹钟" value={props.logicalAlarmCount} icon="alarm.fill" tint="systemOrange" />
        </HStack>
        <MetricRow icon="bell.and.waves.left.and.right.fill" title="注册到系统闹钟" value={String(props.managedInstanceCount)} />
        <MetricRow icon="exclamationmark.triangle.fill" title="残留闹钟" value={String(props.cleanupCandidateCount)} tint="#DC2626" />
        <Button
          buttonStyle="plain"
          frame={{ maxWidth: "infinity" }}
          action={props.onOpenSoundSettings}
        >
          <HStack
            spacing={12}
            frame={{ maxWidth: "infinity", minHeight: 44, alignment: "leading" }}
            contentShape="rect"
          >
            <MetricIcon icon="speaker.wave.2.fill" />
            <Text>声音</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">{String(props.availableSoundCount)}</Text>
            <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" accessibilityHidden />
          </HStack>
        </Button>
      </GlassSection>

      <GlassSection header={<Text>本月信息</Text>}>
        <VStack spacing={9} padding={{ top: 7, bottom: 7 }}>
          <HStack spacing={8}>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel" frame={{ minWidth: 62 }}>剩余</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" frame={{ minWidth: 62 }}>总计</Text>
          </HStack>
          <Divider />
          <HStack spacing={8}>
            <Text frame={{ maxWidth: "infinity", alignment: "leading" }}>休假天数</Text>
            <MonthMetric label="可休假天数" value={props.currentMonthRemainingOffCount} icon="sun.max.fill" tint="systemOrange" />
            <MonthMetric label="总休假天数" value={props.currentMonthTotalOffCount} icon="calendar.badge.clock" tint="systemOrange" />
          </HStack>
          <Divider />
          <HStack spacing={8}>
            <Text frame={{ maxWidth: "infinity", alignment: "leading" }}>调班天数</Text>
            <MonthMetric label="剩余调班天数" value={props.currentMonthRemainingWorkCount} icon="briefcase.fill" tint="systemTeal" />
            <MonthMetric label="总调班天数" value={props.currentMonthTotalWorkCount} icon="calendar.badge.exclamationmark" tint="systemTeal" />
          </HStack>
        </VStack>
      </GlassSection>

      <GlassSection header={<Text>节假日日历</Text>}>
        <MetricRow icon="calendar" title="当前日历" value={props.currentHolidayTitle || "未配置"} />
        <MetricRow icon="flag.fill" title="已同步节假日" value={String(props.syncedHolidayCount)} tint="systemOrange" />
        <MetricRow icon="clock.arrow.circlepath" title="上次同步" value={props.lastSyncedAt ? formatDateTime(props.lastSyncedAt) : "尚未同步"} />
      </GlassSection>
    </Form>
  )

  return <GradientPage>{form}</GradientPage>
}
