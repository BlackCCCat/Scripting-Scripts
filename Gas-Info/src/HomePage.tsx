import {
  VStack,
  HStack,
  Text,
  Image,
  ScrollView,
  Spacer,
  Button,
  Divider,
  NavigationLink,
  Navigation,
  useState,
  useEffect,
  gradient,
  TextField,
  Widget,
} from "scripting"
import { FUELS, FuelCode, OilPriceData, ProvincePrice, fuelMeta } from "./types"
import { fetchOilPrices, matchProvince, normalizeProvinceName } from "./service"
import { Theme } from "./theme"
import {
  getLocationMode,
  getManualProvinceName,
  LocationMode,
  setLocationMode,
  setManualProvinceName,
} from "./settings"

/** 头部高亮油价卡片 */
function HeaderCard({
  province,
  forecast,
  preferred,
}: {
  province: ProvincePrice
  forecast: OilPriceData["forecast"]
  preferred: FuelCode
}) {
  const meta = fuelMeta(preferred)
  const bigPrice = province.prices[preferred]
  // 头部小卡片展示除高亮油品外的另外 3 个油品
  const others = FUELS.filter(f => f.code !== preferred)

  return (
    <VStack
      spacing={0}
      padding={{ horizontal: 18, top: 18, bottom: 16 }}
      background={gradient("linear", {
        colors: [...Theme.headerGradient],
        startPoint: "topLeading",
        endPoint: "bottomTrailing",
      })}
      clipShape={{ type: "rect", cornerRadius: 22 }}
      frame={{ maxWidth: "infinity" }}
      shadow={{ color: "rgba(240,130,15,0.35)", radius: 12, y: 6 }}
    >
      {/* 顶部：省份 + 更新时间 */}
      <HStack>
        <Image systemName="location.fill" font={15} foregroundStyle="white" />
        <Text font={18} fontWeight="bold" foregroundStyle="white">
          {province.province}
        </Text>
        <Spacer />
        <Text font={12} foregroundStyle="rgba(255,255,255,0.85)">
          更新于: {province.updatedAt}
        </Text>
      </HStack>

      {/* 高亮油品放大显示 */}
      <VStack spacing={2} padding={{ top: 12, bottom: 14 }}>
        <Text font={15} foregroundStyle="rgba(255,255,255,0.92)">
          {meta.fullName}
        </Text>
        <HStack alignment="firstTextBaseline" spacing={0}>
          <Text font={26} fontWeight="bold" foregroundStyle="white">
            ¥
          </Text>
          <Text font={56} fontWeight="bold" foregroundStyle="white">
            {bigPrice.toFixed(2)}
          </Text>
          <Text
            font={16}
            foregroundStyle="rgba(255,255,255,0.85)"
            padding={{ leading: 4, bottom: 4 }}
          >
            元/升
          </Text>
        </HStack>
      </VStack>

      {/* 其它 3 个油品的小卡片 */}
      <HStack spacing={10}>
        {others.map(f => (
          <VStack
            spacing={3}
            frame={{ maxWidth: "infinity" }}
            padding={{ vertical: 10 }}
            background={Theme.headerChipBg}
            clipShape={{ type: "rect", cornerRadius: 12 }}
          >
            <Text font={12} foregroundStyle="rgba(255,255,255,0.85)">
              {f.label}
            </Text>
            <Text font={16} fontWeight="bold" foregroundStyle="white">
              ¥{province.prices[f.code].toFixed(2)}
            </Text>
          </VStack>
        ))}
      </HStack>

      {/* 调价预测 */}
      <VStack
        spacing={4}
        padding={{ top: 14 }}
        frame={{ maxWidth: "infinity" }}
      >
        <HStack
          spacing={6}
          frame={{ maxWidth: "infinity", alignment: "center" as any }}
        >
          <Image
            systemName="calendar"
            font={13}
            foregroundStyle="rgba(255,255,255,0.9)"
          />
          <Text font={13} fontWeight="medium" foregroundStyle="white">
            下次调价: {forecast.nextAdjustText} · 剩余 {forecast.remainingDays} 天
          </Text>
          <Image
            systemName="chevron.right"
            font={11}
            foregroundStyle="rgba(255,255,255,0.8)"
          />
        </HStack>
        <Text
          font={12}
          foregroundStyle="rgba(255,255,255,0.85)"
          multilineTextAlignment="center"
          frame={{ maxWidth: "infinity" }}
        >
          {forecast.sourceText}
        </Text>
      </VStack>
    </VStack>
  )
}

/** 全国油价列表中的单个省份卡片 */
function ProvinceRow({ item }: { item: ProvincePrice }) {
  return (
    <VStack
      spacing={10}
      padding={14}
      background={Theme.cardBg}
      clipShape={{ type: "rect", cornerRadius: 14 }}
    >
      <HStack>
        <Text font={17} fontWeight="semibold">
          {item.province}
        </Text>
        <Spacer />
        <Image
          systemName="arrow.up.right.square"
          font={18}
          foregroundStyle={Theme.orange}
        />
      </HStack>
      <HStack spacing={6}>
        {FUELS.map(f => (
          <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
            <Text font={12} foregroundStyle={Theme.secondary}>
              {f.label}
            </Text>
            <Text font={16} fontWeight="semibold" foregroundStyle={Theme.priceOrange}>
              {item.prices[f.code].toFixed(2)}
            </Text>
          </VStack>
        ))}
      </HStack>
    </VStack>
  )
}

function DetailRow({ code, price }: { code: FuelCode; price: number }) {
  const meta = fuelMeta(code)

  return (
    <VStack spacing={0}>
      <HStack padding={{ horizontal: 12, vertical: 14 }}>
        <Image
          systemName="fuelpump"
          font={22}
          foregroundStyle={Theme.orange}
          frame={{ width: 30 }}
        />
        <Text font={20} fontWeight="medium">
          {meta.fullName}
        </Text>
        <Spacer />
        <Text font={22} fontWeight="bold" foregroundStyle={Theme.priceOrange}>
          ¥{price.toFixed(2)}
        </Text>
        <Text font={14} foregroundStyle={Theme.secondary} padding={{ leading: 4 }}>
          元/升
        </Text>
      </HStack>
      <Divider padding={{ leading: 52 }} />
    </VStack>
  )
}

function ProvinceDetailPage({
  province,
  forecast,
  preferred,
  source,
}: {
  province: ProvincePrice
  forecast: OilPriceData["forecast"]
  preferred: FuelCode
  source: string
}) {
  return (
    <ScrollView>
      <VStack
        navigationTitle={province.province}
        navigationBarTitleDisplayMode="inline"
        spacing={18}
        padding={{ horizontal: 16, top: 12, bottom: 28 }}
        alignment="leading"
      >
        <HeaderCard
          province={province}
          forecast={forecast}
          preferred={preferred}
        />

        <HStack frame={{ maxWidth: "infinity" }}>
          <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Text font={18} fontWeight="bold" foregroundStyle={Theme.orange}>
              油价详情
            </Text>
            <HStack frame={{ height: 2, maxWidth: "infinity" }} background={Theme.orange} />
          </VStack>
        </HStack>

        <VStack
          spacing={0}
          background={Theme.cardBg}
          clipShape={{ type: "rect", cornerRadius: 14 }}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          {FUELS.map(f => (
            <DetailRow code={f.code} price={province.prices[f.code]} />
          ))}
        </VStack>

        <VStack
          alignment="leading"
          spacing={8}
          padding={16}
          background={Theme.cardBg}
          clipShape={{ type: "rect", cornerRadius: 14 }}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Image systemName="info.circle" font={16} foregroundStyle={Theme.orange} />
            <Text font={17} fontWeight="semibold">
              说明
            </Text>
          </HStack>
          <Text
            font={14}
            foregroundStyle={Theme.secondary}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            · 油价数据来源于 {source}
          </Text>
          <Text
            font={14}
            foregroundStyle={Theme.secondary}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            · 实际价格以加油站公示价格为准
          </Text>
          <Text
            font={14}
            foregroundStyle={Theme.secondary}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            · 当前数据源未提供历史趋势数据
          </Text>
        </VStack>
      </VStack>
    </ScrollView>
  )
}

function ProvinceSelectorPage({
  provinces,
  autoProvince,
  autoLocatedName,
  selectedProvince,
  mode,
  onUseAuto,
  onSelectManual,
}: {
  provinces: ProvincePrice[]
  autoProvince: ProvincePrice
  autoLocatedName: string | null
  selectedProvince: ProvincePrice
  mode: LocationMode
  onUseAuto: () => void
  onSelectManual: (province: ProvincePrice) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [query, setQuery] = useState("")
  const keyword = normalizeProvinceName(query)
  const filtered = keyword
    ? provinces.filter(p =>
        normalizeProvinceName(p.province).includes(keyword)
      )
    : provinces

  function chooseAuto() {
    onUseAuto()
    dismiss()
  }

  function chooseManual(province: ProvincePrice) {
    onSelectManual(province)
    dismiss()
  }

  return (
    <ScrollView>
      <VStack
        navigationTitle="选择地区"
        navigationBarTitleDisplayMode="inline"
        spacing={14}
        padding={{ horizontal: 16, top: 14, bottom: 28 }}
        alignment="leading"
      >
        <TextField
          title=""
          value={query}
          onChanged={setQuery}
          prompt="输入省份名称搜索，如：湖北"
          textFieldStyle="roundedBorder"
        />

        <Button action={chooseAuto}>
          <VStack
            padding={mode === "auto" ? 2 : 0}
            background={mode === "auto" ? Theme.orange : Theme.pageBg}
            clipShape={{ type: "rect", cornerRadius: 14 }}
            frame={{ maxWidth: "infinity" }}
          >
            <HStack
              spacing={14}
              padding={{ horizontal: 16, vertical: 14 }}
              background={Theme.pageBg}
              clipShape={{ type: "rect", cornerRadius: 12 }}
              frame={{ maxWidth: "infinity" }}
            >
              <Image
                systemName="location.fill"
                font={28}
                foregroundStyle={Theme.orange}
              />
              <VStack alignment="leading" spacing={4}>
                <Text font={18} fontWeight="bold">
                  自动定位
                </Text>
                <Text font={14} foregroundStyle={Theme.secondary}>
                  {autoLocatedName ?? autoProvince.province}
                </Text>
              </VStack>
              <Spacer />
              {mode === "auto" ? (
                <Image
                  systemName="checkmark"
                  font={20}
                  fontWeight="semibold"
                  foregroundStyle={Theme.orange}
                />
              ) : null}
            </HStack>
          </VStack>
        </Button>

        <VStack spacing={10} frame={{ maxWidth: "infinity" }}>
          {filtered.map(p => {
            const selected =
              mode === "manual" && p.province === selectedProvince.province
            return (
              <Button action={() => chooseManual(p)}>
                <HStack
                  padding={{ horizontal: 16, vertical: 16 }}
                  background={Theme.cardBg}
                  clipShape={{ type: "rect", cornerRadius: 12 }}
                  frame={{ maxWidth: "infinity" }}
                >
                  <Text font={18}>{p.province}</Text>
                  <Spacer />
                  {selected ? (
                    <Image
                      systemName="checkmark"
                      font={16}
                      fontWeight="semibold"
                      foregroundStyle={Theme.orange}
                    />
                  ) : null}
                </HStack>
              </Button>
            )
          })}
        </VStack>
      </VStack>
    </ScrollView>
  )
}

export function HomePage({ preferred }: { preferred: FuelCode }) {
  const [data, setData] = useState<OilPriceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoProvince, setAutoProvince] = useState<ProvincePrice | null>(null)
  const [locatedName, setLocatedName] = useState<string | null>(null)
  const [locationModeState, setLocationModeState] =
    useState<LocationMode>(getLocationMode())
  const [manualProvinceName, setManualProvinceNameState] = useState<
    string | null
  >(getManualProvinceName())

  async function load(forceRefresh = false) {
    if (forceRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const result = await fetchOilPrices({ forceRefresh })
      setData(result)
      if (forceRefresh) {
        Widget.reloadAll()
      }

      // 定位当前省份
      let provinceName: string | null = null
      try {
        const loc = await Location.requestCurrent()
        if (loc) {
          const placemarks = await Location.reverseGeocode({
            latitude: loc.latitude,
            longitude: loc.longitude,
            locale: "zh-CN",
          })
          provinceName = placemarks?.[0]?.administrativeArea ?? null
        }
      } catch {
        // 定位失败，忽略，使用默认省份
      }

      const matched =
        matchProvince(result.provinces, provinceName) ?? result.provinces[0]
      setAutoProvince(matched)
      setLocatedName(provinceName ?? matched.province)
    } catch (e) {
      setError(e instanceof Error ? e.message : "油价数据加载失败")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const manualProvince = data
    ? matchProvince(data.provinces, manualProvinceName)
    : null
  const headerProvince =
    locationModeState === "manual"
      ? manualProvince ?? autoProvince ?? data?.provinces[0] ?? null
      : autoProvince ?? data?.provinces[0] ?? null
  const others = data
    ? data.provinces.filter(p => p.province !== headerProvince?.province)
    : []
  const selectorDestination =
    data && headerProvince ? (
      <ProvinceSelectorPage
        provinces={data.provinces}
        autoProvince={autoProvince ?? data.provinces[0]}
        autoLocatedName={locatedName}
        selectedProvince={headerProvince}
        mode={locationModeState}
        onUseAuto={() => {
          setLocationMode("auto")
          setLocationModeState("auto")
          Widget.reloadAll()
        }}
        onSelectManual={province => {
          setLocationMode("manual")
          setManualProvinceName(province.province)
          setLocationModeState("manual")
          setManualProvinceNameState(province.province)
          Widget.reloadAll()
        }}
      />
    ) : null

  return (
    <ScrollView
      toolbar={{
        ...(selectorDestination && headerProvince
          ? {
              topBarLeading: (
                <NavigationLink destination={selectorDestination}>
                  <HStack spacing={4}>
                    <Image
                      systemName={
                        locationModeState === "auto"
                          ? "location.fill"
                          : "mappin.circle.fill"
                      }
                      font={13}
                      foregroundStyle={Theme.orange}
                    />
                    <Text font={14} fontWeight="semibold" foregroundStyle={Theme.orange}>
                      {headerProvince.province}
                    </Text>
                    <Image
                      systemName="chevron.down"
                      font={10}
                      foregroundStyle={Theme.orange}
                    />
                  </HStack>
                </NavigationLink>
              ),
            }
          : {}),
        topBarTrailing: (
          <Button
            title=""
            systemImage="arrow.clockwise"
            action={() => load(true)}
            disabled={refreshing}
          />
        ),
      }}
    >
      <VStack
        spacing={16}
        padding={{ horizontal: 16, top: 8, bottom: 24 }}
        alignment="leading"
      >
        {loading && !data ? (
          <HStack frame={{ maxWidth: "infinity", minHeight: 200 }}>
            <Spacer />
            <VStack spacing={10}>
              <Image
                systemName="fuelpump.fill"
                font={32}
                foregroundStyle={Theme.orange}
              />
              <Text foregroundStyle={Theme.secondary}>加载中…</Text>
            </VStack>
            <Spacer />
          </HStack>
        ) : error ? (
          <VStack
            spacing={12}
            padding={{ vertical: 40 }}
            frame={{ maxWidth: "infinity" }}
          >
            <Image
              systemName="exclamationmark.triangle"
              font={30}
              foregroundStyle={Theme.orange}
            />
            <Text foregroundStyle={Theme.secondary}>{error}</Text>
            <Button title="重新加载" action={() => load()} />
          </VStack>
        ) : data && headerProvince ? (
          <>
            <NavigationLink
              destination={
                <ProvinceDetailPage
                  province={headerProvince}
                  forecast={data.forecast}
                  preferred={preferred}
                  source={data.source}
                />
              }
            >
              <HeaderCard
                province={headerProvince}
                forecast={data.forecast}
                preferred={preferred}
              />
            </NavigationLink>

            <Text font={20} fontWeight="bold" padding={{ top: 4 }}>
              全国油价
            </Text>

            <VStack spacing={12} alignment="leading">
              {others.map(p => (
                <NavigationLink
                  destination={
                    <ProvinceDetailPage
                      province={p}
                      forecast={data.forecast}
                      preferred={preferred}
                      source={data.source}
                    />
                  }
                >
                  <ProvinceRow item={p} />
                </NavigationLink>
              ))}
            </VStack>
          </>
        ) : (
          <Text foregroundStyle={Theme.secondary}>暂无数据</Text>
        )}
      </VStack>
    </ScrollView>
  )
}
