import {
  Form,
  HStack,
  Image,
  Text,
} from "scripting"

import type { HolidayCalendarSource } from "../types"
import { formatDateTime } from "../utils/alarm_runtime"
import { BlockingProgressOverlay } from "./BlockingProgressOverlay"
import { HolidayCalendarMonthView } from "./HolidayPreviewView"
import { GlassSection, GradientPage, GRADIENT_SCROLL_APPEARANCE } from "./PageAppearance"

export function CalendarSettingsView(props: {
  source: HolidayCalendarSource | null
  isRefreshing: boolean
}) {
  const { source } = props
  const now = new Date()
  const currentYear = now.getFullYear()
  const todayKey = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const yearPrefix = `${currentYear}-`
  const offDateKeys = [...new Set(source?.holidayDates.filter((dateKey) => dateKey.startsWith(yearPrefix)))]
  const workDateKeys = [...new Set(source?.holidayItems
    .filter((item) => item.kind === "work" && item.dateKey.startsWith(yearPrefix))
    .map((item) => item.dateKey))]
  const offCount = offDateKeys.length
  const remainingOffCount = offDateKeys.filter((dateKey) => dateKey >= todayKey).length
  const workCount = workDateKeys.length
  const remainingWorkCount = workDateKeys.filter((dateKey) => dateKey >= todayKey).length

  return (
    <GradientPage>
      <Form
        navigationTitle="日历"
        navigationBarTitleDisplayMode="large"
        formStyle="grouped"
        {...GRADIENT_SCROLL_APPEARANCE}
      >
        <GlassSection>
          {source ? (
            <HolidayCalendarMonthView source={source} />
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无可用日历数据。</Text>
          )}
        </GlassSection>
        <GlassSection header={<Text>{`${currentYear} 年 · 剩余 / 总数`}</Text>}>
          <HStack spacing={12}>
            <Image systemName="sun.max.fill" foregroundStyle="systemOrange" frame={{ width: 20 }} accessibilityHidden />
            <Text frame={{ maxWidth: "infinity", alignment: "leading" }}>休息日</Text>
            <Text monospacedDigit foregroundStyle="secondaryLabel">{`${remainingOffCount} / ${offCount}`}</Text>
          </HStack>
          <HStack spacing={12}>
            <Image systemName="briefcase.fill" foregroundStyle="systemTeal" frame={{ width: 20 }} accessibilityHidden />
            <Text frame={{ maxWidth: "infinity", alignment: "leading" }}>调班日</Text>
            <Text monospacedDigit foregroundStyle="secondaryLabel">{`${remainingWorkCount} / ${workCount}`}</Text>
          </HStack>
        </GlassSection>
        <GlassSection
          header={<Text>中国节假日</Text>}
          footer={<Text>底部右侧按钮会刷新内置的中国节假日日历，并自动影响工作日/休息日闹钟规则。</Text>}
        >
          <HStack spacing={12}>
            <Image systemName="calendar.badge.clock" foregroundStyle="systemOrange" frame={{ width: 20 }} accessibilityHidden />
            <Text frame={{ maxWidth: "infinity", alignment: "leading" }}>数据源</Text>
            <Text foregroundStyle="secondaryLabel">{source?.title || "中国节假日"}</Text>
          </HStack>
          <HStack spacing={12}>
            <Image systemName="clock.arrow.circlepath" foregroundStyle="systemBlue" frame={{ width: 20 }} accessibilityHidden />
            <Text frame={{ maxWidth: "infinity", alignment: "leading" }}>上次同步</Text>
            <Text foregroundStyle="secondaryLabel">{source?.lastSyncedAt ? formatDateTime(source.lastSyncedAt) : "尚未同步"}</Text>
          </HStack>
        </GlassSection>
      </Form>

      {props.isRefreshing ? <BlockingProgressOverlay message="正在刷新节假日日历..." glass /> : null}
    </GradientPage>
  )
}
