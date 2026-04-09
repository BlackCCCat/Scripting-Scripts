import { Button, VStack, HStack, Text, Widget } from "scripting"
import type { Color } from "scripting"
import { TogglePickedIntent } from "./app_intents"

declare const Storage: {
  get<T>(key: string): T | undefined
}

const CONFIG_KEY = "smsPickup_widget_config_v2"
const RECENTLY_PICKED_MS = 60 * 60 * 1000

interface PickedItem {
  code: string
  timestamp: number
}

interface PickupConfig {
  pickedItems?: PickedItem[]
  importedMessages?: string[]
  importedRecords?: { text: string; importedAt: string | null }[]
  widgetShowCount?: number
  homeDeletedCodes?: string[]
}

interface PickupInfo {
  courier: string | null
  code: string
  snippet: string
  date: string | null
  importedAt?: string | null
  picked?: boolean
}

const BRACKET_RE = /【([^】\d]{2,10})】/
const LOCATION_RE = /(?:到达|至|放|在|取件地[:：]|地址[:：])\s*([^，,。!！\n\r\]】]{2,30}?(?:店|驿站|超市|服务部|前台|门卫|代收点|便利店|服务站|仓|柜|厅|室|中心|报亭|花园|小区|楼|园|广场))/i
const GENERIC_RE = /(菜鸟|蜂巢|丰巢|兔喜|兔喜生活|极兔|顺丰|京东|韵达|中通|圆通|申通|邮政|EMS|妈妈驿站|驿站|日日顺|德邦)/i
const CODE_RE = /(?:取件码|取货码|验证码|提货码|取件|取货|凭)[^\d]{0,8}((\s*(?:\d+-){0,2}\d{3,8}[\s,，\.]*)+)/gi

function parseMessageDate(text: string): string | null {
  const patterns = [
    /(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?\s+\d{1,2}:\d{2}(?::\d{2})?)/,
    /(\d{1,2}[-/.月]\d{1,2}(?:日)?\s+\d{1,2}:\d{2}(?::\d{2})?)/,
    /(今天\s*\d{1,2}:\d{2})/,
    /(昨天\s*\d{1,2}:\d{2})/
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (!m || !m[1]) continue
    const raw = m[1].trim()
    const now = new Date()
    if (raw.startsWith("今天")) {
      const [h, min] = raw.replace("今天", "").trim().split(":").map(Number)
      const d = new Date(now)
      d.setHours(h || 0, min || 0, 0, 0)
      return d.toISOString()
    }
    if (raw.startsWith("昨天")) {
      const [h, min] = raw.replace("昨天", "").trim().split(":").map(Number)
      const d = new Date(now.getTime() - 24 * 3600 * 1000)
      d.setHours(h || 0, min || 0, 0, 0)
      return d.toISOString()
    }
    let normalized = raw.replace(/年/g, "-").replace(/月/g, "-").replace(/日/g, "").replace(/\//g, "-").replace(/\./g, "-").trim()
    if (!/^20\d{2}-/.test(normalized)) normalized = `${now.getFullYear()}-${normalized}`
    const d = new Date(normalized)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

function extractPickup(text: string): PickupInfo[] {
  if (!text) return []
  const results: PickupInfo[] = []
  const matcher = new RegExp(CODE_RE, "gi")
  let match: RegExpExecArray | null
  const detectedDate = parseMessageDate(text)

  while ((match = matcher.exec(text)) !== null) {
    const codeListString = match[1]
    if (!codeListString || !codeListString.trim()) continue

    let start = Math.max(0, match.index - 100)
    const lastBracket = text.lastIndexOf("【", match.index)
    const lastNewLine = text.lastIndexOf("\n", match.index)
    if (lastBracket > start) start = lastBracket
    if (lastNewLine > start) start = lastNewLine

    let end = Math.min(text.length, match.index + match[0].length + 100)
    const nextBracket = text.indexOf("【", match.index + match[0].length)
    const nextNewLine = text.indexOf("\n", match.index + match[0].length)
    if (nextBracket !== -1 && nextBracket < end) end = nextBracket
    if (nextNewLine !== -1 && nextNewLine < end) end = nextNewLine

    const context = text.slice(start, end)
    const bracketMatch = context.match(BRACKET_RE)
    const bracketName = bracketMatch ? bracketMatch[1] : null
    const locMatch = context.match(LOCATION_RE)
    let locationName = locMatch ? locMatch[1] : null
    if (locationName) locationName = locationName.replace(/^(在|位于|地址|:|：)/, "")
    const genericName = (context.match(GENERIC_RE) || [null])[0]
    const finalCourier = locationName || bracketName || genericName || null

    const snippetStart = lastBracket !== -1 ? lastBracket : Math.max(0, match.index - 40)
    let snippetEnd = text.length
    const nextCourierBracket = text.indexOf("【", match.index + match[0].length)
    if (nextCourierBracket !== -1) snippetEnd = Math.min(snippetEnd, nextCourierBracket)
    const isolatedSnippet = text.slice(snippetStart, snippetEnd).trim()

    const singleCodeRegex = /(\d+-){0,2}\d{3,8}/g
    let singleCodeMatch: RegExpExecArray | null
    while ((singleCodeMatch = singleCodeRegex.exec(codeListString)) !== null) {
      const code = singleCodeMatch[0]
      if (!code) continue
      results.push({ courier: finalCourier, code, snippet: isolatedSnippet, date: detectedDate })
    }
  }

  return results
}

function loadData(): { items: PickupInfo[]; showCount: number } {
  const cfg = Storage.get<PickupConfig>(CONFIG_KEY)
  if (!cfg) return { items: [], showCount: 5 }

  const records = Array.isArray(cfg.importedRecords) && cfg.importedRecords.length > 0
    ? cfg.importedRecords
    : (Array.isArray(cfg.importedMessages) ? cfg.importedMessages : []).map((text) => ({ text, importedAt: null }))
  const pickedItems = Array.isArray(cfg.pickedItems) ? cfg.pickedItems : []
  const deletedCodes = new Set(Array.isArray(cfg.homeDeletedCodes) ? cfg.homeDeletedCodes : [])
  const pickedMap = new Map(pickedItems.map(item => [item.code, item.timestamp]))
  const dedup = new Map<string, PickupInfo>()

  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    const extracted = extractPickup(record.text)
    for (const item of extracted) {
      if (deletedCodes.has(item.code)) continue
      if (dedup.has(item.code)) continue
      const pickedAt = pickedMap.get(item.code)
      const normalized = { ...item, importedAt: item.date ? item.date : record.importedAt }
      if (pickedAt && Date.now() - pickedAt < RECENTLY_PICKED_MS) {
        dedup.set(item.code, { ...normalized, picked: true })
      } else if (!pickedAt) {
        dedup.set(item.code, { ...normalized, picked: false })
      }
    }
  }

  return {
    items: Array.from(dedup.values()).filter((item) => !item.picked).slice(0, 8),
    showCount: Math.max(1, Math.min(8, cfg.widgetShowCount || 5)),
  }
}

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

function SmallWidget() {
  const { items } = loadData()
  const show = items.slice(0, 2)

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

function CollectionWidget(props: {
  family: "systemMedium" | "systemLarge" | "systemExtraLarge"
}) {
  const { items, showCount } = loadData()
  const limit = props.family === "systemMedium" ? 4 : 8
  const show = items.slice(0, Math.min(showCount, limit))

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

const family = Widget.family

if (family === "systemSmall") {
  Widget.present(<SmallWidget />)
} else if (family === "systemLarge" || family === "systemExtraLarge") {
  Widget.present(<CollectionWidget family={family} />)
} else {
  Widget.present(<CollectionWidget family="systemMedium" />)
}
