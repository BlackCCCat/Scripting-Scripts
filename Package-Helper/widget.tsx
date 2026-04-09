import { Button, VStack, HStack, Text, Widget } from "scripting"
import { TogglePickedIntent, MarkAllPickedIntent } from "./app_intents"

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
  deletedCodes?: string[]
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
  const deletedCodes = new Set(Array.isArray(cfg.deletedCodes) ? cfg.deletedCodes : [])
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
    items: Array.from(dedup.values()).slice(0, 10),
    showCount: Math.max(1, cfg.widgetShowCount || 5),
  }
}

function color(item: PickupInfo) {
  return item.picked ? "#A1A1AA" : "#6B7280"
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
  const first = items[0]

  if (!first) {
    return <EmptyBlock />
  }

  return (
    <VStack padding={14} alignment="leading" spacing={8}>
      <Text font="caption" opacity={0.45}>{badgeText(first)}</Text>
      <Text font="headline" lineLimit={1}>{first.courier || "快递包裹"}</Text>
      <Text font="title3" fontWeight="bold">{first.code}</Text>
      <Text font="caption2" opacity={0.5} lineLimit={2}>{first.snippet}</Text>
      <Button title={first.picked ? "已处理" : "标记取件"} intent={TogglePickedIntent(first.code)} />
    </VStack>
  )
}

function MediumWidget() {
  const { items, showCount } = loadData()
  const show = items.slice(0, Math.min(showCount, 4))

  if (show.length === 0) {
    return <EmptyBlock />
  }

  return (
    <VStack padding={16} alignment="leading" spacing={12}>
      <HStack>
        <VStack alignment="leading" spacing={2}>
          <Text font="headline">待取件</Text>
          <Text font="caption2" opacity={0.45}>共 {show.length} 条展示中</Text>
        </VStack>
        <Button title="全部已取" intent={MarkAllPickedIntent()} />
      </HStack>
      {show.map((item, i) => (
        <VStack key={i} alignment="leading" spacing={4}>
          <Text font="caption" opacity={0.42}>{badgeText(item)}</Text>
          <Text lineLimit={1}>{item.courier || "快递"} · {item.code}</Text>
          <Text font="caption2" opacity={0.52} lineLimit={1}>{item.snippet}</Text>
        </VStack>
      ))}
    </VStack>
  )
}

const family = Widget.family

if (family === "systemSmall") {
  Widget.present(<SmallWidget />)
} else {
  Widget.present(<MediumWidget />)
}
