import { Image, VStack, HStack, Text, Spacer, Button, Color, TextField, ZStack, RoundedRectangle, gradient, useEffect, useObservable, EmptyView, GeometryReader } from 'scripting'
import { Person, AnniversaryEvent, AnniversaryWidgetSize, OccurrenceInfo, AnniversaryAvatarShape, AnniversaryAvatarPosition } from './types'
import { formatDateCN, formatLunar, getNextOccurrence, daysBetween, getMonthsSince, getReferenceDate, getEffectiveType, getWeddingAnniversaryName, getWeddingNameColor, formatElapsedYearsAndDays } from './dateUtils'

// 把六位十六进制颜色转成 rgba 字符串，用于设置带透明度的背景
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16)
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  }
}

function colorWithAlpha(hex: string, alpha: number): Color {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})` as Color
}

// 表单输入行：左侧标题 + 文本框 + 清空按钮
interface FormRowProps {
  label: string
  value: string
  prompt?: string
  onChanged: (value: string) => void
}

export function FormRow({ label, value, prompt, onChanged }: FormRowProps) {
  return (
    <HStack alignment="center" spacing={12} frame={{ maxWidth: Infinity }}>
      <Text frame={{ width: 72, alignment: "leading" }}>{label}</Text>
      <TextField
        label={<Text>{label}</Text>}
        value={value}
        prompt={prompt}
        onChanged={onChanged}
      />
      {value.length > 0 ? (
        <Button action={() => onChanged('')} buttonStyle="plain">
          <Image systemName="xmark.circle.fill" font={16} foregroundStyle="tertiaryLabel" />
        </Button>
      ) : null}
    </HStack>
  )
}

// 列表和卡片中显示的事件类型名称
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

const EVENT_TYPE_ICONS: Record<AnniversaryEvent['type'], { icon: string; color: string }> = {
  birthday: { icon: 'gift.fill', color: '#FF9500' },
  meet: { icon: 'hand.wave.fill', color: '#007AFF' },
  love: { icon: 'heart.fill', color: '#FF2D55' },
  wedding: { icon: 'heart.circle.fill', color: '#AF52DE' },
  enrollment: { icon: 'book.fill', color: '#34C759' },
  graduation: { icon: 'graduationcap.fill', color: '#5856D6' },
  join: { icon: 'briefcase.fill', color: '#5AC8FA' },
  custom: { icon: 'star.fill', color: '#FFCC00' }
}

// 人物关系标签样式
export const RELATIONSHIP_STYLES: Record<string, { icon: string; color: string }> = {
  '自己': { icon: 'person.fill', color: '#007AFF' },
  '伴侣': { icon: 'heart.fill', color: '#FF2D55' },
  '子女': { icon: 'person.2.fill', color: '#FF9500' },
  '家人': { icon: 'house.fill', color: '#34C759' },
  '朋友': { icon: 'person.2.fill', color: '#5856D6' },
  '同学': { icon: 'graduationcap.fill', color: '#5AC8FA' },
  '同事': { icon: 'briefcase.fill', color: '#AF52DE' },
  '其他': { icon: 'tag.fill', color: '#8E8E93' }
}

export const DEFAULT_RELATIONSHIP_STYLE = RELATIONSHIP_STYLES['其他']

// 通用胶囊标签
export interface CapsuleTagProps {
  label: string
  color?: string
  icon?: string
}

export function CapsuleTag({ label, color = '#8E8E93', icon }: CapsuleTagProps) {
  const tagColor = color as Color
  const backgroundColor = colorWithAlpha(color, 0.16)
  return (
    <HStack
      spacing={4}
      padding={{ vertical: 4, horizontal: 8 }}
      background={backgroundColor}
      clipShape={{ type: 'rect', cornerRadius: 10 }}
      alignment="center"
    >
      {icon ? <Image systemName={icon} font={9} foregroundStyle={tagColor} /> : null}
      <Text font={10} fontWeight="medium" foregroundStyle={tagColor}>{label}</Text>
    </HStack>
  )
}

// 关系胶囊标签
interface RelationshipTagProps {
  relationship?: string
}

export function RelationshipTag({ relationship }: RelationshipTagProps) {
  const label = relationship?.trim() || '未设置关系'
  const style = RELATIONSHIP_STYLES[label] ?? DEFAULT_RELATIONSHIP_STYLE
  return <CapsuleTag label={label} color={style.color} icon={style.icon} />
}

// 圆形滑动操作按钮（图标在上，文字在下）
interface SwipeActionButtonProps {
  icon: string
  label: string
  color: Color
  action: () => void
}

function SwipeActionButton({ icon, label, color, action }: SwipeActionButtonProps) {
  return (
    <Button action={action} tint={color}>
      <VStack alignment="center" spacing={2} frame={{ width: 56, height: 56 }} clipShape="circle">
        <Image systemName={icon} font={18} foregroundStyle="white" />
        <Text font={10} foregroundStyle="white">{label}</Text>
      </VStack>
    </Button>
  )
}

// 头像组件
interface AvatarProps {
  person: Person
  size?: number
  shape?: AnniversaryAvatarShape
  image?: UIImage | null
}

function getAvatarClipShape(shape: AnniversaryAvatarShape = 'circle', size = 48): any {
  if (shape === 'rounded') {
    return { type: 'rect', cornerRadius: Math.max(12, size * 0.22), style: 'continuous' as const }
  }
  return 'circle'
}

function CardPhoto({
  person,
  image,
  filePath,
  width,
  height,
  cornerRadius,
  clipShape
}: {
  person: Person
  image: UIImage | null
  filePath?: string | null
  width: number
  height: number
  cornerRadius: number
  clipShape?: any
}) {
  const shape = clipShape ?? { type: 'rect' as const, cornerRadius, style: 'continuous' as const }

  if (image) {
    return (
      <Image
        image={image}
        resizable
        scaleToFill
        frame={{ width, height }}
        clipShape={shape}
      />
    )
  }

  if (filePath || person.avatarPath) {
    return (
      <Image
        filePath={(filePath || person.avatarPath) as string}
        resizable
        scaleToFill
        frame={{ width, height }}
        clipShape={shape}
      />
    )
  }

  const style = RELATIONSHIP_STYLES[person.relationship?.trim() || '其他'] ?? DEFAULT_RELATIONSHIP_STYLE
  const backgroundColor = colorWithAlpha(style.color, 0.16)
  const char = person.name.trim().charAt(0) || '?'
  return (
    <VStack
      frame={{ width, height }}
      background={backgroundColor}
      clipShape={shape}
      alignment="center"
    >
      <Text font={Math.max(22, height * 0.28)} fontWeight="semibold" foregroundStyle={style.color as Color}>
        {char}
      </Text>
    </VStack>
  )
}

export function Avatar({ person, size = 48, shape = 'circle', image }: AvatarProps) {
  const clipShape = getAvatarClipShape(shape, size)

  if (image) {
    return (
      <Image
        image={image}
        resizable
        scaleToFill
        frame={{ width: size, height: size }}
        clipShape={clipShape}
      />
    )
  }

  if (person.avatarPath) {
    return (
      <Image
        filePath={person.avatarPath}
        resizable
        scaleToFill
        frame={{ width: size, height: size }}
        clipShape={clipShape}
      />
    )
  }
  // 无头像时使用名字首字作为圆形文字头像
  const style = RELATIONSHIP_STYLES[person.relationship?.trim() || '其他'] ?? DEFAULT_RELATIONSHIP_STYLE
  const backgroundColor = colorWithAlpha(style.color, 0.16)
  const char = person.name.trim().charAt(0) || '?'
  return (
    <VStack
      frame={{ width: size, height: size }}
      background={backgroundColor}
      clipShape={clipShape}
      alignment="center"
    >
      <Text font={Math.max(12, size * 0.45)} fontWeight="semibold" foregroundStyle={style.color as Color}>
        {char}
      </Text>
    </VStack>
  )
}

// 空状态提示
interface EmptyStateProps {
  title: string
  subtitle?: string
  systemImage?: string
}

export function EmptyState({ title, subtitle, systemImage = "tray" }: EmptyStateProps) {
  return (
    <VStack padding spacing={12} alignment="center" frame={{ maxWidth: Infinity, minHeight: 240 }}>
      <Image systemName={systemImage} font={56} foregroundStyle="quaternaryLabel" />
      <VStack spacing={4} alignment="center">
        <Text fontWeight="semibold" font={17} foregroundStyle="secondaryLabel">{title}</Text>
        {subtitle ? <Text foregroundStyle="tertiaryLabel" font={14}>{subtitle}</Text> : null}
      </VStack>
    </VStack>
  )
}

// 人物卡片
interface PersonCardProps {
  person: Person
  eventCount: number
  onSelected?: () => void
  onDelete?: () => void
  onTogglePin?: () => void
}

export function PersonCard({ person, eventCount, onSelected, onDelete, onTogglePin }: PersonCardProps) {
  const countText = eventCount > 0 ? `${eventCount} 个时光纪念` : '暂无时光纪念'
  const pinTitle = person.isPinned ? '取消置顶' : '置顶'

  return (
    <Button
      action={onSelected ?? (() => {})}
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [
          <SwipeActionButton key="置顶" icon={person.isPinned ? 'pin.slash' : 'pin.fill'} label={pinTitle} color="#FF9500" action={onTogglePin ?? (() => {})} />,
          <SwipeActionButton key="删除" icon="trash.fill" label="删除" color="systemRed" action={onDelete ?? (() => {})} />
        ]
      }}
    >
      <HStack spacing={14} padding={{ vertical: 8, horizontal: 8 }} frame={{ maxWidth: Infinity }} alignment="center">
        <Avatar person={person} size={58} />
        <VStack alignment="leading" spacing={5}>
          <Text fontWeight="semibold" font={18}>{person.name}</Text>
          <RelationshipTag relationship={person.relationship} />
        </VStack>
        <Spacer />
        <HStack spacing={4} alignment="center">
          <Text foregroundStyle="secondaryLabel" fontWeight="medium" font={15}>{countText}</Text>
          <Image systemName="chevron.right" font={15} foregroundStyle="tertiaryLabel" fontWeight="medium" />
        </HStack>
      </HStack>
    </Button>
  )
}

// 时光纪念列表行
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

type PersonCardArtwork = {
  image: UIImage | null
  dominantColor: ImageColor | null
}

type PersonCardArtworkState = {
  image: UIImage | null
  color: ImageColor
}

const cardArtworkCache = new Map<string, PersonCardArtwork>()

const neutralCardFill = {
  light: 'rgba(255,255,255,0.96)',
  dark: 'rgba(28,28,30,0.96)'
} as const

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function hexToImageColor(hex: string): ImageColor {
  const { r, g, b } = hexToRgb(hex)
  return {
    red: r / 255,
    green: g / 255,
    blue: b / 255,
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
  const saturation = clamp(hsl.saturation * 1.18)
  const lightness = clamp(hsl.lightness > 0.5 ? hsl.lightness : hsl.lightness + 0.06, 0, 0.82)
  return hslToRgb(hsl.hue, saturation, lightness)
}

type PhotoGradientSide = 'left' | 'right'

function makeCardGradient(color: ImageColor, startAlpha: number, middleAlpha: number, photoSide: PhotoGradientSide = 'left') {
  const rgb = normalizeBackgroundRgb(color)
  return gradient('linear', {
    stops: [
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, startAlpha), location: 0 },
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, middleAlpha), location: 0.58 },
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, middleAlpha * 0.38), location: 0.82 },
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, 0), location: 1 }
    ],
    startPoint: photoSide === 'right' ? 'trailing' : 'leading',
    endPoint: photoSide === 'right' ? 'leading' : 'trailing'
  })
}

function makeCardStroke(color: ImageColor) {
  const rgb = normalizeBackgroundRgb(color)
  return {
    light: rgbaString(rgb.red, rgb.green, rgb.blue, 0.28),
    dark: rgbaString(rgb.red, rgb.green, rgb.blue, 0.36)
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

function getEventPhotoPath(event: AnniversaryEvent, person: Person): string | null {
  return event.photoPath || person.avatarPath
}

function getEventDisplayLabel(event: AnniversaryEvent): string {
  return event.type === 'custom'
    ? (event.title || '其他')
    : (EVENT_TYPE_LABELS[event.type] || '时光纪念')
}

type CardTextAlignment = 'leading' | 'center' | 'trailing'

function CardTitleBlock({
  event,
  person,
  nameFont,
  typeFont,
  spacing = 3,
  alignment = 'leading'
}: {
  event: AnniversaryEvent
  person: Person
  nameFont: number
  typeFont: number
  spacing?: number
  alignment?: CardTextAlignment
}) {
  const relationshipStyle = RELATIONSHIP_STYLES[person.relationship?.trim() || '其他'] ?? DEFAULT_RELATIONSHIP_STYLE
  const eventStyle = EVENT_TYPE_ICONS[event.type] ?? EVENT_TYPE_ICONS.custom
  const alignValue = alignment as any
  return (
    <VStack alignment={alignment} spacing={spacing} frame={{ maxWidth: Infinity, alignment: alignValue }}>
      <Text fontWeight="bold" font={nameFont} foregroundStyle={relationshipStyle.color as Color} lineLimit={1} minScaleFactor={0.72}>{person.name}</Text>
      <HStack spacing={4} alignment="center" frame={{ maxWidth: Infinity, alignment: alignValue }}>
        {alignment !== 'trailing' ? <Image systemName={eventStyle.icon} font={Math.max(12, typeFont - 2)} foregroundStyle={eventStyle.color as Color} /> : null}
        <Text fontWeight="semibold" font={typeFont} foregroundStyle={eventStyle.color as Color} lineLimit={1} minScaleFactor={0.72}>{getEventDisplayLabel(event)}</Text>
        {alignment === 'trailing' ? <Image systemName={eventStyle.icon} font={Math.max(12, typeFont - 2)} foregroundStyle={eventStyle.color as Color} /> : null}
      </HStack>
    </VStack>
  )
}

function CardDateLine({ text, font = 13, alignment = 'leading' }: { text: string; font?: number; alignment?: CardTextAlignment }) {
  const alignValue = alignment as any
  return (
    <HStack spacing={4} alignment="center" frame={{ maxWidth: Infinity, alignment: alignValue }}>
      {alignment !== 'trailing' ? <Image systemName="calendar" font={Math.max(11, font - 1)} foregroundStyle="systemTeal" /> : null}
      <Text font={font} fontWeight="medium" foregroundStyle="systemTeal" lineLimit={2} minScaleFactor={0.78}>{text}</Text>
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

function DenseCardTextWatermark({ event }: { event: AnniversaryEvent }) {
  const eventStyle = EVENT_TYPE_ICONS[event.type] ?? EVENT_TYPE_ICONS.custom
  return (
    <GeometryReader frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
      {({ size }) => (
        <ZStack frame={{ width: size.width, height: size.height }}>
          {DENSE_WATERMARK_PATTERN.map((mark, index) => (
            <Image
              key={index}
              systemName={eventStyle.icon}
              font={Math.round(18 + mark.scale * 10)}
              foregroundStyle={eventStyle.color as Color}
              opacity={0.055}
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

function CardTextWatermark({ event, alignment, dense }: { event: AnniversaryEvent; alignment: 'leading' | 'trailing'; dense?: boolean }) {
  if (dense) return <DenseCardTextWatermark event={event} />

  const eventStyle = EVENT_TYPE_ICONS[event.type] ?? EVENT_TYPE_ICONS.custom
  const watermarkAlignment = alignment === 'leading' ? 'trailing' : 'leading'
  return (
    <Image
      systemName={eventStyle.icon}
      font={112}
      foregroundStyle={eventStyle.color as Color}
      opacity={0.09}
      frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: watermarkAlignment as any }}
      allowsHitTesting={false}
    />
  )
}

function SmallCardWatermark({ event }: { event: AnniversaryEvent }) {
  const eventStyle = EVENT_TYPE_ICONS[event.type] ?? EVENT_TYPE_ICONS.custom
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

function useCardArtwork(event: AnniversaryEvent, person: Person): PersonCardArtworkState {
  const fallbackHex = getPersonFallbackColor(person)
  const artwork = useObservable<PersonCardArtworkState>({
    image: null,
    color: hexToImageColor(fallbackHex)
  })

  useEffect(() => {
    const avatarPath = getEventPhotoPath(event, person)
    const fallbackColor = hexToImageColor(fallbackHex)
    if (!avatarPath) {
      artwork.setValue({ image: null, color: fallbackColor })
      return
    }

    if (cardArtworkCache.has(avatarPath)) {
      const cached = cardArtworkCache.get(avatarPath)
      artwork.setValue({
        image: cached?.image ?? null,
        color: cached?.dominantColor ?? fallbackColor
      })
      return
    }

    try {
      const image = UIImage.fromFile(avatarPath)
      const thumbnail = image?.preparingThumbnail({ width: 520, height: 520 }) ?? image
      const dominantColor = thumbnail ? extractDominantColor(thumbnail) ?? extractDominantColor(image as UIImage) : null
      const nextArtwork = { image: thumbnail ?? null, dominantColor }
      cardArtworkCache.set(avatarPath, nextArtwork)
      artwork.setValue({
        image: nextArtwork.image,
        color: dominantColor ?? fallbackColor
      })
    } catch {
      cardArtworkCache.set(avatarPath, { image: null, dominantColor: null })
      artwork.setValue({ image: null, color: fallbackColor })
    }
  }, [event.photoPath, person.avatarPath, fallbackHex])

  return artwork.value
}

function GradientCardBackground({ color, cornerRadius, photoSide = 'left' }: { color: ImageColor; cornerRadius: number; photoSide?: PhotoGradientSide }) {
  return (
    <ZStack allowsHitTesting={false} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
      <RoundedRectangle
        cornerRadius={cornerRadius}
        fill={neutralCardFill}
        frame={{ maxWidth: Infinity, maxHeight: Infinity }}
      />
      <RoundedRectangle
        cornerRadius={cornerRadius}
        fill={{
          light: makeCardGradient(color, 0.86, 0.5, photoSide),
          dark: makeCardGradient(color, 0.74, 0.42, photoSide)
        }}
        frame={{ maxWidth: Infinity, maxHeight: Infinity }}
      />
      <RoundedRectangle
        cornerRadius={cornerRadius}
        fill="clear"
        frame={{ maxWidth: Infinity, maxHeight: Infinity }}
        stroke={{
          shapeStyle: makeCardStroke(color),
          strokeStyle: { lineWidth: 0.6 }
        }}
      />
    </ZStack>
  )
}

function formatDateShort(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function buildCountdownParts(event: AnniversaryEvent, nextDate: Date, daysLeft: number) {
  const showYearsAndDays = event.showYearsAndDays ?? false
  if (daysLeft === 0) {
    return { main: '今天', suffix: '', color: 'systemRed' as Color, canToggle: false }
  }
  if (daysLeft > 0) {
    return {
      main: showYearsAndDays && daysLeft >= 365 ? formatElapsedYearsAndDays(new Date(), nextDate) : String(daysLeft),
      suffix: showYearsAndDays && daysLeft >= 365 ? '后' : '天后',
      color: 'accentColor' as Color,
      canToggle: daysLeft >= 365
    }
  }
  const absDays = Math.abs(daysLeft)
  return {
    main: showYearsAndDays && absDays >= 365 ? formatElapsedYearsAndDays(nextDate, new Date()) : String(absDays),
    suffix: showYearsAndDays && absDays >= 365 ? '前' : '天前',
    color: 'secondaryLabel' as Color,
    canToggle: absDays >= 365
  }
}

function buildTargetDateText(event: AnniversaryEvent, nextDate: Date, daysLeft: number): string {
  const refDate = getReferenceDate(event)
  if (daysLeft < 0) {
    if (event.isLunar && event.lunarMonth && event.lunarDay) {
      return formatLunar(event.lunarMonth, event.lunarDay, event.isLeapMonth)
    }
    return refDate ? formatDateCN(refDate) : formatDateCN(nextDate)
  }
  return formatDateCN(nextDate)
}

function WidgetCardSubtitleTags({ item }: { item: OccurrenceInfo }) {
  const event = item.event
  const today = new Date()
  const effectiveType = getEffectiveType(event)
  const refDate = getReferenceDate(event)
  const daysSince = refDate ? daysBetween(refDate, today) : undefined
  const months = getMonthsSince(event, today)

  if (effectiveType === 'birthday' && item.age !== undefined) {
    let ageLabel = `${item.age} 岁`
    if (item.age === 0) {
      if (months !== undefined && months > 0) {
        ageLabel = `${months} 月龄`
      } else if (daysSince !== undefined && daysSince >= 0) {
        ageLabel = daysSince === 0 ? '今天' : `${daysSince} 天`
      }
    }
    return <CapsuleTag label={ageLabel} color="#007AFF" />
  }

  if (effectiveType === 'love' && item.yearsPassed !== undefined) {
    let label = `${item.yearsPassed} 周年`
    if (item.yearsPassed === 0) {
      if (months !== undefined && months > 0) {
        label = `${months} 个月`
      } else if (daysSince !== undefined && daysSince >= 0) {
        label = daysSince === 0 ? '今天' : `${daysSince} 天`
      }
    }
    return <CapsuleTag label={label} color="#FF2D55" />
  }

  if (effectiveType === 'wedding' && item.yearsPassed !== undefined) {
    let label = `${item.yearsPassed} 周年`
    if (item.yearsPassed === 0) {
      if (months !== undefined && months > 0) {
        label = `${months} 个月`
      } else if (daysSince !== undefined && daysSince >= 0) {
        label = daysSince === 0 ? '今天' : `${daysSince} 天`
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

function CountdownText({
  event,
  nextDate,
  daysLeft,
  font,
  suffixFont,
  onToggleCountdownFormat
}: {
  event: AnniversaryEvent
  nextDate: Date
  daysLeft: number
  font: number
  suffixFont: number
  onToggleCountdownFormat?: () => void
}) {
  const parts = buildCountdownParts(event, nextDate, daysLeft)
  return (
    <HStack
      spacing={2}
      alignment="firstTextBaseline"
      onTapGesture={parts.canToggle ? onToggleCountdownFormat : undefined}
    >
      <Text fontWeight="bold" fontDesign="rounded" font={font} foregroundStyle={parts.color} lineLimit={1} minScaleFactor={0.55}>{parts.main}</Text>
      {parts.suffix ? <Text fontWeight="medium" font={suffixFont} foregroundStyle={parts.color} opacity={0.82}>{parts.suffix}</Text> : null}
    </HStack>
  )
}

type SingleAnniversaryWidgetSize = Exclude<AnniversaryWidgetSize, 'systemLarge'>

interface AnniversaryWidgetCardProps {
  item: OccurrenceInfo
  size: SingleAnniversaryWidgetSize
  onSelected?: () => void
  onDelete?: () => void
  onTogglePin?: () => void
  onToggleCountdownFormat?: () => void
}

function WidgetCardContent({ item, size, onToggleCountdownFormat }: AnniversaryWidgetCardProps) {
  const artwork = useCardArtwork(item.event, item.person)
  const targetDateText = buildTargetDateText(item.event, item.nextDate, item.daysLeft)
  const shortDateText = formatDateShort(item.nextDate)
  const cornerRadius = size === 'systemSmall' ? 22 : 24
  const avatarShape = item.event.avatarShape ?? 'circle'
  const avatarPosition: AnniversaryAvatarPosition = item.event.avatarPosition ?? 'left'
  const photoPath = getEventPhotoPath(item.event, item.person)
  const photoPerson: Person = { ...item.person, avatarPath: photoPath }

  if (size === 'systemSmall') {
    return (
      <HStack frame={{ maxWidth: Infinity, alignment: 'leading' as any }}>
        <ZStack frame={{ width: 170, height: 170 }} clipShape={{ type: 'rect', cornerRadius, style: 'continuous' as const }}>
          <GradientCardBackground color={artwork.color} cornerRadius={cornerRadius} />
          {(item.event.denseWatermarkEnabled ?? true) ? <DenseCardTextWatermark event={item.event} /> : <SmallCardWatermark event={item.event} />}
          <VStack spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity }} padding={{ top: 12, bottom: 12, leading: 12, trailing: 12 }}>
            <HStack spacing={8} frame={{ maxWidth: Infinity }} alignment="center">
              <Avatar person={photoPerson} size={58} shape={avatarShape} image={artwork.image} />
              <VStack alignment="center" spacing={4} frame={{ maxWidth: Infinity, alignment: 'center' as any }}>
                <CardTitleBlock event={item.event} person={item.person} nameFont={17} typeFont={14} spacing={2} alignment="center" />
                <WidgetCardSubtitleTags item={item} />
              </VStack>
            </HStack>
            <Spacer />
            <CountdownText event={item.event} nextDate={item.nextDate} daysLeft={item.daysLeft} font={54} suffixFont={15} onToggleCountdownFormat={onToggleCountdownFormat} />
            <Spacer />
            <CardDateLine text={shortDateText} font={12} alignment="center" />
          </VStack>
        </ZStack>
      </HStack>
    )
  }

  return <MediumWidgetCardContent item={item} artwork={artwork} targetDateText={targetDateText} cornerRadius={cornerRadius} avatarPosition={avatarPosition} onToggleCountdownFormat={onToggleCountdownFormat} />
}

function MediumWidgetCardContent({
  item,
  artwork,
  targetDateText,
  cornerRadius,
  avatarPosition,
  onToggleCountdownFormat,
  variant = 'standalone'
}: {
  item: OccurrenceInfo
  artwork: PersonCardArtworkState
  targetDateText: string
  cornerRadius: number
  avatarPosition: AnniversaryAvatarPosition
  onToggleCountdownFormat?: () => void
  variant?: 'standalone' | 'largeTop' | 'largeBottom'
}) {
  const height = variant === 'standalone' ? 184 : 190
  const backgroundCornerRadius = variant === 'standalone' ? cornerRadius : 0
  const makePhotoClipShape = () => {
    if (variant === 'standalone') {
      return {
        type: 'rect' as const,
        cornerRadii: avatarPosition === 'left'
          ? { topLeading: cornerRadius, topTrailing: 0, bottomLeading: cornerRadius, bottomTrailing: 0 }
          : { topLeading: 0, topTrailing: cornerRadius, bottomLeading: 0, bottomTrailing: cornerRadius },
        style: 'continuous' as const
      }
    }
    if (variant === 'largeTop') {
      return {
        type: 'rect' as const,
        cornerRadii: avatarPosition === 'left'
          ? { topLeading: cornerRadius, topTrailing: 0, bottomLeading: 0, bottomTrailing: 0 }
          : { topLeading: 0, topTrailing: cornerRadius, bottomLeading: 0, bottomTrailing: 0 },
        style: 'continuous' as const
      }
    }
    return {
      type: 'rect' as const,
      cornerRadii: avatarPosition === 'left'
        ? { topLeading: 0, topTrailing: 0, bottomLeading: cornerRadius, bottomTrailing: 0 }
        : { topLeading: 0, topTrailing: 0, bottomLeading: 0, bottomTrailing: cornerRadius },
      style: 'continuous' as const
    }
  }

  return (
    <ZStack frame={{ maxWidth: Infinity, height }} clipShape={{ type: 'rect', cornerRadius: backgroundCornerRadius, style: 'continuous' as const }}>
      <GradientCardBackground color={artwork.color} cornerRadius={backgroundCornerRadius} photoSide={avatarPosition} />
      <GeometryReader frame={{ maxWidth: Infinity, height }}>
        {({ size }) => {
          const cardWidth = size.width || 360
          const photoWidth = Math.max(140, cardWidth * 0.5)
          const photo = (
            <CardPhoto
              person={item.person}
              image={artwork.image}
              filePath={getEventPhotoPath(item.event, item.person)}
              width={photoWidth}
              height={height}
              cornerRadius={cornerRadius}
              clipShape={makePhotoClipShape()}
            />
          )
          const textAlignment: 'leading' | 'trailing' = avatarPosition === 'right' ? 'trailing' : 'leading'
          const textBlock = (
            <ZStack frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
              <CardTextWatermark event={item.event} alignment={textAlignment} dense={item.event.denseWatermarkEnabled ?? true} />
              <VStack
                alignment={textAlignment}
                spacing={8}
                frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: textAlignment as any }}
                padding={{ top: 10, bottom: 10, leading: 12, trailing: 12 }}
              >
              <CardTitleBlock event={item.event} person={item.person} nameFont={23} typeFont={18} alignment={textAlignment} />
              <CardDateLine text={targetDateText} font={15} alignment={textAlignment} />
              <CountdownText event={item.event} nextDate={item.nextDate} daysLeft={item.daysLeft} font={39} suffixFont={14} onToggleCountdownFormat={onToggleCountdownFormat} />
            </VStack>
            </ZStack>
          )
          return (
            <HStack spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: 'leading' as any }} alignment="center">
              {avatarPosition === 'left' ? photo : null}
              {textBlock}
              {avatarPosition === 'right' ? photo : null}
            </HStack>
          )
        }}
      </GeometryReader>
    </ZStack>
  )
}

interface AnniversaryLargeWidgetCardProps {
  items: OccurrenceInfo[]
  onSelected?: (event: AnniversaryEvent) => void
  onDelete?: (event: AnniversaryEvent) => void
  onTogglePin?: (event: AnniversaryEvent) => void
  onToggleCountdownFormat?: (event: AnniversaryEvent) => void
}

function LargeWidgetPart({
  item,
  variant,
  onSelected,
  onToggleCountdownFormat
}: {
  item: OccurrenceInfo
  variant: 'largeTop' | 'largeBottom'
  onSelected?: (event: AnniversaryEvent) => void
  onToggleCountdownFormat?: (event: AnniversaryEvent) => void
}) {
  const artwork = useCardArtwork(item.event, item.person)
  const targetDateText = buildTargetDateText(item.event, item.nextDate, item.daysLeft)
  const avatarPosition: AnniversaryAvatarPosition = item.event.avatarPosition ?? 'left'

  return (
    <VStack frame={{ maxWidth: Infinity, alignment: 'leading' as any }} onTapGesture={() => onSelected?.(item.event)}>
      <MediumWidgetCardContent
        item={item}
        artwork={artwork}
        targetDateText={targetDateText}
        cornerRadius={24}
        avatarPosition={avatarPosition}
        onToggleCountdownFormat={() => onToggleCountdownFormat?.(item.event)}
        variant={variant}
      />
    </VStack>
  )
}

function AnniversaryLargeWidgetCardBody({ items, firstItem, onSelected, onDelete, onTogglePin, onToggleCountdownFormat }: AnniversaryLargeWidgetCardProps & { firstItem: OccurrenceInfo }) {
  const pinTitle = firstItem?.event.isPinned ? '取消置顶' : '置顶'

  return (
    <VStack
      listRowBackground={<EmptyView />}
      listRowInsets={{ top: 6, bottom: 6, leading: 0, trailing: 0 }}
      trailingSwipeActions={firstItem ? {
        allowsFullSwipe: false,
        actions: [
          <SwipeActionButton key="置顶" icon={firstItem.event.isPinned ? 'pin.slash' : 'pin.fill'} label={pinTitle} color="#FF9500" action={() => onTogglePin?.(firstItem.event)} />,
          <SwipeActionButton key="删除" icon="trash.fill" label="删除" color="systemRed" action={() => onDelete?.(firstItem.event)} />
        ]
      } : undefined}
    >
      <ZStack frame={{ maxWidth: Infinity, height: 380 }} clipShape={{ type: 'rect', cornerRadius: 24, style: 'continuous' as const }}>
        <VStack spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
          {items.slice(0, 2).map((item, index) => (
            <LargeWidgetPart
              key={item.event.id}
              item={item}
              variant={index === 0 ? 'largeTop' : 'largeBottom'}
              onSelected={onSelected}
              onToggleCountdownFormat={onToggleCountdownFormat}
            />
          ))}
        </VStack>
      </ZStack>
    </VStack>
  )
}

export function AnniversaryLargeWidgetCard(props: AnniversaryLargeWidgetCardProps) {
  const firstItem = props.items[0]
  if (!firstItem) return <EmptyView />
  return <AnniversaryLargeWidgetCardBody {...props} firstItem={firstItem} />
}

export function AnniversaryWidgetCard({ item, size, onSelected, onDelete, onTogglePin, onToggleCountdownFormat }: AnniversaryWidgetCardProps) {
  const pinTitle = item.event.isPinned ? '取消置顶' : '置顶'

  return (
    <Button
      action={onSelected ?? (() => {})}
      buttonStyle="plain"
      listRowBackground={<EmptyView />}
      listRowInsets={{ top: 6, bottom: 6, leading: 0, trailing: 0 }}
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [
          <SwipeActionButton key="置顶" icon={item.event.isPinned ? 'pin.slash' : 'pin.fill'} label={pinTitle} color="#FF9500" action={onTogglePin ?? (() => {})} />,
          <SwipeActionButton key="删除" icon="trash.fill" label="删除" color="systemRed" action={onDelete ?? (() => {})} />
        ]
      }}
    >
      <WidgetCardContent
        item={item}
        size={size}
        onToggleCountdownFormat={onToggleCountdownFormat}
      />
    </Button>
  )
}

interface CompactEventRowProps {
  event: AnniversaryEvent
  onSelected?: () => void
}

interface EventIconProps {
  type: AnniversaryEvent['type']
  size?: number
}

function EventIcon({ type, size = 40 }: EventIconProps) {
  const { icon, color } = EVENT_TYPE_ICONS[type] ?? EVENT_TYPE_ICONS.custom
  const iconColor = color as Color
  const backgroundColor = colorWithAlpha(color, 0.13)
  return (
    <VStack
      frame={{ width: size, height: size }}
      alignment="center"
      background={backgroundColor}
      clipShape="circle"
    >
      <Image systemName={icon} font={26} foregroundStyle={iconColor} />
    </VStack>
  )
}

export function CompactEventRow({ event, onSelected }: CompactEventRowProps) {
  const nextDate = getNextOccurrence(event)
  const dateText = event.isLunar && event.lunarMonth && event.lunarDay
    ? formatLunar(event.lunarMonth, event.lunarDay, event.isLeapMonth)
    : (nextDate ? formatDateCN(nextDate) : '')
  const displayTitle = event.type === 'custom'
    ? (event.title || '其他')
    : (EVENT_TYPE_LABELS[event.type] || '时光纪念')
  return (
    <Button action={onSelected ?? (() => {})}>
      <HStack spacing={14} padding={{ vertical: 8, horizontal: 12 }} frame={{ maxWidth: Infinity }} alignment="center">
        <EventIcon type={event.type} size={50} />
        <VStack alignment="leading" spacing={4}>
          <Text fontWeight="semibold" font={17}>{displayTitle}</Text>
          <Text foregroundStyle="secondaryLabel" font={14}>{dateText}</Text>
        </VStack>
        <Spacer />
        <Image systemName="chevron.right" font={14} foregroundStyle="tertiaryLabel" />
      </HStack>
    </Button>
  )
}
