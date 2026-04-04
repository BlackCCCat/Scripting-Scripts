import {
  Form,
  HStack,
  Image,
  NavigationStack,
  Section,
  Text,
} from "scripting"

import type { HolidayCalendarSource } from "../types"
import { formatDateTime } from "../utils/alarm_runtime"
import { DEFAULT_HOLIDAY_SOURCE_ID } from "../utils/storage"
import { HolidayCalendarMonthView } from "./HolidayPreviewView"

export function CalendarSettingsView(props: {
  sources: HolidayCalendarSource[]
  embedded?: boolean
}) {
  const source = props.sources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? props.sources[0] ?? null
  const currentYear = new Date().getFullYear()
  const offCount = source
    ? new Set(
        source.holidayDates.filter((dateKey) => String(dateKey).startsWith(`${currentYear}-`))
      ).size
    : 0
  const workCount = source
    ? new Set(
        source.holidayItems
          .filter((item) => item.kind === "work" && String(item.dateKey).startsWith(`${currentYear}-`))
          .map((item) => item.dateKey)
      ).size
    : 0

  const content = (
      <Form
        navigationTitle="日历"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
      >
        <Section header={<Text>中国节假日</Text>}>
          <HStack spacing={12}>
            <Image systemName="calendar.badge.clock" foregroundStyle="#FF9500" />
            <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>数据源</Text>
            <Text foregroundStyle="secondaryLabel">{source?.title || "中国节假日"}</Text>
          </HStack>
          <HStack spacing={12}>
            <Image systemName="clock.arrow.circlepath" foregroundStyle="#2563EB" />
            <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>上次同步</Text>
            <Text foregroundStyle="secondaryLabel">{source?.lastSyncedAt ? formatDateTime(source.lastSyncedAt) : "尚未同步"}</Text>
          </HStack>
          <HStack spacing={12}>
            <Image systemName="sun.max.fill" foregroundStyle="#EA580C" />
            <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>休息日</Text>
            <Text foregroundStyle="secondaryLabel">{String(offCount)}</Text>
          </HStack>
          <HStack spacing={12}>
            <Image systemName="briefcase.fill" foregroundStyle="#2563EB" />
            <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>调班日</Text>
            <Text foregroundStyle="secondaryLabel">{String(workCount)}</Text>
          </HStack>
        </Section>

        <Section footer={<Text>底部右侧按钮会刷新内置的中国节假日日历，并自动影响工作日/休息日闹钟规则。</Text>}>
          {source ? (
            <HolidayCalendarMonthView source={source} />
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无可用日历数据。</Text>
          )}
        </Section>
      </Form>
  )

  if (props.embedded) return content

  return (
    <NavigationStack>
      {content}
    </NavigationStack>
  )
}
