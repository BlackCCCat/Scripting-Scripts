import { Button, HStack, Text, VStack, Widget } from "scripting"
import type { Color } from "scripting"

import { TogglePickedIntent } from "./app_intents"
import type { PickupInfo } from "./types"
import { getHomePickupInfo, loadConfig } from "./utils"

function statusTone(item: PickupInfo): Color {
  if (!item.date) return "secondaryLabel"
  const diff = (Date.now() - new Date(item.date).getTime()) / 3600000
  if (diff <= 12) return "systemGreen"
  if (diff <= 36) return "systemOrange"
  return "systemRed"
}

function badgeText(item: PickupInfo) {
  if (item.picked) return "已处理"
  if (!item.date) return "待领取"
  const diff = (Date.now() - new Date(item.date).getTime()) / 3600000
  if (diff <= 12) return "刚到件"
  if (diff <= 36) return "待处理"
  return "请尽快领取"
}

function EmptyBlock() {
  return (
    <VStack padding={16} alignment="leading" spacing={6}>
      <Text font="headline">快递小助手</Text>
      <Text font="footnote" opacity={0.72}>暂无待取件</Text>
      <Text font="caption2" opacity={0.5}>导入短信后会自动显示</Text>
    </VStack>
  )
}

function PickupTile(props: {
  item: PickupInfo
  compact: boolean
}) {
  return (
    <Button
      buttonStyle="plain"
      intent={TogglePickedIntent(props.item.code)}
    >
      <VStack
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        alignment="leading"
        spacing={props.compact ? 4 : 6}
        padding={props.compact ? 10 : 12}
        background={{
          style: "secondarySystemBackground",
          shape: { type: "rect", cornerRadius: props.compact ? 16 : 18 },
        }}
      >
        <Text
          font="caption2"
          foregroundStyle={statusTone(props.item)}
          lineLimit={1}
        >
          {badgeText(props.item)}
        </Text>
        <Text
          font={props.compact ? "caption" : "subheadline"}
          fontWeight="semibold"
          lineLimit={1}
        >
          {props.item.courier || "快递包裹"}
        </Text>
        <Text
          font={props.compact ? "subheadline" : "headline"}
          fontWeight="bold"
          lineLimit={1}
        >
          {props.item.code}
        </Text>
        {!props.compact ? (
          <Text font="caption2" opacity={0.52} lineLimit={2}>
            {props.item.snippet}
          </Text>
        ) : null}
      </VStack>
    </Button>
  )
}

function SmallWidget(props: { items: PickupInfo[] }) {
  const show = props.items.slice(0, 2)

  if (show.length === 0) {
    return <EmptyBlock />
  }

  return (
    <VStack padding={12} alignment="leading" spacing={8}>
      {show.map((item, index) => (
        <PickupTile
          key={`${item.code}-${index}`}
          item={item}
          compact={show.length > 1}
        />
      ))}
    </VStack>
  )
}

function columnsForLayout(count: number) {
  if (count <= 2) return count
  return 2
}

function chunkItems<T>(items: T[], size: number) {
  const rows: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }
  return rows
}

function CollectionWidget(props: {
  family: "systemMedium" | "systemLarge" | "systemExtraLarge"
  items: PickupInfo[]
  maxCount: number
}) {
  const limit = props.family === "systemMedium" ? 4 : 8
  const show = props.items.slice(0, Math.min(props.maxCount, limit))

  if (show.length === 0) {
    return <EmptyBlock />
  }

  const columns = columnsForLayout(show.length)
  const rows = chunkItems(show, columns)
  const compact = show.length >= 3

  return (
    <VStack padding={12} alignment="leading" spacing={8}>
      {rows.map((row, rowIndex) => (
        <HStack key={`row-${rowIndex}`} spacing={8}>
          {row.map((item, index) => (
            <PickupTile
              key={`${item.code}-${index}`}
              item={item}
              compact={compact}
            />
          ))}
          {columns === 2 && row.length === 1 ? (
            <VStack key={`empty-${rowIndex}`} frame={{ maxWidth: "infinity", alignment: "leading" as any }} />
          ) : null}
        </HStack>
      ))}
    </VStack>
  )
}

async function loadData() {
  const cfg = loadConfig()
  const items = (await getHomePickupInfo()).filter((item) => !item.picked).slice(0, 8)
  return {
    items,
    showCount: Math.max(1, Math.min(8, cfg.widgetShowCount || 5)),
  }
}

async function run() {
  const family = Widget.family
  const data = await loadData()

  if (family === "systemSmall") {
    Widget.present(<SmallWidget items={data.items} />)
    return
  }

  if (family === "systemLarge" || family === "systemExtraLarge") {
    Widget.present(<CollectionWidget family={family} items={data.items} maxCount={data.showCount} />)
    return
  }

  Widget.present(<CollectionWidget family="systemMedium" items={data.items} maxCount={data.showCount} />)
}

run()
