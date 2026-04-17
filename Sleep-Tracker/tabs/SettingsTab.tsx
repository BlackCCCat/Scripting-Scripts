import { HStack, NavigationStack, Picker, ScrollView, Spacer, Text, VStack, Widget } from "scripting"
import { SoftCard } from "../components/common"
import { palette } from "../theme"
import { SLEEP_GOAL_OPTIONS, WIDGET_STYLE_OPTIONS_SMALL, WIDGET_STYLE_OPTIONS_MEDIUM, WIDGET_STYLE_OPTIONS_LARGE, saveSleepTrackerSettings } from "../data/settings"
import type { SleepTrackerSettings } from "../types"

export function SettingsTab(props: {
  settings: SleepTrackerSettings
  onChanged: (settings: SleepTrackerSettings) => void
}) {
  return (
    <NavigationStack>
      <ScrollView
        navigationTitle="设置"
        navigationBarTitleDisplayMode="large"
        background={palette.page}
      >
        <VStack spacing={16} padding={16}>
          <SoftCard title="睡眠目标" subtitle="这个目标会同时影响每日对比、趋势解读和睡眠评分。">
            <HStack frame={{ maxWidth: "infinity" }}>
              <Text font="body">每晚目标</Text>
              <Picker
                key={String(props.settings.sleepGoalMinutes)}
                title=""
                pickerStyle="menu"
                frame={{ maxWidth: "infinity", alignment: "trailing" as any }}
                value={props.settings.sleepGoalMinutes}
                onChanged={(value: number) => {
                  const next = saveSleepTrackerSettings({
                    ...props.settings,
                    sleepGoalMinutes: Number(value),
                  })
                  props.onChanged(next)
                }}
              >
                {SLEEP_GOAL_OPTIONS.map((minutes) => (
                  <Text key={minutes} tag={minutes}>
                    {(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)} 小时
                  </Text>
                ))}
              </Picker>
            </HStack>
          </SoftCard>

          <SoftCard title="数据源" subtitle="选择使用演示数据或读取 Apple Health 真实数据。">
            <HStack frame={{ maxWidth: "infinity" }}>
              <Text font="body">数据来源</Text>
              <Picker
                key={String(props.settings.useMockData)}
                title=""
                pickerStyle="menu"
                frame={{ maxWidth: "infinity", alignment: "trailing" as any }}
                value={props.settings.useMockData ? "mock" : "real"}
                onChanged={(value: string) => {
                  const next = saveSleepTrackerSettings({
                    ...props.settings,
                    useMockData: value === "mock",
                  })
                  props.onChanged(next)
                  if (typeof Widget.reloadAll === "function") {
                    Widget.reloadAll()
                  }
                }}
              >
                <Text tag="real">Apple Health 数据</Text>
                <Text tag="mock">随机演示数据</Text>
              </Picker>
            </HStack>
          </SoftCard>

          <SoftCard title="小组件" subtitle="分别设置小、中、大三种尺寸的小组件显示内容。">
  <VStack spacing={6}>
    <HStack frame={{ maxWidth: "infinity" }}>
      <Text font="body">小尺寸</Text>
      <Picker
        title=""
        pickerStyle="menu"
        value={props.settings.widgetStyleSmall}
        frame={{ maxWidth: "infinity", alignment: "trailing" as any }}
        onChanged={(value: any) => {
          const next = saveSleepTrackerSettings({
            ...props.settings,
            widgetStyleSmall: value,
          })
          props.onChanged(next)
          if (typeof Widget.reloadAll === "function") {
            Widget.reloadAll()
          }
        }}
      >
        {WIDGET_STYLE_OPTIONS_SMALL.map((option) => (
          <Text key={option.key} tag={option.key}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </HStack>
    <Text font="caption" foregroundStyle={palette.mutedInk}>
      {WIDGET_STYLE_OPTIONS_SMALL.find((o) => o.key === props.settings.widgetStyleSmall)?.hint ?? ""}
    </Text>
  </VStack>

  <VStack spacing={6}>
    <HStack frame={{ maxWidth: "infinity" }}>
      <Text font="body">中尺寸</Text>
      <Picker
        title=""
        pickerStyle="menu"
        value={props.settings.widgetStyleMedium}
        frame={{ maxWidth: "infinity", alignment: "trailing" as any }}
        onChanged={(value: any) => {
          const next = saveSleepTrackerSettings({
            ...props.settings,
            widgetStyleMedium: value,
          })
          props.onChanged(next)
          if (typeof Widget.reloadAll === "function") {
            Widget.reloadAll()
          }
        }}
      >
        {WIDGET_STYLE_OPTIONS_MEDIUM.map((option) => (
          <Text key={option.key} tag={option.key}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </HStack>
    <Text font="caption" foregroundStyle={palette.mutedInk}>
      {WIDGET_STYLE_OPTIONS_MEDIUM.find((o) => o.key === props.settings.widgetStyleMedium)?.hint ?? ""}
    </Text>
  </VStack>

  <VStack spacing={6}>
    <HStack frame={{ maxWidth: "infinity" }}>
      <Text font="body">大尺寸</Text>
      <Picker
        title=""
        pickerStyle="menu"
        value={props.settings.widgetStyleLarge}
        frame={{ maxWidth: "infinity", alignment: "trailing" as any }}
        onChanged={(value: any) => {
          const next = saveSleepTrackerSettings({
            ...props.settings,
            widgetStyleLarge: value,
          })
          props.onChanged(next)
          if (typeof Widget.reloadAll === "function") {
            Widget.reloadAll()
          }
        }}
      >
        {WIDGET_STYLE_OPTIONS_LARGE.map((option) => (
          <Text key={option.key} tag={option.key}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </HStack>
    <Text font="caption" foregroundStyle={palette.mutedInk}>
      {WIDGET_STYLE_OPTIONS_LARGE.find((o) => o.key === props.settings.widgetStyleLarge)?.hint ?? ""}
    </Text>
  </VStack>
</SoftCard>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}
