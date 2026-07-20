import { VStack, HStack, Text, Image, Widget, Spacer, Color, ZStack, GeometryReader, RoundedRectangle, gradient, Button } from 'scripting'
import { AppData, AnniversaryEvent, Person } from './types'
import { loadAppData } from './storage'
import { resolveWidgetAvatarPath } from './widgetAvatar'
import { buildOccurrenceList, formatElapsedYearsAndDays, getEffectiveType, getWeddingAnniversaryName, getWeddingNameColor } from './dateUtils'
import { CapsuleTag, RELATIONSHIP_STYLES, DEFAULT_RELATIONSHIP_STYLE } from './components'
import { ToggleCountdownFormatIntent } from './app_intents'

// 每种尺寸默认显示的时光纪念数量
const FAMILY_LIMITS: Record<string, number> = {
  systemSmall: 1,
  systemMedium: 1,
  systemLarge: 2
}

// 时光纪念类型短标签（widget 空间有限，使用短名称避免截断；App 列表已用长后缀）
const EVENT_TYPE_LABELS: Record<AnniversaryEvent['type'], string> = {
  birthday: '生日',
  meet: '相识',
  love: '恋爱',
  wedding: '结婚',
  enrollment: '入学',
  graduation: '毕业',
  join: '入职',
  custom: '其他'
}

const EVENT_TYPE_STYLES: Record<AnniversaryEvent['type'], { icon: string; color: string }> = {
  birthday: { icon: 'gift.fill', color: '#FF9500' },
  meet: { icon: 'hand.wave.fill', color: '#007AFF' },
  love: { icon: 'heart.fill', color: '#FF2D55' },
  wedding: { icon: 'heart.circle.fill', color: '#AF52DE' },
  enrollment: { icon: 'book.fill', color: '#34C759' },
  graduation: { icon: 'graduationcap.fill', color: '#5856D6' },
  join: { icon: 'briefcase.fill', color: '#5AC8FA' },
  custom: { icon: 'star.fill', color: '#FFCC00' }
}

// 计算后的一条时光纪念记录
interface Occurrence {
  event: AnniversaryEvent
  person: Person
  nextDate: Date
  daysLeft: number
  age?: number
  months?: number
  daysSince?: number
  yearsPassed?: number
}

interface WidgetEventCard {
  events: AnniversaryEvent[]
  name: string
}

// 根据当前 widget 尺寸获取条数与布局参数
function getNormalizedWidgetFamily(): 'systemSmall' | 'systemMedium' | 'systemLarge' | null {
  const family = Widget.family as string
  if (family === 'small' || family === 'systemSmall') return 'systemSmall'
  if (family === 'medium' || family === 'systemMedium') return 'systemMedium'
  if (family === 'large' || family === 'systemLarge') return 'systemLarge'
  return null
}

function getDisplayLimit(): number {
  const family = getNormalizedWidgetFamily()
  return family ? FAMILY_LIMITS[family] : 1
}

function getWidgetSizeForFamily(): AnniversaryEvent['widgetSize'] | null {
  return getNormalizedWidgetFamily()
}

// 将十六进制颜色转为带透明度的 rgba
function colorWithAlpha(hex: string, alpha: number): Color {
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})` as Color
}

type ImageColor = {
  red: number
  green: number
  blue: number
  alpha: number
  hex: string
}

type DominantColorItem = {
  color: ImageColor
}

const widgetGradientCache = new Map<string, ImageColor | null>()

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function hexToImageColor(hex: string): ImageColor {
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16)
  return {
    red: ((bigint >> 16) & 255) / 255,
    green: ((bigint >> 8) & 255) / 255,
    blue: (bigint & 255) / 255,
    alpha: 1,
    hex
  }
}

function luminance(color: ImageColor): number {
  return 0.299 * color.red + 0.587 * color.green + 0.114 * color.blue
}

function isUsableDominantColor(item: DominantColorItem): boolean {
  const lightness = luminance(item.color)
  return item.color.alpha > 0.45 && lightness > 0.08 && lightness < 0.96
}

function rgbToHsl(red: number, green: number, blue: number) {
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return { hue: 0, saturation: 0, lightness }

  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = 0
  switch (max) {
    case red:
      hue = (green - blue) / delta + (green < blue ? 6 : 0)
      break
    case green:
      hue = (blue - red) / delta + 2
      break
    default:
      hue = (red - green) / delta + 4
      break
  }
  return { hue: hue / 6, saturation, lightness }
}

function hueToRgb(p: number, q: number, t: number): number {
  let next = t
  if (next < 0) next += 1
  if (next > 1) next -= 1
  if (next < 1 / 6) return p + (q - p) * 6 * next
  if (next < 1 / 2) return q
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6
  return p
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
  if (saturation === 0) {
    return { red: lightness, green: lightness, blue: lightness }
  }

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q

  return {
    red: hueToRgb(p, q, hue + 1 / 3),
    green: hueToRgb(p, q, hue),
    blue: hueToRgb(p, q, hue - 1 / 3)
  }
}

function rgbaString(red: number, green: number, blue: number, alpha: number): Color {
  return `rgba(${Math.round(red * 255)},${Math.round(green * 255)},${Math.round(blue * 255)},${alpha})` as Color
}

function normalizeBackgroundRgb(color: ImageColor) {
  const hsl = rgbToHsl(color.red, color.green, color.blue)
  const saturation = clamp(hsl.saturation * 1.22)
  const lightness = clamp(hsl.lightness > 0.5 ? hsl.lightness : hsl.lightness + 0.05, 0, 0.8)
  return hslToRgb(hsl.hue, saturation, lightness)
}

type PhotoGradientSide = 'left' | 'right'

function makeWidgetGradient(color: ImageColor, startAlpha: number, middleAlpha: number, photoSide: PhotoGradientSide = 'left') {
  const rgb = normalizeBackgroundRgb(color)
  return gradient('linear', {
    stops: [
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, startAlpha), location: 0 },
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, middleAlpha), location: 0.6 },
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, middleAlpha * 0.42), location: 0.84 },
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, 0), location: 1 }
    ],
    startPoint: photoSide === 'right' ? 'trailing' : 'leading',
    endPoint: photoSide === 'right' ? 'leading' : 'trailing'
  })
}

function makeWidgetStroke(color: ImageColor) {
  const rgb = normalizeBackgroundRgb(color)
  return {
    light: rgbaString(rgb.red, rgb.green, rgb.blue, 0.3),
    dark: rgbaString(rgb.red, rgb.green, rgb.blue, 0.38)
  }
}

function extractDominantColor(image: UIImage): ImageColor | null {
  try {
    const dominantColors = (image as UIImage & {
      dominantColors?: (count?: number) => DominantColorItem[]
    }).dominantColors
    if (typeof dominantColors !== 'function') return null
    const colors = dominantColors.call(image, 8)
    return colors.find(isUsableDominantColor)?.color ?? colors[0]?.color ?? null
  } catch {
    return null
  }
}

function getPersonFallbackColor(person: Person): string {
  const relationship = person.relationship?.trim() || '其他'
  return (RELATIONSHIP_STYLES[relationship] ?? DEFAULT_RELATIONSHIP_STYLE).color
}

// 短日期格式：6月18日 · 星期四
function formatDateShort(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function getEventDisplayLabel(event: AnniversaryEvent): string {
  return event.type === 'custom'
    ? (event.title || '其他')
    : (EVENT_TYPE_LABELS[event.type] || '时光纪念')
}

type CardTextAlignment = 'leading' | 'center' | 'trailing'

function EventTitleBlock({
  item,
  nameFont,
  typeFont,
  spacing = 3,
  alignment = 'leading'
}: {
  item: Occurrence
  nameFont: number
  typeFont: number
  spacing?: number
  alignment?: CardTextAlignment
}) {
  const relationshipStyle = RELATIONSHIP_STYLES[item.person.relationship?.trim() || '其他'] ?? DEFAULT_RELATIONSHIP_STYLE
  const eventStyle = EVENT_TYPE_STYLES[item.event.type] ?? EVENT_TYPE_STYLES.custom
  const alignValue = alignment as any
  return (
    <VStack alignment={alignment} spacing={spacing} frame={{ maxWidth: Infinity, alignment: alignValue }}>
      <Text fontWeight="bold" font={nameFont} foregroundStyle={relationshipStyle.color as Color} lineLimit={1} minScaleFactor={0.7}>{item.person.name}</Text>
      <HStack spacing={4} alignment="center" frame={{ maxWidth: Infinity, alignment: alignValue }}>
        {alignment !== 'trailing' ? <Image systemName={eventStyle.icon} font={Math.max(12, typeFont - 2)} foregroundStyle={eventStyle.color as Color} /> : null}
        <Text fontWeight="semibold" font={typeFont} foregroundStyle={eventStyle.color as Color} lineLimit={1} minScaleFactor={0.7}>{getEventDisplayLabel(item.event)}</Text>
        {alignment === 'trailing' ? <Image systemName={eventStyle.icon} font={Math.max(12, typeFont - 2)} foregroundStyle={eventStyle.color as Color} /> : null}
      </HStack>
    </VStack>
  )
}

function DateLine({ text, font = 13, alignment = 'leading' }: { text: string; font?: number; alignment?: CardTextAlignment }) {
  const alignValue = alignment as any
  return (
    <HStack spacing={4} alignment="center" frame={{ maxWidth: Infinity, alignment: alignValue }}>
      {alignment !== 'trailing' ? <Image systemName="calendar" font={Math.max(11, font - 1)} foregroundStyle="systemTeal" /> : null}
      <Text font={font} fontWeight="medium" foregroundStyle="systemTeal" lineLimit={2} minScaleFactor={0.76}>{text}</Text>
      {alignment === 'trailing' ? <Image systemName="calendar" font={Math.max(11, font - 1)} foregroundStyle="systemTeal" /> : null}
    </HStack>
  )
}

const DENSE_WATERMARK_PATTERN = [
  { x: 0.12, y: 0.16, rotation: -18, scale: 0.94 },
  { x: 0.38, y: 0.12, rotation: 14, scale: 0.72 },
  { x: 0.68, y: 0.15, rotation: -8, scale: 0.82 },
  { x: 0.9, y: 0.2, rotation: 20, scale: 0.68 },
  { x: 0.24, y: 0.34, rotation: 9, scale: 0.78 },
  { x: 0.52, y: 0.32, rotation: -20, scale: 0.88 },
  { x: 0.8, y: 0.38, rotation: 12, scale: 0.74 },
  { x: 0.1, y: 0.55, rotation: 18, scale: 0.7 },
  { x: 0.35, y: 0.58, rotation: -10, scale: 0.86 },
  { x: 0.63, y: 0.55, rotation: 22, scale: 0.76 },
  { x: 0.9, y: 0.62, rotation: -14, scale: 0.9 },
  { x: 0.2, y: 0.78, rotation: -6, scale: 0.82 },
  { x: 0.48, y: 0.82, rotation: 17, scale: 0.7 },
  { x: 0.74, y: 0.8, rotation: -22, scale: 0.84 }
]

function DenseTextWatermark({ item }: { item: Occurrence }) {
  const eventStyle = EVENT_TYPE_STYLES[item.event.type] ?? EVENT_TYPE_STYLES.custom
  return (
    <GeometryReader frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
      {({ size }) => (
        <ZStack frame={{ width: size.width, height: size.height }}>
          {DENSE_WATERMARK_PATTERN.map((mark, index) => (
            <Image
              key={index}
              systemName={eventStyle.icon}
              font={Math.round(16 + mark.scale * 9)}
              foregroundStyle={eventStyle.color as Color}
              opacity={0.052}
              position={{ x: size.width * mark.x, y: size.height * mark.y }}
              rotationEffect={{ degrees: mark.rotation, anchor: 'center' }}
              allowsHitTesting={false}
            />
          ))}
        </ZStack>
      )}
    </GeometryReader>
  )
}

function TextWatermark({ item, alignment, dense }: { item: Occurrence; alignment: 'leading' | 'trailing'; dense?: boolean }) {
  if (dense) return <DenseTextWatermark item={item} />

  const eventStyle = EVENT_TYPE_STYLES[item.event.type] ?? EVENT_TYPE_STYLES.custom
  const watermarkAlignment = alignment === 'leading' ? 'trailing' : 'leading'
  return (
    <Image
      systemName={eventStyle.icon}
      font={110}
      foregroundStyle={eventStyle.color as Color}
      opacity={0.09}
      frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: watermarkAlignment as any }}
      allowsHitTesting={false}
    />
  )
}

function SmallFullWatermark({ item }: { item: Occurrence }) {
  const eventStyle = EVENT_TYPE_STYLES[item.event.type] ?? EVENT_TYPE_STYLES.custom
  return (
    <Image
      systemName={eventStyle.icon}
      font={124}
      foregroundStyle={eventStyle.color as Color}
      opacity={0.075}
      frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' as any }}
      rotationEffect={{ degrees: -12, anchor: 'center' }}
      allowsHitTesting={false}
    />
  )
}

// 小号组件天数字号：位数越多字号越小，避免 4 位数被截断
function getSmallDaysFont(daysLeft: number): number {
  if (daysLeft === 0) return 48
  const digits = String(daysLeft).length
  if (digits <= 2) return 80
  if (digits === 3) return 64
  return 48
}

function buildWidgetCountdownParts(item: Occurrence) {
  const showYearsAndDays = item.event.showYearsAndDays ?? false
  if (item.daysLeft === 0) {
    return { main: '今天', suffix: '', color: 'systemRed' as Color, canToggle: false }
  }
  if (item.daysLeft > 0) {
    return {
      main: showYearsAndDays && item.daysLeft >= 365 ? formatElapsedYearsAndDays(new Date(), item.nextDate) : String(item.daysLeft),
      suffix: showYearsAndDays && item.daysLeft >= 365 ? '后' : '天后',
      color: 'accentColor' as Color,
      canToggle: item.daysLeft >= 365
    }
  }

  const absDays = Math.abs(item.daysLeft)
  return {
    main: showYearsAndDays && absDays >= 365 ? formatElapsedYearsAndDays(item.nextDate, new Date()) : String(absDays),
    suffix: showYearsAndDays && absDays >= 365 ? '前' : '天前',
    color: 'secondaryLabel' as Color,
    canToggle: absDays >= 365
  }
}

function getPhotoPath(item: Occurrence): string | null {
  return item.event.photoPath || item.person.avatarPath
}

function getWidgetGradientColor(item: Occurrence): ImageColor {
  const fallbackColor = hexToImageColor(getPersonFallbackColor(item.person))
  const path = getPhotoPath(item)
  if (!path) return fallbackColor
  if (widgetGradientCache.has(path)) {
    return widgetGradientCache.get(path) ?? fallbackColor
  }

  try {
    const image = UIImage.fromFile(path)
    const thumbnail = image?.preparingThumbnail({ width: 520, height: 520 }) ?? image
    const dominantColor = thumbnail ? extractDominantColor(thumbnail) ?? extractDominantColor(image as UIImage) : null
    widgetGradientCache.set(path, dominantColor)
    return dominantColor ?? fallbackColor
  } catch {
    widgetGradientCache.set(path, null)
    return fallbackColor
  }
}

function WidgetGradientBackground({ item, cornerRadius, enabled, photoSide = 'left' }: { item: Occurrence; cornerRadius: number; enabled: boolean; photoSide?: PhotoGradientSide }) {
  if (!enabled) return null
  const color = getWidgetGradientColor(item)
  const backgroundShape = { type: 'rect' as const, cornerRadius, style: 'continuous' as const }
  const gradientFill = {
    light: makeWidgetGradient(color, 0.9, 0.52, photoSide),
    dark: makeWidgetGradient(color, 0.78, 0.44, photoSide)
  }
  return (
    <ZStack
      allowsHitTesting={false}
      frame={{ maxWidth: Infinity, maxHeight: Infinity }}
      background={gradientFill}
      clipShape={backgroundShape}
      widgetBackground={{
        style: gradientFill,
        shape: backgroundShape
      }}
    >
      <RoundedRectangle
        cornerRadius={cornerRadius}
        fill="clear"
        frame={{ maxWidth: Infinity, maxHeight: Infinity }}
        stroke={{
          shapeStyle: makeWidgetStroke(color),
          strokeStyle: { lineWidth: 0.6 }
        }}
      />
    </ZStack>
  )
}

function getEventWidgetSize(event: AnniversaryEvent): AnniversaryEvent['widgetSize'] {
  return event.widgetSize ?? 'systemMedium'
}

function normalizeCardName(value: unknown): string {
  let text = String(value ?? '')
  if (text.includes('%')) {
    try {
      text = decodeURIComponent(text)
    } catch {
      // 保留原始参数继续匹配。
    }
  }
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unquoteCardName(value: string): string {
  const text = normalizeCardName(value)
  const first = text[0]
  const last = text[text.length - 1]
  if (
    text.length >= 2 &&
    ((first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '“' && last === '”') ||
      (first === '‘' && last === '’'))
  ) {
    return normalizeCardName(text.slice(1, -1))
  }
  return text
}

function readWidgetParameter(): string {
  const raw = normalizeCardName(Widget.parameter)
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return unquoteCardName(parsed)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      return unquoteCardName(
        String(record.cardName ?? record.name ?? record.parameter ?? record.value ?? record.title ?? '')
      )
    }
  } catch {
    // 普通文本参数不需要 JSON 解析。
  }
  return unquoteCardName(raw)
}

function getCardName(events: AnniversaryEvent[]): string {
  return normalizeCardName(events.find(event => normalizeCardName(event.cardName).length > 0)?.cardName)
}

function chunkPairs<T>(items: T[]): T[][] {
  const pairs: T[][] = []
  for (let index = 0; index < items.length; index += 2) {
    pairs.push(items.slice(index, index + 2))
  }
  return pairs
}

function compareLargePartOrder(a: AnniversaryEvent, b: AnniversaryEvent): number {
  const indexA = a.largePartIndex
  const indexB = b.largePartIndex
  if (typeof indexA === 'number' && typeof indexB === 'number' && indexA !== indexB) return indexA - indexB
  if (typeof indexA === 'number' && typeof indexB !== 'number') return -1
  if (typeof indexA !== 'number' && typeof indexB === 'number') return 1
  return a.createdAt - b.createdAt
}

function buildLargeEventCards(events: AnniversaryEvent[]): WidgetEventCard[] {
  const largeEvents = events
    .filter(event => getEventWidgetSize(event) === 'systemLarge')
    .sort((a, b) => a.createdAt - b.createdAt)
  const grouped = new Map<string, AnniversaryEvent[]>()
  const ungrouped: AnniversaryEvent[] = []

  for (const event of largeEvents) {
    const groupId = event.largeGroupId
    if (!groupId) {
      ungrouped.push(event)
      continue
    }
    const group = grouped.get(groupId) ?? []
    group.push(event)
    grouped.set(groupId, group)
  }

  const groupedCards = Array.from(grouped.values()).map(group => {
    const sorted = [...group].sort(compareLargePartOrder)
    return { events: sorted, name: getCardName(sorted) }
  })
  const ungroupedCards = chunkPairs(ungrouped).map(group => ({
    events: group,
    name: getCardName(group)
  }))
  return [...groupedCards, ...ungroupedCards]
}

function buildSingleEventCards(events: AnniversaryEvent[], size: AnniversaryEvent['widgetSize']): WidgetEventCard[] {
  return events
    .filter(event => getEventWidgetSize(event) === size)
    .map(event => ({ events: [event], name: getCardName([event]) }))
}

function selectWidgetEvents(events: AnniversaryEvent[], targetSize: AnniversaryEvent['widgetSize'] | null, parameter: string): AnniversaryEvent[] {
  if (!targetSize) return []
  const cards = targetSize === 'systemLarge'
    ? buildLargeEventCards(events)
    : buildSingleEventCards(events, targetSize)

  const normalizedParameter = normalizeCardName(parameter)
  if (normalizedParameter) {
    return cards.find(card => normalizeCardName(card.name) === normalizedParameter)?.events ?? []
  }

  const unnamedCard = cards.find(card => card.name.length === 0)
  if (unnamedCard) return unnamedCard.events

  return cards.length === 1 ? cards[0].events : []
}

function PhotoBlock({
  item,
  width,
  height,
  clipShape
}: {
  item: Occurrence
  width: number
  height: number
  clipShape: any
}) {
  const path = getPhotoPath(item)
  if (path) {
    const image = UIImage.fromFile(path)?.withRenderingMode('alwaysOriginal') ?? null
    if (image) {
      return (
        <Image
          image={image}
          resizable
          scaleToFill
          renderingMode="original"
          widgetAccentedRenderingMode="fullColor"
          interpolation="high"
          frame={{ width, height }}
          clipShape={clipShape}
        />
      )
    }

    return (
      <Image
        filePath={path}
        resizable
        scaleToFill
        renderingMode="original"
        widgetAccentedRenderingMode="fullColor"
        interpolation="high"
        frame={{ width, height }}
        clipShape={clipShape}
      />
    )
  }

  const style = RELATIONSHIP_STYLES[item.person.relationship?.trim() || '其他'] ?? DEFAULT_RELATIONSHIP_STYLE
  const char = item.person.name.trim().charAt(0) || '?'
  return (
    <VStack
      frame={{ width, height }}
      background={colorWithAlpha(style.color, 0.16)}
      clipShape={clipShape}
      alignment="center"
    >
      <Text font={Math.max(24, height * 0.28)} fontWeight="semibold" foregroundStyle={style.color as Color}>
        {char}
      </Text>
    </VStack>
  )
}

// 副标题胶囊标签：生日显示年龄、恋爱/结婚显示周年、一次性事件显示“时光纪念”等
function EventSubtitleTags({ item }: { item: Occurrence }) {
  const event = item.event
  const effectiveType = getEffectiveType(event)

  if (effectiveType === 'birthday' && item.age !== undefined) {
    // 不满 1 岁显示月龄，不满 1 个月显示天数，当天显示“今天”
    let ageLabel = `${item.age} 岁`
    if (item.age === 0) {
      if (item.months !== undefined && item.months > 0) {
        ageLabel = `${item.months} 月龄`
      } else if (item.daysSince !== undefined && item.daysSince >= 0) {
        ageLabel = item.daysSince === 0 ? '今天' : `${item.daysSince} 天`
      }
    }
    return <CapsuleTag label={ageLabel} color="#007AFF" />
  }

  if (effectiveType === 'love' && item.yearsPassed !== undefined) {
    // 不满 1 周年显示月数，不满 1 个月显示天数，当天显示“今天”
    let label = `${item.yearsPassed} 周年`
    if (item.yearsPassed === 0) {
      if (item.months !== undefined && item.months > 0) {
        label = `${item.months} 个月`
      } else if (item.daysSince !== undefined && item.daysSince >= 0) {
        label = item.daysSince === 0 ? '今天' : `${item.daysSince} 天`
      }
    }
    return <CapsuleTag label={label} color="#FF2D55" />
  }

  if (effectiveType === 'wedding' && item.yearsPassed !== undefined) {
    // 不满 1 周年显示月数，不满 1 个月显示天数，当天显示“今天”
    let label = `${item.yearsPassed} 周年`
    if (item.yearsPassed === 0) {
      if (item.months !== undefined && item.months > 0) {
        label = `${item.months} 个月`
      } else if (item.daysSince !== undefined && item.daysSince >= 0) {
        label = item.daysSince === 0 ? '今天' : `${item.daysSince} 天`
      }
    }
    const anniversaryName = item.yearsPassed > 0 ? getWeddingAnniversaryName(item.yearsPassed) : undefined
    return (
      <HStack spacing={4} alignment="center">
        <CapsuleTag label={label} color="#FF2D55" />
        {anniversaryName ? <CapsuleTag label={anniversaryName} color={getWeddingNameColor(item.yearsPassed)} /> : null}
      </HStack>
    )
  }

  return <CapsuleTag label="时光纪念" color="#8E8E93" />
}

function CountdownText({ item, font, suffixFont }: { item: Occurrence; font: number; suffixFont: number }) {
  const parts = buildWidgetCountdownParts(item)
  const content = (
    <HStack spacing={2} alignment="firstTextBaseline">
      <Text fontWeight="bold" fontDesign="rounded" font={font} foregroundStyle={parts.color} lineLimit={1} minScaleFactor={0.55}>
        {parts.main}
      </Text>
      {parts.suffix ? <Text fontWeight="medium" font={suffixFont} foregroundStyle={parts.color}>{parts.suffix}</Text> : null}
    </HStack>
  )
  return parts.canToggle ? <Button intent={ToggleCountdownFormatIntent(item.event.id)} buttonStyle="plain">{content}</Button> : content
}

function SmallCountdownText({ item }: { item: Occurrence }) {
  const parts = buildWidgetCountdownParts(item)
  const font = parts.main.includes('年') ? 30 : Math.min(60, getSmallDaysFont(item.daysLeft))
  const content = (
    <HStack spacing={2} alignment="firstTextBaseline">
      <Text fontWeight="bold" fontDesign="rounded" font={font} foregroundStyle={parts.color} lineLimit={1} minScaleFactor={0.45}>
        {parts.main}
      </Text>
      {parts.suffix ? <Text fontWeight="semibold" font={15} foregroundStyle={parts.color}>{parts.suffix}</Text> : null}
    </HStack>
  )
  return parts.canToggle ? <Button intent={ToggleCountdownFormatIntent(item.event.id)} buttonStyle="plain">{content}</Button> : content
}

function MediumCardPart({
  item,
  height,
  variant = 'standalone'
}: {
  item: Occurrence
  height: number
  variant?: 'standalone' | 'largeTop' | 'largeBottom'
}) {
  const dateText = formatDateShort(item.nextDate)
  const avatarPosition = item.event.avatarPosition ?? 'left'
  const cornerRadius = variant === 'standalone' ? 24 : 0

  return (
    <GeometryReader frame={{ maxWidth: Infinity, height }}>
      {({ size }) => {
        const photoWidth = Math.max(120, size.width * 0.5)
        const photoShape = variant === 'standalone'
          ? {
            type: 'rect' as const,
            cornerRadii: avatarPosition === 'left'
              ? { topLeading: 24, bottomLeading: 24, topTrailing: 0, bottomTrailing: 0 }
              : { topLeading: 0, bottomLeading: 0, topTrailing: 24, bottomTrailing: 24 },
            style: 'continuous' as const
          }
          : variant === 'largeTop'
            ? {
              type: 'rect' as const,
              cornerRadii: avatarPosition === 'left'
                ? { topLeading: 24, topTrailing: 0, bottomLeading: 0, bottomTrailing: 0 }
                : { topLeading: 0, topTrailing: 24, bottomLeading: 0, bottomTrailing: 0 },
              style: 'continuous' as const
            }
            : {
              type: 'rect' as const,
              cornerRadii: avatarPosition === 'left'
                ? { topLeading: 0, topTrailing: 0, bottomLeading: 24, bottomTrailing: 0 }
                : { topLeading: 0, topTrailing: 0, bottomLeading: 0, bottomTrailing: 24 },
              style: 'continuous' as const
            }
        const photo = <PhotoBlock item={item} width={photoWidth} height={height} clipShape={photoShape} />
        const textAlignment: 'leading' | 'trailing' = avatarPosition === 'right' ? 'trailing' : 'leading'
        const text = (
          <ZStack frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
            <TextWatermark item={item} alignment={textAlignment} dense={item.event.denseWatermarkEnabled ?? true} />
            <VStack alignment={textAlignment} spacing={8} frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: textAlignment as any }} padding={{ top: 8, bottom: 8, leading: 10, trailing: 10 }}>
              <EventTitleBlock item={item} nameFont={20} typeFont={16} alignment={textAlignment} />
              <DateLine text={dateText} font={13} alignment={textAlignment} />
              <CountdownText item={item} font={34} suffixFont={12} />
            </VStack>
          </ZStack>
        )
        return (
          <ZStack frame={{ maxWidth: Infinity, height }} clipShape={{ type: 'rect', cornerRadius, style: 'continuous' as const }}>
            <WidgetGradientBackground item={item} cornerRadius={cornerRadius} enabled={item.event.widgetGradientEnabled === true} photoSide={avatarPosition} />
            <HStack spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: 'leading' as any }}>
              {avatarPosition === 'left' ? photo : null}
              {text}
              {avatarPosition === 'right' ? photo : null}
            </HStack>
          </ZStack>
        )
      }}
    </GeometryReader>
  )
}

function SmallWidgetView({ item }: { item: Occurrence }) {
  const dateText = formatDateShort(item.nextDate)
  const shape = item.event.avatarShape === 'rounded'
    ? { type: 'rect' as const, cornerRadius: 16, style: 'continuous' as const }
    : 'circle' as const

  return (
    <ZStack frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
      <WidgetGradientBackground item={item} cornerRadius={22} enabled={item.event.widgetGradientEnabled === true} />
      {(item.event.denseWatermarkEnabled ?? true) ? <DenseTextWatermark item={item} /> : <SmallFullWatermark item={item} />}
      <VStack spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity }} padding={12}>
        <HStack spacing={8} frame={{ maxWidth: Infinity }}>
          <PhotoBlock item={item} width={58} height={58} clipShape={shape} />
          <VStack alignment="center" spacing={4} frame={{ maxWidth: Infinity, alignment: 'center' as any }}>
            <EventTitleBlock item={item} nameFont={17} typeFont={14} spacing={2} alignment="center" />
            <EventSubtitleTags item={item} />
          </VStack>
        </HStack>
        <Spacer />
        <SmallCountdownText item={item} />
        <Spacer />
        <DateLine text={dateText} font={12} alignment="center" />
      </VStack>
    </ZStack>
  )
}

// 空状态提示
function EmptyWidgetView() {
  return (
    <VStack spacing={8} alignment="center" frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
      <Image systemName="heart.text.square" font={36} foregroundStyle="quaternaryLabel" />
      <Text fontWeight="semibold" font={14} foregroundStyle="secondaryLabel">还没有时光纪念</Text>
      <Text font={11} foregroundStyle="tertiaryLabel">打开应用添加重要日子</Text>
    </VStack>
  )
}

function MediumWidgetView({ item }: { item: Occurrence }) {
  return (
    <GeometryReader>
      {({ size }) => (
        <ZStack frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
          <MediumCardPart item={item} height={size.height} />
        </ZStack>
      )}
    </GeometryReader>
  )
}

function LargeWidgetView({ items }: { items: Occurrence[] }) {
  const first = items[0]
  const second = items[1]
  if (!first) return <EmptyWidgetView />

  return (
    <GeometryReader>
      {({ size }) => {
        const rowHeight = size.height / 2
        return (
          <ZStack frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
            <VStack spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
              <MediumCardPart item={first} height={rowHeight} variant="largeTop" />
              {second ? <MediumCardPart item={second} height={rowHeight} variant="largeBottom" /> : null}
            </VStack>
          </ZStack>
        )
      }}
    </GeometryReader>
  )
}

// 根视图：按尺寸决定展示数量与布局
function WidgetView({ occurrences }: { occurrences: Occurrence[] }) {
  const family = getNormalizedWidgetFamily()
  const items = occurrences.slice(0, getDisplayLimit())
  const cornerRadius = family === 'systemSmall' ? 22 : 24

  const content = (() => {
    if (items.length === 0) {
      return <EmptyWidgetView />
    }

    if (family === 'systemSmall') {
      return <SmallWidgetView item={items[0]} />
    }

    if (family === 'systemLarge') {
      return <LargeWidgetView items={items} />
    }

    return <MediumWidgetView item={items[0]} />
  })()

  return (
    <ZStack
      contentMargins={0}
      containerShape={{ type: 'rect', cornerRadius, style: 'continuous' as const }}
      clipShape={{ type: 'rect', cornerRadius, style: 'continuous' as const }}
      frame={{ width: Widget.displaySize.width, height: Widget.displaySize.height }}
    >
      {content}
    </ZStack>
  )
}

// 将人物头像替换为小组件专用缩略图路径（首次会按需生成缓存）
async function resolvePersonsWidgetAvatars(persons: Person[]): Promise<Person[]> {
  return Promise.all(
    persons.map(async (person) => {
      if (!person.avatarPath) return person
      const widgetPath = await resolveWidgetAvatarPath(person.avatarPath)
      return widgetPath ? { ...person, avatarPath: widgetPath } : person
    })
  )
}

async function resolveEventsWidgetPhotos(events: AnniversaryEvent[]): Promise<AnniversaryEvent[]> {
  return Promise.all(
    events.map(async (event) => {
      if (!event.photoPath) return event
      const widgetPath = await resolveWidgetAvatarPath(event.photoPath)
      return widgetPath ? { ...event, photoPath: widgetPath } : event
    })
  )
}

// 读取数据并按首页规则排序：置顶优先，其次即将到来的时光纪念
async function prepareOccurrences(): Promise<Occurrence[]> {
  let data: AppData
  try {
    data = await loadAppData()
  } catch {
    return []
  }

  const persons = await resolvePersonsWidgetAvatars(data.persons)
  const parameter = readWidgetParameter()
  const targetSize = getWidgetSizeForFamily()
  const sourceEvents = selectWidgetEvents(data.events, targetSize, parameter)
  const events = await resolveEventsWidgetPhotos(sourceEvents)
  const personMap = new Map(persons.map(p => [p.id, p]))
  const list = buildOccurrenceList(events, id => personMap.get(id), new Date()) as Occurrence[]

  const occurrenceMap = new Map(list.map(item => [item.event.id, item]))
  return events.map(event => occurrenceMap.get(event.id)).filter(Boolean) as Occurrence[]
}

// 异步加载后呈现小组件
async function run() {
  const occurrences = await prepareOccurrences()
  Widget.present(<WidgetView occurrences={occurrences} />)
}

run()
