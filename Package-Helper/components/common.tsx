import {
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
} from "scripting"

import type { PickupInfo } from "../types"
import { formatRelativeTimeText, heroCountText, statusColor, statusText } from "../utils"

export function InfoBanner(props: { message?: string | null }) {
  if (!props.message) return null

  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      alignment="leading"
      spacing={4}
      padding={{ vertical: 10, horizontal: 12 }}
      background={{ style: "rgba(0,122,255,0.08)", shape: { type: "rect", cornerRadius: 14 } }}
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
  tint: string
}) {
  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      alignment="leading"
      spacing={4}
      padding={12}
      background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 16 } }}
    >
      <Text font="caption" opacity={0.5}>{props.label}</Text>
      <Text font="title3" fontWeight="bold" foregroundStyle={props.tint}>{props.value}</Text>
      <Text font="caption2" opacity={0.48}>{props.detail}</Text>
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
      background={{ style: "rgba(10,132,255,0.10)", shape: { type: "rect", cornerRadius: 18 } }}
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
  onToggle?: (code: string) => void
}) {
  return (
    <VStack
      frame={{ width: "100%" as any }}
      spacing={0}
    >
      <HStack
        frame={{ width: "100%" as any }}
        spacing={10}
        padding={{ vertical: 10 }}
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
          <Text
            font="title3"
            fontWeight="bold"
            foregroundStyle={props.item.picked ? "#A1A1AA" : "#111111"}
          >
            {props.item.code}
          </Text>
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
    </VStack>
  )
}

export function EmptyPickupBlock(props: { title: string; subtitle: string }) {
  return (
    <VStack alignment="leading" spacing={6} padding={{ vertical: 12 }}>
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
        background={"rgba(0,0,0,0.001)"}
      >
        <Text opacity={0} frame={{ width: 1 }}>.</Text>
        <Spacer />
        <Text font="headline" foregroundStyle="#FF3B30">{props.title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}
