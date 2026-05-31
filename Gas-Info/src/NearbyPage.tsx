import {
  VStack,
  HStack,
  Text,
  Image,
  ScrollView,
  Spacer,
  Button,
  ZStack,
  Map,
  Marker,
  MapCompass,
  useState,
  useEffect,
  useObservable,
  MapCoordinate,
  MapRegion,
} from "scripting"
import { Theme } from "./theme"

/** 一个加油站条目（携带预计算好的距离，单位米） */
interface StationEntry {
  item: MapItem
  meters: number
  index: number
  address: string
}

/** 单个加油站卡片 */
function StationRow({
  entry,
  onNavigate,
}: {
  entry: StationEntry
  onNavigate: (entry: StationEntry) => void
}) {
  const { meters } = entry
  return (
    <Button action={() => onNavigate(entry)}>
      <HStack
        spacing={12}
        padding={14}
        background={Theme.cardBg}
        clipShape={{ type: "rect", cornerRadius: 14 }}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      >
        <ZStackIcon index={entry.index} />
        <VStack
          alignment="leading"
          spacing={4}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          <Text
            font={15}
            fontWeight="medium"
            foregroundStyle="label"
            lineLimit={2}
            multilineTextAlignment="leading"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            {entry.address}
          </Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={4}>
          <Text font={15} fontWeight="bold" foregroundStyle={Theme.priceOrange}>
            {MapUtils.formatDistance(meters)}
          </Text>
          <HStack spacing={2}>
            <Image
              systemName="arrow.triangle.turn.up.right.diamond.fill"
              font={11}
              foregroundStyle={Theme.orange}
            />
            <Text font={12} foregroundStyle={Theme.orange}>
              导航
            </Text>
          </HStack>
        </VStack>
      </HStack>
    </Button>
  )
}

/** 加油站图标小圆 */
function ZStackIcon({ index }: { index: number }) {
  return (
    <VStack
      frame={{ width: 38, height: 38 }}
      background={Theme.orange}
      clipShape="circle"
    >
      <Text font={16} fontWeight="bold" foregroundStyle="white">
        {index}
      </Text>
    </VStack>
  )
}

export function NearbyPage({ radiusKm }: { radiusKm: number }) {
  const [stations, setStations] = useState<StationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentCoordinate, setCurrentCoordinate] =
    useState<MapCoordinate | null>(null)

  const camera = useObservable<MapCameraPosition>(MapCameraPosition.automatic())

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const loc = await Location.requestCurrent()
      if (!loc) {
        setError("无法获取当前位置，请在系统设置中允许定位权限。")
        setLoading(false)
        return
      }
      const here: MapCoordinate = {
        latitude: loc.latitude,
        longitude: loc.longitude,
      }
      setCurrentCoordinate(here)

      const region: MapRegion = {
        center: here,
        span: { latitudeDelta: 0.08, longitudeDelta: 0.08 },
      }
      camera.setValue(MapCameraPosition.region(region))

      const results = await MapSearch.locate({
        query: "加油站",
        region,
        resultTypes: ["pointOfInterest"],
        pointOfInterestFilter: { includes: ["gasStation"] },
      })

      const entries = results
        .map(item => buildStationEntry(item, here, 0))
        .sort((a, b) => a.meters - b.meters)

      // 优先展示设定半径内的油站；若半径内一个都没有，则退回显示最近的若干个
      const withinRadius = entries.filter(e => e.meters <= radiusKm * 1000)
      const finalList = withinRadius.length > 0 ? withinRadius : entries.slice(0, 10)

      const localized = await localizeStationEntries(
        finalList.map((entry, index) => ({ ...entry, index: index + 1 }))
      )
      setStations(localized)
      if (finalList.length === 0) {
        setError("附近未找到加油站。")
      }
    } catch (e) {
      setError("搜索附近加油站失败，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [radiusKm])

  async function localizeStationEntries(
    entries: StationEntry[]
  ): Promise<StationEntry[]> {
    return Promise.all(entries.map(localizeStationEntry))
  }

  async function localizeStationEntry(entry: StationEntry): Promise<StationEntry> {
    try {
      const placemarks = await Location.reverseGeocode({
        latitude: entry.item.coordinate.latitude,
        longitude: entry.item.coordinate.longitude,
        locale: "zh-CN",
      })
      const placemark = placemarks?.[0]
      if (!placemark) {
        return entry
      }

      return {
        ...entry,
        address: formatDisplayAddress(placemark, entry.item.coordinate),
      }
    } catch {
      return entry
    }
  }

  async function recenterToCurrentLocation() {
    const loc = await Location.requestCurrent()
    if (!loc) {
      return
    }
    const here: MapCoordinate = {
      latitude: loc.latitude,
      longitude: loc.longitude,
    }
    setCurrentCoordinate(here)
    camera.setValue(
      MapCameraPosition.region({
        center: here,
        span: { latitudeDelta: 0.08, longitudeDelta: 0.08 },
      })
    )
  }

  async function navigateTo(entry: StationEntry) {
    const item = entry.item
    const idx = await Dialog.actionSheet({
      title: entry.address,
      actions: [
        { label: "Apple 地图导航" },
        { label: "高德地图导航" },
        { label: "百度地图导航" },
        { label: "谷歌地图导航" },
      ],
    })
    if (idx == null) {
      return
    }

    if (idx === 0) {
      await Safari.openURL(appleNavigationURL(item.coordinate))
      return
    }

    const name = entry.address
    const coordinate = item.coordinate
    if (idx === 1) {
      await openExternalURL(
        amapNavigationURL(coordinate, name),
        amapWebNavigationURL(coordinate, name)
      )
    } else if (idx === 2) {
      await openExternalURL(
        baiduNavigationURL(coordinate, name),
        baiduWebNavigationURL(coordinate, name)
      )
    } else if (idx === 3) {
      await openExternalURL(
        googleNavigationURL(coordinate),
        googleWebNavigationURL(coordinate)
      )
    }
  }

  return (
    <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 地图区域 */}
      <ZStack frame={{ height: 300 }}>
        <Map
          cameraPosition={camera}
          frame={{ height: 300 }}
          controls={<MapCompass />}
        >
          {currentCoordinate ? (
            <Marker
              coordinate={currentCoordinate}
              title="当前位置"
              systemImage="location.fill"
              tint="systemBlue"
            />
          ) : null}
          {stations.map((e, index) => (
            <Marker
              coordinate={e.item.coordinate}
              title=""
              monogram={`${index + 1}`}
              tint={Theme.orange}
            />
          ))}
        </Map>
        <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <Spacer />
          <HStack
            frame={{ maxWidth: "infinity" }}
            padding={{ trailing: 14, bottom: 14 }}
          >
            <Spacer />
            <Button action={recenterToCurrentLocation}>
              <Image
                systemName="location.fill"
                font={18}
                foregroundStyle={Theme.orange}
                padding={12}
                background="ultraThinMaterial"
                clipShape="circle"
                shadow={{ color: "rgba(0,0,0,0.18)", radius: 8, y: 3 }}
              />
            </Button>
          </HStack>
        </VStack>
      </ZStack>

      {/* 头部条：数量 + 半径 + 刷新 */}
      <HStack
        padding={{ horizontal: 16, vertical: 12 }}
        background={Theme.pageBg}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      >
        <Image
          systemName="mappin.and.ellipse"
          font={15}
          foregroundStyle={Theme.orange}
        />
        <Text font={16} fontWeight="semibold">
          附近加油站
        </Text>
        <Text font={13} foregroundStyle={Theme.secondary}>
          {radiusKm} 公里内 · {stations.length} 个
        </Text>
        <Spacer />
        <Button action={() => load()}>
          <Image
            systemName="arrow.clockwise"
            font={16}
            foregroundStyle={Theme.orange}
          />
        </Button>
      </HStack>

      {/* 列表区域 */}
      {loading ? (
        <VStack spacing={10} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <Spacer />
          <Image
            systemName="location.magnifyingglass"
            font={30}
            foregroundStyle={Theme.orange}
          />
          <Text foregroundStyle={Theme.secondary}>正在搜索附近加油站…</Text>
          <Spacer />
        </VStack>
      ) : error ? (
        <VStack
          spacing={12}
          padding={24}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        >
          <Spacer />
          <Image
            systemName="exclamationmark.triangle"
            font={30}
            foregroundStyle={Theme.secondary}
          />
          <Text foregroundStyle={Theme.secondary} multilineTextAlignment="center">
            {error}
          </Text>
          <Button action={() => load()}>
            <Text
              font={15}
              fontWeight="semibold"
              foregroundStyle="white"
              padding={{ horizontal: 20, vertical: 10 }}
              background={Theme.orange}
              clipShape={{ type: "rect", cornerRadius: 12 }}
            >
              重试
            </Text>
          </Button>
          <Spacer />
        </VStack>
      ) : (
        <ScrollView>
          <VStack
            spacing={10}
            alignment="leading"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            padding={{ horizontal: 16, top: 4, bottom: 24 }}
          >
            {stations.map(e => (
              <StationRow entry={e} onNavigate={navigateTo} />
            ))}
          </VStack>
        </ScrollView>
      )}
    </VStack>
  )
}

function buildStationEntry(
  item: MapItem,
  from: MapCoordinate,
  index: number
): StationEntry {
  return {
    item,
    meters: item.distance(from),
    index,
    address:
      formatDisplayAddress(item.placemark, item.coordinate),
  }
}

function formatDisplayAddress(
  placemark: LocationPlacemark,
  coordinate: MapCoordinate
): string {
  return (
    formatChinesePlacemarkAddress(placemark) ??
    `${formatCoordinate(coordinate)}附近加油站`
  )
}

function formatChinesePlacemarkAddress(
  placemark: LocationPlacemark
): string | null {
  const parts = [
    placemark.administrativeArea,
    placemark.locality,
    placemark.subLocality,
    placemark.thoroughfare,
    placemark.subThoroughfare,
  ]
    .map(cleanChineseAddressPart)
    .filter((v): v is string => !!v)

  return parts.length ? Array.from(new Set(parts)).join("") : null
}

function cleanChineseAddressPart(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed || !containsChinese(trimmed)) {
    return null
  }
  return trimmed
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function formatCoordinate(coordinate: MapCoordinate): string {
  return `北纬${coordinate.latitude.toFixed(5)}，东经${coordinate.longitude.toFixed(5)}`
}

function appleNavigationURL(coordinate: MapCoordinate): string {
  return `http://maps.apple.com/?daddr=${coordinate.latitude},${coordinate.longitude}&dirflg=d`
}

function amapNavigationURL(coordinate: MapCoordinate, name: string): string {
  const gcj = wgs84ToGcj02(coordinate)
  return `iosamap://path?sourceApplication=${encodeURIComponent(
    "今日油价"
  )}&dlat=${gcj.latitude}&dlon=${gcj.longitude}&dname=${encodeURIComponent(
    name
  )}&dev=0&t=0`
}

function amapWebNavigationURL(coordinate: MapCoordinate, name: string): string {
  const gcj = wgs84ToGcj02(coordinate)
  return `https://uri.amap.com/navigation?to=${gcj.longitude},${gcj.latitude},${encodeURIComponent(
    name
  )}&mode=car&policy=1&src=${encodeURIComponent("今日油价")}&coordinate=gaode&callnative=1`
}

function baiduNavigationURL(coordinate: MapCoordinate, name: string): string {
  const gcj = wgs84ToGcj02(coordinate)
  return `baidumap://map/direction?destination=name:${encodeURIComponent(
    name
  )}|latlng:${gcj.latitude},${gcj.longitude}&mode=driving&coord_type=gcj02`
}

function baiduWebNavigationURL(coordinate: MapCoordinate, name: string): string {
  const gcj = wgs84ToGcj02(coordinate)
  return `https://api.map.baidu.com/direction?destination=name:${encodeURIComponent(
    name
  )}|latlng:${gcj.latitude},${gcj.longitude}&mode=driving&coord_type=gcj02&output=html&src=${encodeURIComponent(
    "今日油价"
  )}`
}

function googleNavigationURL(coordinate: MapCoordinate): string {
  return `comgooglemaps://?daddr=${coordinate.latitude},${coordinate.longitude}&directionsmode=driving`
}

function googleWebNavigationURL(coordinate: MapCoordinate): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coordinate.latitude},${coordinate.longitude}&travelmode=driving`
}

async function openExternalURL(url: string, fallbackURL: string) {
  const opened = await Safari.openURL(url)
  if (!opened) {
    await Safari.openURL(fallbackURL)
  }
}

function wgs84ToGcj02(coordinate: MapCoordinate): MapCoordinate {
  const lat = coordinate.latitude
  const lon = coordinate.longitude

  if (outOfChina(lat, lon)) {
    return coordinate
  }

  let dLat = transformLat(lon - 105.0, lat - 35.0)
  let dLon = transformLon(lon - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - 0.00669342162296594323 * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat =
    (dLat * 180.0) /
    (((6378245.0 * (1 - 0.00669342162296594323)) /
      (magic * sqrtMagic)) *
      Math.PI)
  dLon =
    (dLon * 180.0) /
    ((6378245.0 / sqrtMagic) * Math.cos(radLat) * Math.PI)

  return {
    latitude: lat + dLat,
    longitude: lon + dLon,
  }
}

function outOfChina(lat: number, lon: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x))
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) +
      20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0
  ret +=
    ((20.0 * Math.sin(y * Math.PI) +
      40.0 * Math.sin((y / 3.0) * Math.PI)) *
      2.0) /
    3.0
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) +
      320 * Math.sin((y * Math.PI) / 30.0)) *
      2.0) /
    3.0
  return ret
}

function transformLon(x: number, y: number): number {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x))
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) +
      20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0
  ret +=
    ((20.0 * Math.sin(x * Math.PI) +
      40.0 * Math.sin((x / 3.0) * Math.PI)) *
      2.0) /
    3.0
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) +
      300.0 * Math.sin((x / 30.0) * Math.PI)) *
      2.0) /
    3.0
  return ret
}
