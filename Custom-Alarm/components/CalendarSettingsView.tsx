import {
  Form,
  HStack,
  Image,
  NavigationStack,
  ProgressView,
  Section,
  Text,
  VStack,
  ZStack,
  useColorScheme,
} from "scripting"

import type { HolidayCalendarSource } from "../types"
import { formatDateTime } from "../utils/alarm_runtime"
import { DEFAULT_HOLIDAY_SOURCE_ID } from "../utils/storage"
import { HolidayCalendarMonthView } from "./HolidayPreviewView"

export function CalendarSettingsView(props: {
  sources: HolidayCalendarSource[]
  embedded?: boolean
  isRefreshing?: boolean
}) {
  const colorScheme = useColorScheme()
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
    <ZStack>
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

      {props.isRefreshing ? (
        <VStack
          spacing={12}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
          contentShape="rect"
        >
          <VStack
            spacing={12}
            padding={{ top: 20, bottom: 20, leading: 24, trailing: 24 }}
            shadow={{
              color: colorScheme === "dark" ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)",
              radius: 20,
              y: 8,
            }}
            background={{
              style: colorScheme === "dark" ? "#1F1F22" : "#FFFFFF",
              shape: { type: "rect", cornerRadius: 20 },
            }}
          >
            <ProgressView progressViewStyle="circular" />
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              正在刷新节假日日历...
            </Text>
          </VStack>
        </VStack>
      ) : null}
    </ZStack>
  )

  if (props.embedded) return content

  return (
    <NavigationStack>
      {content}
    </NavigationStack>
  )
}
