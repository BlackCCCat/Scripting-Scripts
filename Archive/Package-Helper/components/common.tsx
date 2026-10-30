import {
  Button,
  EmptyView,
  gradient,
  HStack,
  Spacer,
  Text,
  VStack,
} from "scripting"

import type { Color } from "scripting"
import type { PickupInfo } from "../types"
import { formatRelativeTimeText, heroCountText, statusColor, statusText } from "../utils"

const GLASS_CARD_SHAPE = { type: "rect", cornerRadius: 20, style: "continuous" } as any
const GLASS_SMALL_CARD_SHAPE = { type: "rect", cornerRadius: 16, style: "continuous" } as any
const GLASS_ROW_SHAPE = { type: "rect", cornerRadius: 18, style: "continuous" } as any
const FULL_WIDTH_ROW_INSETS = { top: 0, bottom: 0, leading: 0, trailing: 0 } as any

const METRIC_GRADIENTS: Record<string, Color[]> = {
  blue: ["rgba(10,132,255,0.18)", "rgba(90,200,250,0.08)"] as Color[],
  green: ["rgba(52,199,89,0.18)", "rgba(48,209,88,0.08)"] as Color[],
  orange: ["rgba(255,159,10,0.20)", "rgba(255,214,10,0.08)"] as Color[],
  violet: ["rgba(175,82,222,0.18)", "rgba(191,90,242,0.08)"] as Color[],
}

function metricGradient(tint: Color) {
  const value = String(tint).toLowerCase()
  const colors = value.includes("34c759") || value.includes("green")
    ? METRIC_GRADIENTS.green
    : value.includes("ff9f0a") || value.includes("orange")
      ? METRIC_GRADIENTS.orange
      : value.includes("af52de") || value.includes("purple") || value.includes("violet")
        ? METRIC_GRADIENTS.violet
        : METRIC_GRADIENTS.blue

  return gradient("linear", {
    colors,
    startPoint: "topLeading",
    endPoint: "bottomTrailing",
  })
}

export function InfoBanner(props: { message?: string | null }) {
  if (!props.message) return null

  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      alignment="leading"
      spacing={4}
      padding={{ vertical: 10, horizontal: 12 }}
      background={{
        style: gradient("linear", {
          colors: ["rgba(10,132,255,0.16)", "rgba(90,200,250,0.06)"] as Color[],
          startPoint: "topLeading",
          endPoint: "bottomTrailing",
        }),
        shape: { type: "rect", cornerRadius: 14 },
      } as any}
      glassEffect={{ type: "rect", cornerRadius: 14 } as any}
    >
      <Text font="caption" foregroundStyle="#007AFF">状态提示</Text>
      <Text font="footnote" foregroundStyle="#007AFF">{props.message}</Text>
    </VStack>
  )
}

export function MetricTile(props: {
  label: string
  value: string
  detail: string
  tint: Color
}) {
  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      alignment="leading"
      spacing={4}
      padding={12}
      background={{
        style: metricGradient(props.tint),
        shape: GLASS_SMALL_CARD_SHAPE,
      } as any}
      glassEffect={GLASS_SMALL_CARD_SHAPE}
    >
      <Text font="caption" opacity={0.5}>{props.label}</Text>
      <Text font="title3" fontWeight="bold" foregroundStyle={props.tint}>{props.value}</Text>
      <Text font="caption2" opacity={0.48}>{props.detail}</Text>
    </VStack>
  )
}

export function GlassCard(props: {
  children: any
  spacing?: number
  padding?: number | { top?: number; bottom?: number; leading?: number; trailing?: number; horizontal?: number; vertical?: number }
}) {
  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      alignment="leading"
      spacing={props.spacing ?? 10}
      padding={props.padding ?? 14}
      listRowInsets={FULL_WIDTH_ROW_INSETS}
      listRowSeparator="hidden"
      listRowBackground={<EmptyView />}
      contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
      glassEffect={GLASS_CARD_SHAPE}
    >
      {props.children}
    </VStack>
  )
}

export function DashboardHero(props: {
  items: PickupInfo[]
  notice?: string | null
}) {
  const activeItems = props.items.filter((item) => !item.picked)
  const firstActive = activeItems[0] ?? null

  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      alignment="leading"
      spacing={10}
      padding={16}
      background={{
        style: gradient("linear", {
          colors: ["rgba(10,132,255,0.16)", "rgba(90,200,250,0.06)"] as Color[],
          startPoint: "topLeading",
          endPoint: "bottomTrailing",
        }),
        shape: { type: "rect", cornerRadius: 18 },
      } as any}
      glassEffect={{ type: "rect", cornerRadius: 18 } as any}
    >
      <Text font="title2" fontWeight="bold">{heroCountText(props.items)}</Text>
      <Text font="footnote" opacity={0.58}>
        {firstActive
          ? `优先处理 ${firstActive.courier || "最新包裹"} · ${firstActive.code}`
          : "暂时没有需要你处理的包裹"}
      </Text>
    </VStack>
  )
}

export function PickupRow(props: {
  item: PickupInfo
  showDate: boolean
  checked: boolean
  onToggle?: (code: string) => void | Promise<void>
}) {
  return (
    <HStack
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      spacing={10}
      padding={{ top: 13, bottom: 13, leading: 14, trailing: 12 }}
      listRowInsets={FULL_WIDTH_ROW_INSETS}
      listRowSeparator="hidden"
      listRowBackground={<EmptyView />}
      contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
      glassEffect={GLASS_ROW_SHAPE}
    >
      <VStack frame={{ maxWidth: "infinity", alignment: "leading" as any }} alignment="leading" spacing={6}>
        <HStack spacing={8}>
          <Text font="body" fontWeight="semibold">{props.item.courier || "快递包裹"}</Text>
          <Spacer />
          {props.showDate ? (
            <Text font="caption2" opacity={0.42}>
              {formatRelativeTimeText(props.item.date || props.item.importedAt)}
            </Text>
          ) : null}
        </HStack>
        <Text font="caption" foregroundStyle={statusColor(props.item)}>{statusText(props.item)}</Text>
        {props.item.picked ? (
          <Text
            font="title3"
            fontWeight="bold"
            foregroundStyle="#A1A1AA"
          >
            {props.item.code}
          </Text>
        ) : (
          <Text
            font="title3"
            fontWeight="bold"
          >
            {props.item.code}
          </Text>
        )}
        <Text font="footnote" opacity={0.56} lineLimit={2}>{props.item.snippet}</Text>
      </VStack>
      {props.onToggle ? (
        <Button
          title=""
          systemImage={props.checked ? "checkmark.circle.fill" : "circle"}
          tint={props.checked ? "green" : "secondaryLabel"}
          frame={{ width: 34 }}
          action={() => props.onToggle?.(props.item.code)}
        />
      ) : null}
    </HStack>
  )
}

export function EmptyPickupBlock(props: { title: string; subtitle: string }) {
  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      alignment="leading"
      spacing={6}
      padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }}
      listRowInsets={FULL_WIDTH_ROW_INSETS}
      listRowSeparator="hidden"
      listRowBackground={<EmptyView />}
      glassEffect={GLASS_ROW_SHAPE}
    >
      <Text font="body" fontWeight="semibold">{props.title}</Text>
      <Text font="footnote" opacity={0.58}>{props.subtitle}</Text>
    </VStack>
  )
}

export function CenterDestructiveRow(props: {
  title: string
  onPress: () => void | Promise<void>
}) {
  return (
    <Button
      buttonStyle="plain"
      role="destructive"
      frame={{ maxWidth: "infinity" }}
      action={() => {
        try { HapticFeedback.mediumImpact() } catch {}
        void props.onPress()
      }}
    >
      <HStack
        frame={{ width: "100%" as any }}
        padding={{ top: 14, bottom: 14 }}
      >
        <Text opacity={0} frame={{ width: 1 }}>.</Text>
        <Spacer />
        <Text font="headline" foregroundStyle="#FF3B30">{props.title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}
