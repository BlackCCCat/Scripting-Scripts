import {
  HStack,
  Image,
  Script,
  Spacer,
  Text,
  VStack,
  Widget,
} from "scripting"
import { fetchOilPrices, matchProvince } from "./src/service"
import {
  getLastAutoProvinceName,
  getLocationMode,
  getManualProvinceName,
  getPreferredFuel,
  setLastAutoProvinceName,
} from "./src/settings"
import { FUELS, FuelCode, OilPriceData, ProvincePrice, fuelMeta } from "./src/types"

type WidgetData = {
  data: OilPriceData
  province: ProvincePrice
  preferred: FuelCode
}

type WidgetScale = {
  value: number
}

const LIGHT_WIDGET_BG = "#F08A24"
const DARK_WIDGET_BG = "#151518"
const TEXT_PRIMARY = "white"
const TEXT_SECONDARY = "rgba(255,255,255,0.72)"
const TEXT_MUTED = "rgba(255,255,255,0.58)"
const CHIP_BG = "rgba(255,255,255,0.17)"

function nextDailyReloadPolicy() {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(0, 15, 0, 0)
  return { policy: "after" as const, date: next }
}

async function resolveWidgetData(): Promise<WidgetData> {
  const data = await fetchOilPrices()
  const preferred = getPreferredFuel()
  const mode = getLocationMode()
  const manualProvinceName = getManualProvinceName()

  if (mode === "manual") {
    const province =
      matchProvince(data.provinces, manualProvinceName) ?? data.provinces[0]
    return { data, province, preferred }
  }

  const locatedProvinceName = await locateProvinceName()
  const locatedProvince = matchProvince(data.provinces, locatedProvinceName)
  if (locatedProvince) {
    setLastAutoProvinceName(locatedProvince.province)
    return { data, province: locatedProvince, preferred }
  }

  const cachedProvince = matchProvince(
    data.provinces,
    getLastAutoProvinceName()
  )
  const province = cachedProvince ?? data.provinces[0]

  return { data, province, preferred }
}

async function locateProvinceName(): Promise<string | null> {
  try {
    if (!Location.isAuthorizedForWidgetUpdates) {
      return null
    }
    const loc =
      (await Location.requestCurrent({ forceRequest: true }).catch(
        () => null
      )) ?? (await Location.requestCurrent().catch(() => null))
    if (!loc) {
      return null
    }
    const placemarks = await Location.reverseGeocode({
      latitude: loc.latitude,
      longitude: loc.longitude,
      locale: "zh-CN",
    })
    return placemarks?.[0]?.administrativeArea ?? null
  } catch {
    return null
  }
}

function WidgetRoot({ resolved }: { resolved: WidgetData }) {
  const transparent = Widget.isTransparentBackground
  const size = Widget.displaySize

  if (Widget.family === "systemMedium") {
    return (
      <MediumOilWidget
        resolved={resolved}
        transparent={transparent}
        scale={widgetScale(329, 155)}
      />
    )
  }
  if (Widget.family === "systemLarge" || Widget.family === "systemExtraLarge") {
    return (
      <LargeOilWidget
        resolved={resolved}
        transparent={transparent}
        scale={widgetScale(329, Math.max(300, size.height))}
      />
    )
  }
  return (
    <SmallOilWidget
      resolved={resolved}
      transparent={transparent}
      scale={widgetScale(158, 158)}
    />
  )
}

function widgetScale(baseWidth: number, baseHeight: number): WidgetScale {
  const width = Widget.displaySize.width
  const height = Widget.displaySize.height
  const value = Math.min(width / baseWidth, height / baseHeight, 1)
  return { value: Math.max(0.72, value) }
}

function s(scale: WidgetScale, value: number): number {
  return Math.round(value * scale.value)
}

function Shell({
  children,
  padding,
  transparent,
  radius,
}: {
  children: any
  padding: { horizontal: number; vertical: number }
  transparent: boolean
  radius: number
}) {
  return (
    <VStack
      spacing={0}
      contentMargins={0}
      containerShape={{ type: "rect", cornerRadius: radius, style: "continuous" }}
      clipShape={{ type: "rect", cornerRadius: radius, style: "continuous" }}
      frame={{
        width: Widget.displaySize.width,
        height: Widget.displaySize.height,
      }}
      widgetBackground={
        transparent
          ? undefined
          : {
              style: { light: LIGHT_WIDGET_BG, dark: DARK_WIDGET_BG },
              shape: { type: "rect", cornerRadius: radius, style: "continuous" },
            }
      }
    >
      <VStack
        spacing={0}
        padding={padding}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        {children}
      </VStack>
    </VStack>
  )
}

function TopLine({
  province,
  date,
  compact,
  scale,
}: {
  province: string
  date: string
  compact?: boolean
  scale: WidgetScale
}) {
  return (
    <HStack frame={{ maxWidth: "infinity" }}>
      <Image
        systemName="location.fill"
        font={compact ? s(scale, 11) : s(scale, 15)}
        foregroundStyle={TEXT_PRIMARY}
      />
      <Text
        font={compact ? s(scale, 13) : s(scale, 19)}
        fontWeight="bold"
        foregroundStyle={TEXT_PRIMARY}
        lineLimit={1}
      >
        {province}
      </Text>
      <Spacer />
      <Text
        font={compact ? s(scale, 10) : s(scale, 14)}
        foregroundStyle={TEXT_SECONDARY}
        lineLimit={1}
      >
        {compact ? date : `更新于: ${date}`}
      </Text>
    </HStack>
  )
}

function PriceLine({
  code,
  price,
  mode,
  scale,
}: {
  code: FuelCode
  price: number
  mode: "large" | "medium" | "small"
  scale: WidgetScale
}) {
  const meta = fuelMeta(code)
  if (mode === "medium") {
    return (
      <HStack
        alignment="firstTextBaseline"
        spacing={s(scale, 5)}
        frame={{ maxWidth: "infinity", alignment: "center" as any }}
      >
        <Text
          font={s(scale, 15)}
          foregroundStyle={TEXT_SECONDARY}
          lineLimit={1}
        >
          {meta.fullName}
        </Text>
        <Text
          font={s(scale, 21)}
          fontWeight="bold"
          foregroundStyle={TEXT_PRIMARY}
        >
          ¥
        </Text>
        <Text
          font={s(scale, 36)}
          fontWeight="bold"
          foregroundStyle={TEXT_PRIMARY}
          monospacedDigit
        >
          {price.toFixed(2)}
        </Text>
        <Text
          font={s(scale, 13)}
          foregroundStyle={TEXT_SECONDARY}
        >
          元/升
        </Text>
      </HStack>
    )
  }

  if (mode === "large") {
    return (
      <VStack
        spacing={s(scale, 6)}
        frame={{ maxWidth: "infinity", alignment: "center" as any }}
      >
        <Text
          font={s(scale, 23)}
          foregroundStyle={TEXT_SECONDARY}
          lineLimit={1}
        >
          {meta.fullName}(元/升)
        </Text>
        <HStack alignment="firstTextBaseline" spacing={0}>
          <Text
            font={s(scale, 44)}
            fontWeight="bold"
            foregroundStyle={TEXT_PRIMARY}
          >
            ¥
          </Text>
          <Text
            font={s(scale, 86)}
            fontWeight="bold"
            foregroundStyle={TEXT_PRIMARY}
            monospacedDigit
          >
            {price.toFixed(2)}
          </Text>
        </HStack>
      </VStack>
    )
  }

  return (
    <VStack spacing={mode === "small" ? s(scale, 1) : s(scale, 4)}>
      <Text
        font={s(scale, 14)}
        foregroundStyle={TEXT_SECONDARY}
        lineLimit={1}
      >
        {mode === "small" ? meta.fullName : `${meta.fullName}(元/升)`}
      </Text>
      <HStack alignment="firstTextBaseline" spacing={0}>
        <Text
          font={s(scale, 22)}
          fontWeight="bold"
          foregroundStyle={TEXT_PRIMARY}
        >
          ¥
        </Text>
        <Text
          font={s(scale, 38)}
          fontWeight="bold"
          foregroundStyle={TEXT_PRIMARY}
          monospacedDigit
        >
          {price.toFixed(2)}
        </Text>
      </HStack>
    </VStack>
  )
}

function FuelChip({
  code,
  price,
  transparent,
  compact,
  inline,
  scale,
}: {
  code: FuelCode
  price: number
  transparent: boolean
  compact?: boolean
  inline?: boolean
  scale: WidgetScale
}) {
  const meta = fuelMeta(code)
  const content = inline ? (
    <HStack
      spacing={s(scale, 3)}
      frame={{ maxWidth: "infinity", alignment: "center" as any }}
    >
      <Text
        font={s(scale, 11)}
        foregroundStyle={TEXT_SECONDARY}
        lineLimit={1}
      >
        {meta.label}
      </Text>
      <Text
        font={s(scale, 14)}
        fontWeight="bold"
        foregroundStyle={TEXT_PRIMARY}
        lineLimit={1}
        monospacedDigit
      >
        ¥{price.toFixed(2)}
      </Text>
    </HStack>
  ) : (
    <VStack spacing={compact ? 0 : s(scale, 4)}>
      <Text
        font={compact ? s(scale, 10) : s(scale, 16)}
        foregroundStyle={TEXT_SECONDARY}
        lineLimit={1}
      >
        {meta.label}
      </Text>
      <Text
        font={compact ? s(scale, 12) : s(scale, 24)}
        fontWeight="bold"
        foregroundStyle={TEXT_PRIMARY}
        lineLimit={1}
        monospacedDigit
      >
        ¥{price.toFixed(2)}
      </Text>
    </VStack>
  )

  return (
    <VStack
      frame={{
        maxWidth: "infinity",
        height: inline ? s(scale, 34) : compact ? s(scale, 32) : s(scale, 66),
      }}
      padding={{
        horizontal: inline ? s(scale, 3) : compact ? s(scale, 2) : s(scale, 6),
        vertical: inline ? s(scale, 7) : compact ? s(scale, 4) : s(scale, 10),
      }}
      widgetBackground={
        transparent
          ? undefined
          : {
              style: CHIP_BG,
              shape: {
                type: "rect",
                cornerRadius: compact ? s(scale, 8) : s(scale, 12),
                style: "continuous",
              },
            }
      }
    >
      {content}
    </VStack>
  )
}

function OtherFuelChips({
  province,
  preferred,
  transparent,
  compact,
  inline,
  scale,
}: {
  province: ProvincePrice
  preferred: FuelCode
  transparent: boolean
  compact?: boolean
  inline?: boolean
  scale: WidgetScale
}) {
  const others = FUELS.filter(f => f.code !== preferred)
  return (
    <HStack spacing={compact ? s(scale, 4) : s(scale, 8)} frame={{ maxWidth: "infinity" }}>
      {others.map(f => (
        <FuelChip
          code={f.code}
          price={province.prices[f.code]}
          transparent={transparent}
          compact={compact}
          inline={inline}
          scale={scale}
        />
      ))}
    </HStack>
  )
}

function ForecastBlock({
  data,
  size,
  scale,
}: {
  data: OilPriceData
  size: "small" | "medium"
  scale: WidgetScale
}) {
  const forecast = data.forecast
  const primary =
    size === "small"
      ? `下次调价 ${forecast.nextAdjustText} 剩${forecast.remainingDays}天`
      : `下次调价: ${forecast.nextAdjustText} · 剩余 ${forecast.remainingDays} 天`
  const secondary = forecast.perTon
    ? `预计${forecast.direction}${forecast.perTon}元/吨${
        forecast.perLiterRange ? ` · ${forecast.perLiterRange}` : ""
      }`
    : forecast.sourceText

  return (
    <VStack spacing={s(scale, 1)} frame={{ maxWidth: "infinity" }}>
      <HStack spacing={s(scale, 4)} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
        <Text
          font={size === "small" ? s(scale, 8) : s(scale, 12)}
          fontWeight="semibold"
          foregroundStyle={TEXT_SECONDARY}
          lineLimit={1}
          multilineTextAlignment="center"
        >
          {primary}
        </Text>
      </HStack>
      {size === "small" ? null : (
        <Text
          font={s(scale, 10)}
          foregroundStyle={TEXT_MUTED}
          lineLimit={1}
          multilineTextAlignment="center"
          frame={{ maxWidth: "infinity" }}
        >
          {secondary}
        </Text>
      )}
    </VStack>
  )
}

function LargeForecastBlock({
  data,
  scale,
}: {
  data: OilPriceData
  scale: WidgetScale
}) {
  const forecast = data.forecast
  const estimate = forecast.perTon
    ? `预计${forecast.direction}${forecast.perTon}元/吨`
    : forecast.sourceText
  const perLiter = forecast.perLiterRange
    ? `折合每升${forecast.perLiterRange}`
    : ""

  return (
    <VStack spacing={s(scale, 3)} frame={{ maxWidth: "infinity" }}>
      <HStack
        spacing={s(scale, 4)}
        frame={{ maxWidth: "infinity", alignment: "center" as any }}
      >
        <Image
          systemName="calendar.badge.clock"
          font={s(scale, 12)}
          foregroundStyle={TEXT_SECONDARY}
        />
        <Text
          font={s(scale, 13)}
          fontWeight="semibold"
          foregroundStyle={TEXT_SECONDARY}
          lineLimit={1}
          multilineTextAlignment="center"
        >
          下次调价: {forecast.nextAdjustText}
        </Text>
      </HStack>
      <Text
        font={s(scale, 13)}
        fontWeight="semibold"
        foregroundStyle={TEXT_SECONDARY}
        lineLimit={1}
        multilineTextAlignment="center"
        frame={{ maxWidth: "infinity" }}
      >
        剩余 {forecast.remainingDays} 天
      </Text>
      <Text
        font={s(scale, 12)}
        foregroundStyle={TEXT_MUTED}
        lineLimit={1}
        multilineTextAlignment="center"
        frame={{ maxWidth: "infinity" }}
      >
        {estimate}
      </Text>
      {perLiter ? (
        <Text
          font={s(scale, 11)}
          foregroundStyle={TEXT_MUTED}
          lineLimit={1}
          multilineTextAlignment="center"
          frame={{ maxWidth: "infinity" }}
        >
          {perLiter}
        </Text>
      ) : null}
    </VStack>
  )
}

function SmallOilWidget({
  resolved,
  transparent,
  scale,
}: {
  resolved: WidgetData
  transparent: boolean
  scale: WidgetScale
}) {
  const { data, province, preferred } = resolved
  return (
    <Shell
      padding={{ horizontal: s(scale, 10), vertical: s(scale, 9) }}
      transparent={transparent}
      radius={s(scale, 22)}
    >
      <VStack spacing={s(scale, 3)} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <TopLine
        province={province.province}
        date={province.updatedAt}
        compact
        scale={scale}
      />
      <PriceLine
        code={preferred}
        price={province.prices[preferred]}
        mode="small"
        scale={scale}
      />
      <OtherFuelChips
        province={province}
        preferred={preferred}
        transparent={transparent}
        compact
        scale={scale}
      />
      <ForecastBlock data={data} size="small" scale={scale} />
      </VStack>
    </Shell>
  )
}

function MediumOilWidget({
  resolved,
  transparent,
  scale,
}: {
  resolved: WidgetData
  transparent: boolean
  scale: WidgetScale
}) {
  const { data, province, preferred } = resolved
  return (
    <Shell
      padding={{ horizontal: s(scale, 12), vertical: s(scale, 9) }}
      transparent={transparent}
      radius={s(scale, 24)}
    >
      <VStack spacing={s(scale, 5)} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <TopLine province={province.province} date={province.updatedAt} scale={scale} />
      <PriceLine
        code={preferred}
        price={province.prices[preferred]}
        mode="medium"
        scale={scale}
      />
      <OtherFuelChips
        province={province}
        preferred={preferred}
        transparent={transparent}
        inline
        scale={scale}
      />
      <ForecastBlock data={data} size="medium" scale={scale} />
      </VStack>
    </Shell>
  )
}

function LargeOilWidget({
  resolved,
  transparent,
  scale,
}: {
  resolved: WidgetData
  transparent: boolean
  scale: WidgetScale
}) {
  const { data, province, preferred } = resolved
  return (
    <Shell
      padding={{ horizontal: s(scale, 18), vertical: s(scale, 18) }}
      transparent={transparent}
      radius={s(scale, 28)}
    >
      <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <TopLine province={province.province} date={province.updatedAt} scale={scale} />
        <Spacer />
        <PriceLine
          code={preferred}
          price={province.prices[preferred]}
          mode="large"
          scale={scale}
        />
        <Spacer />
        <OtherFuelChips
          province={province}
          preferred={preferred}
          transparent={transparent}
          scale={scale}
        />
        <Spacer />
        <LargeForecastBlock data={data} scale={scale} />
      </VStack>
    </Shell>
  )
}

async function run() {
  try {
    const resolved = await resolveWidgetData()
    Widget.present(<WidgetRoot resolved={resolved} />, {
      reloadPolicy: nextDailyReloadPolicy(),
    })
  } catch (e) {
    Widget.present(
      <Shell
        padding={{ horizontal: 16, vertical: 16 }}
        transparent={Widget.isTransparentBackground}
        radius={24}
      >
        <Text font={16} fontWeight="semibold" foregroundStyle={TEXT_PRIMARY}>
          油价数据加载失败
        </Text>
        <Text font={12} foregroundStyle={TEXT_SECONDARY} padding={{ top: 8 }}>
          {e instanceof Error ? e.message : "请打开脚本手动刷新一次"}
        </Text>
      </Shell>,
      { reloadPolicy: nextDailyReloadPolicy() }
    )
  }
  Script.exit()
}

void run()
