import { Button, HStack, Text, VStack, Widget } from "scripting"
import type { Color } from "scripting"

import { TogglePickedIntent } from "./app_intents"
import type { PickupInfo } from "./types"
import { loadWidgetData } from "./widgetData"

function statusTone(item: PickupInfo): Color {
  if (!item.date) return "secondaryLabel"
  const diff = (Date.now() - new Date(item.date).getTime()) / 3600000
  if (diff <= 12) return "systemGreen"
  if (diff <= 36) return "systemOrange"
  return "systemRed"
}

function badgeText(item: PickupInfo) {
  if (item.picked) return "已处理"
  if (!item.date) return ""
  const diff = (Date.now() - new Date(item.date).getTime()) / 3600000
  if (diff <= 12) return "刚到件"
  if (diff <= 36) return "待处理"
  return "请尽快领取"
}

function locationTitle(item: PickupInfo) {
  return item.courier || "快递包裹"
}

function locationFont(item: PickupInfo, compact: boolean) {
  const length = locationTitle(item).length

  if (compact) {
    if (length <= 8) return "caption"
    if (length <= 14) return "caption2"
    return "footnote"
  }

  if (length <= 10) return "subheadline"
  if (length <= 16) return "caption"
  return "footnote"
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
  const badge = badgeText(props.item)
  const extraInfo = (props.item.snippet || "").trim()
  const tileSpacing = props.compact ? 1 : 5
  const tilePadding = props.compact
    ? { top: 4, leading: 8, bottom: 4, trailing: 8 }
    : 12

  return (
    <Button
      buttonStyle="plain"
      intent={TogglePickedIntent(props.item.code)}
    >
      <VStack
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        alignment="leading"
        spacing={tileSpacing}
        padding={tilePadding}
      >
        {badge ? (
          <Text
            font="caption2"
            foregroundStyle={statusTone(props.item)}
            lineLimit={1}
          >
            {badge}
          </Text>
        ) : null}
        <Text
          font={locationFont(props.item, props.compact)}
          fontWeight="semibold"
          lineLimit={{
            min: 2,
            max: 2,
            reservesSpace: true,
          }}
          fixedSize={{ horizontal: false, vertical: true }}
          multilineTextAlignment="leading"
          allowsTightening={true}
        >
          {locationTitle(props.item)}
        </Text>
        {extraInfo ? (
          <Text
            font="caption2"
            opacity={0.56}
            lineLimit={props.compact ? 1 : 2}
          >
            {extraInfo}
          </Text>
        ) : null}
        <Text
          font={props.compact ? "body" : "headline"}
          fontWeight="bold"
          lineLimit={1}
        >
          {props.item.code}
        </Text>
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
    <VStack padding={{ top: 8, leading: 12, bottom: 8, trailing: 12 }} alignment="leading" spacing={2}>
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
    <VStack padding={{ top: 10, leading: 12, bottom: 10, trailing: 12 }} alignment="leading" spacing={show.length <= 2 ? 4 : 6}>
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

async function run() {
  const family = Widget.family
  const data = loadWidgetData()

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
