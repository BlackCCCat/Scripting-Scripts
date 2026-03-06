import {
  Button,
  Chart,
  Circle,
  DonutChart,
  HStack,
  Script,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
  type Color,
} from "scripting"

import { RefreshApiAvailabilityIntent } from "./app_intents"
import { normalizeWidgetRefreshHours } from "./utils/common"
import { buildOverviewItems, buildOverviewSummary, chartColorScale } from "./utils/overview"
import { loadManagerState } from "./utils/storage"

function donutMarks() {
  const state = loadManagerState()
  const rawSummary = buildOverviewSummary(state.entries)
  const summary = {
    ...rawSummary,
    unknown: rawSummary.unknown + rawSummary.checking,
    checking: 0,
  }
  const items = buildOverviewItems(summary).filter((item) => item.key !== "checking")
  const marks = items
    .filter((item) => item.count > 0)
    .map((item) => ({
      category: item.label,
      value: item.count,
      innerRadius: {
        type: "ratio" as const,
        value: 0.618,
      },
      outerRadius: {
        type: "inset" as const,
        value: 10,
      },
      angularInset: 1,
    }))

  return {
    entries: state.entries,
    summary,
    items,
    marks,
  }
}

function widgetReloadPolicy() {
  const state = loadManagerState()
  const hours = normalizeWidgetRefreshHours(state.settings.widgetRefreshHours)
  return {
    policy: "after" as const,
    date: new Date(Date.now() + hours * 60 * 60 * 1000),
  }
}

function WidgetDonut(props: { size: number; valueFont: number | any }) {
  const data = donutMarks()

  if (!data.entries.length) {
    return (
      <Circle
        fill="systemGray6"
        frame={{ width: props.size, height: props.size }}
        overlay={
          <VStack spacing={2}>
            <Text font={props.valueFont} offset={{ x: 0, y: -1 }}>0</Text>
          </VStack>
        }
      />
    )
  }

  return (
    <ZStack frame={{ width: props.size, height: props.size }}>
      <Chart
        frame={{
          width: props.size,
          height: props.size,
        }}
        chartXAxis="hidden"
        chartYAxis="hidden"
        chartLegend="hidden"
        chartForegroundStyleScale={chartColorScale()}
      >
        <DonutChart marks={data.marks} />
      </Chart>
      <VStack spacing={2}>
        <Text
          font={props.valueFont}
          foregroundStyle="systemGreen"
          offset={{ x: 0, y: -1 }}
        >
          {data.summary.green}
        </Text>
      </VStack>
    </ZStack>
  )
}

function LegendList(props: { compact?: boolean }) {
  const { items } = donutMarks()
  return (
    <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={props.compact ? 6 : 8}>
      {items.map((item) => (
        <HStack key={item.key} frame={{ width: "100%" as any }} spacing={8}>
          <Circle fill={item.color as Color} frame={{ width: 8, height: 8 }} />
          <Text
            font={props.compact ? "caption2" : "footnote"}
            frame={{ width: props.compact ? 56 : 64, alignment: "leading" as any }}
            foregroundStyle="secondaryLabel"
          >
            {item.label}
          </Text>
          <Spacer />
          <Text font={props.compact ? "caption2" : "footnote"} foregroundStyle="secondaryLabel">
            {item.count}
          </Text>
        </HStack>
      ))}
    </VStack>
  )
}

function SmallWidget() {
  return (
    <VStack
      padding={12}
      spacing={8}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
      widgetBackground={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 18 } }}
    >
      <Text font="caption" foregroundStyle="secondaryLabel">
        API Manager
      </Text>
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}>
        <Button intent={RefreshApiAvailabilityIntent({})} buttonStyle="plain">
          <WidgetDonut size={132} valueFont="title2" />
        </Button>
      </VStack>
    </VStack>
  )
}

function MediumWidget() {
  const { entries } = donutMarks()
  return (
    <HStack
      padding={14}
      spacing={12}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
      widgetBackground={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 22 } }}
    >
      <VStack frame={{ maxHeight: "infinity", alignment: "center" as any }}>
        <Button intent={RefreshApiAvailabilityIntent({})} buttonStyle="plain">
          <WidgetDonut size={128} valueFont="title" />
        </Button>
      </VStack>
      <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={8}>
        <Text font="headline">API Manager</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          已保存 {entries.length} 条
        </Text>
        <LegendList compact />
      </VStack>
    </HStack>
  )
}

function LargeWidget() {
  const { entries } = donutMarks()
  return (
    <VStack
      padding={22}
      spacing={12}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
      widgetBackground={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 26 } }}
    >
      <VStack spacing={3}>
        <Text font="headline">API Manager</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          已保存 {entries.length} 条 API
        </Text>
      </VStack>
      <VStack frame={{ maxWidth: "infinity", alignment: "center" as any }}>
        <Button intent={RefreshApiAvailabilityIntent({})} buttonStyle="plain">
          <WidgetDonut size={156} valueFont="largeTitle" />
        </Button>
      </VStack>
      <LegendList compact />
    </VStack>
  )
}

function RootWidget() {
  const family = Widget.family
  if (family === "systemLarge") return <LargeWidget />
  if (family === "systemMedium") return <MediumWidget />
  return <SmallWidget />
}

async function run() {
  Widget.present(<RootWidget />, {
    reloadPolicy: widgetReloadPolicy(),
  })

  Script.exit()
}

void run()
