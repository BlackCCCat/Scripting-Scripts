import {
  Button,
  Capsule,
  Divider,
  HStack,
  Image,
  List,
  Map,
  MapCircle,
  MapReader,
  Marker,
  Menu,
  NavigationStack,
  Picker,
  ProgressView,
  ScrollView,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  ZStack,
  type Color,
  type MapProxy,
  type MapSelectionValue,
  type Point,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
} from "scripting";
import { DEFAULT_SPAN } from "../constants";
import type {
  AppSettings,
  ConnectionCheckState,
  FavoriteLocation,
  InterruptedSessionRecord,
  MFiStatus,
  MapDisplayStyle,
  PairingStatus,
  PickTarget,
  RecentLocation,
  SessionSnapshot,
} from "../types";
import {
  coordinateDisplayPair,
  deviceWgs84ToMapCoord,
  formatLatLon,
  mapCoordToDeviceWgs84,
  parseAndConvertToMapCoord,
  round6,
} from "../utils/coords";
import {
  reverseGeocodePlace,
  searchDomesticPlaces,
  searchGlobalPlaces,
  type PlaceSearchResult,
} from "../utils/searchApi";
import { MapHUDIconButton, RelocPrimaryButton, SettingsIconBadge, StatusDot } from "./components";
import { launchShortcut } from "../utils/shortcut";
import {
  RELOC_COLORS,
  floatingCardStyle,
  floatingPillStyle,
  topCircleButtonStyle,
} from "./theme";

type MapSheetKind = "library" | "manual" | null;

interface MapPickerViewProps {
  selectedTarget: PickTarget & { altitude: number };
  activeMapCoordinate: PickTarget | null;
  settings: AppSettings;
  snapshot: SessionSnapshot;
  mfiStatus: MFiStatus;
  pairingStatus: PairingStatus;
  connectionState: ConnectionCheckState;
  favorites: FavoriteLocation[];
  recents: RecentLocation[];
  interruptedSession: InterruptedSessionRecord | null;
  onSelectTarget: (target: PickTarget & { altitude: number }) => void;
  onStartSpoofing: () => void;
  onUpdateRunningLocation: () => void;
  onStopSpoofing: () => void;
  onStartProbe: () => void;
  onSwitchToConfig: () => void;
  onChangeMapStyle: (style: MapDisplayStyle) => void;
  onAddFavorite: (target: PickTarget & { altitude: number }) => void;
  onRenameFavorite: (id: string, name: string) => void;
  onRemoveFavorite: (id: string) => void;
  onClearRecents: () => void;
  onResumeInterrupted: (record: InterruptedSessionRecord) => void;
  onDismissInterrupted: () => void;
  onToast: (message: string) => void;
  onClose?: () => void;
}

function toMapStyleSpec(style: MapDisplayStyle) {
  switch (style) {
    case "satellite":
      return { style: "imagery" as const, elevation: "realistic" as const };
    case "hybrid":
      return { style: "hybrid" as const, elevation: "realistic" as const, showsTraffic: true };
    case "standard":
    default:
      return { style: "standard" as const, showsTraffic: true };
  }
}

function mapStyleTitle(style: MapDisplayStyle): string {
  switch (style) {
    case "satellite":
      return "卫星图";
    case "hybrid":
      return "混合图";
    case "standard":
    default:
      return "标准地图";
  }
}

export function MapPickerView(props: MapPickerViewProps) {
  const { selectedTarget, activeMapCoordinate, settings, snapshot, mfiStatus, pairingStatus } = props;

  const cameraPosition = useObservable<MapCameraPosition>(
    MapCameraPosition.region({
      center: {
        latitude: selectedTarget.latitude,
        longitude: selectedTarget.longitude,
      },
      span: DEFAULT_SPAN,
    }),
  );
  const mapSelection = useObservable<MapSelectionValue | null>(null);

  const sheetKind = useObservable<MapSheetKind>(null);
  const showSheet = useObservable<boolean>(false);

  const [searchText, setSearchText] = useState("");
  const [searchRegion, setSearchRegion] = useState<"domestic" | "global">("domestic");
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [resolvingGeocode, setResolvingGeocode] = useState(false);
  const [copiedAddressToast, setCopiedAddressToast] = useState(false);

  function openSheet(kind: Exclude<MapSheetKind, null>) {
    sheetKind.setValue(kind);
    showSheet.setValue(true);
  }

  function closeSheet() {
    showSheet.setValue(false);
    setTimeout(() => sheetKind.setValue(null), 200);
  }

  function moveCameraTo(lat: number, lon: number) {
    const pos = cameraPosition.value;
    const span = pos.region?.span ?? DEFAULT_SPAN;
    cameraPosition.setValue(
      MapCameraPosition.region({
        center: { latitude: lat, longitude: lon },
        span,
      }),
    );
  }

  async function locateCurrentPosition() {
    try {
      const current = await Location.requestCurrent({ forceRequest: true });
      if (!current) {
        props.onToast("无法获取当前设备定位");
        return;
      }
      const mapped = deviceWgs84ToMapCoord(
        current.latitude,
        current.longitude,
        settings.gcj02CorrectionEnabled,
      );
      moveCameraTo(mapped.latitude, mapped.longitude);
      await pickCoordinateWithGeocode(mapped.latitude, mapped.longitude);
    } catch (error) {
      props.onToast(`获取定位失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function pickCoordinateWithGeocode(
    lat: number,
    lon: number,
    presetName?: string,
    presetAddress?: string,
  ) {
    const cleanLat = round6(lat);
    const cleanLon = round6(lon);
    const immediate: PickTarget & { altitude: number } = {
      latitude: cleanLat,
      longitude: cleanLon,
      altitude: selectedTarget.altitude ?? settings.defaultAltitude,
      name: presetName || `${cleanLat.toFixed(5)}, ${cleanLon.toFixed(5)}`,
      address: presetAddress,
    };
    props.onSelectTarget(immediate);

    if (presetName) return;

    setResolvingGeocode(true);
    const wgs = mapCoordToDeviceWgs84(cleanLat, cleanLon, settings.gcj02CorrectionEnabled);
    const place = await reverseGeocodePlace(cleanLat, cleanLon, {
      customEndpoint: settings.globalSearchEndpoint,
      wgs84Coordinate: wgs,
    });
    setResolvingGeocode(false);

    if (place.name) {
      props.onSelectTarget({
        latitude: cleanLat,
        longitude: cleanLon,
        altitude: immediate.altitude,
        name: place.name,
        address: place.address || undefined,
      });
    }
  }

  async function performSearch() {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    setIsSearching(true);
    try {
      try {
        const parsed = await parseAndConvertToMapCoord(trimmed);
        setSearchResults([]);
        setSearchText("");
        moveCameraTo(parsed.latitude, parsed.longitude);
        await pickCoordinateWithGeocode(
          parsed.latitude,
          parsed.longitude,
          parsed.name || undefined,
          formatLatLon(parsed.latitude, parsed.longitude),
        );
        return;
      } catch {
        // 非纯坐标或地图链接，继续按关键词检索
      }

      if (searchRegion === "domestic") {
        const hits = await searchDomesticPlaces(trimmed);
        setSearchResults(hits);
        if (hits.length === 0) props.onToast("未找到匹配地点，可切换为「全球」搜索");
      } else {
        const { results: hits, translatedQuery } = await searchGlobalPlaces(
          trimmed,
          settings.globalSearchEndpoint,
          settings.gcj02CorrectionEnabled,
        );
        setSearchResults(hits);
        if (translatedQuery && hits.length > 0) {
          props.onToast(`已用英文关键词搜索：${translatedQuery}`);
        } else if (hits.length === 0) {
          props.onToast("全球搜索无结果，请尝试英文地名或更具体关键词");
        }
      }
    } catch (error) {
      props.onToast(`搜索失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSearching(false);
    }
  }

  useEffect(() => {
    const listener = (val: MapSelectionValue | null) => {
      if (val && val.type === "feature" && val.coordinate) {
        HapticFeedback.selection();
        void pickCoordinateWithGeocode(
          val.coordinate.latitude,
          val.coordinate.longitude,
          val.title || undefined,
        );
      }
    };
    mapSelection.subscribe(listener);
    return () => {
      mapSelection.unsubscribe(listener);
    };
  }, [settings.gcj02CorrectionEnabled, selectedTarget.altitude]);

  const readout = coordinateDisplayPair(
    selectedTarget.latitude,
    selectedTarget.longitude,
    settings.gcj02CorrectionEnabled,
  );

  const existingFavorite = props.favorites.find(
    (f) =>
      Math.abs(f.latitude - selectedTarget.latitude) < 1e-5 &&
      Math.abs(f.longitude - selectedTarget.longitude) < 1e-5,
  );
  const isFavorite = Boolean(existingFavorite);

  const hasPendingShift =
    snapshot.isRunning &&
    activeMapCoordinate !== null &&
    (Math.abs(selectedTarget.latitude - activeMapCoordinate.latitude) > 1e-5 ||
      Math.abs(selectedTarget.longitude - activeMapCoordinate.longitude) > 1e-5);

  const canStartSession = mfiStatus.isLoaded && pairingStatus.isLoaded;

  const statusDotColor: Color = snapshot.isRunning
    ? snapshot.packetsAcknowledged > 0
      ? RELOC_COLORS.emerald
      : RELOC_COLORS.accent
    : !pairingStatus.isLoaded
      ? RELOC_COLORS.crimson
      : !mfiStatus.isLoaded
        ? RELOC_COLORS.amber
        : props.connectionState === "verified"
          ? RELOC_COLORS.emerald
          : props.connectionState === "checking"
            ? RELOC_COLORS.accent
            : RELOC_COLORS.amber;

  const statusPillTitle = snapshot.isRunning
    ? snapshot.packetsAcknowledged > 0
      ? `定位注入中 · ACK ${snapshot.packetsAcknowledged}`
      : snapshot.authenticated
        ? "已认证 · 等待订阅"
        : "建立连接中…"
    : !pairingStatus.isLoaded
      ? "未配对设备"
      : !mfiStatus.isLoaded
        ? "待导入 MFi 凭据"
        : props.connectionState === "verified"
          ? "回环已就绪"
          : props.connectionState === "checking"
            ? "正在检测连接…"
            : props.connectionState === "failed"
              ? "连接待检查"
              : "已配对 · 待验证";

  const cardAccentColor: Color = hasPendingShift
    ? RELOC_COLORS.amber
    : snapshot.isRunning
      ? RELOC_COLORS.emerald
      : RELOC_COLORS.accent;

  const cardBadgeBg: Color = hasPendingShift
    ? "rgba(242, 153, 31, 0.16)"
    : snapshot.isRunning
      ? "rgba(23, 184, 122, 0.16)"
      : "rgba(43, 115, 245, 0.16)";

  function buildSheetContent(kind: MapSheetKind) {
    if (kind === "library") {
      return (
        <LibrarySheet
          favorites={props.favorites}
          recents={props.recents}
          onSelect={(item) => {
            closeSheet();
            moveCameraTo(item.latitude, item.longitude);
            props.onSelectTarget({
              latitude: item.latitude,
              longitude: item.longitude,
              altitude: item.altitude,
              name: item.name,
              address: item.subtitle,
            });
          }}
          onRenameFavorite={props.onRenameFavorite}
          onRemoveFavorite={props.onRemoveFavorite}
          onClearRecents={props.onClearRecents}
          onDismiss={closeSheet}
        />
      );
    }
    if (kind === "manual") {
      return (
        <ManualCoordinateSheet
          initialTarget={selectedTarget}
          gcj02Enabled={settings.gcj02CorrectionEnabled}
          onApply={(target) => {
            closeSheet();
            moveCameraTo(target.latitude, target.longitude);
            void pickCoordinateWithGeocode(
              target.latitude,
              target.longitude,
              target.name,
              target.address,
            );
          }}
          onDismiss={closeSheet}
        />
      );
    }
    return undefined;
  }

  const sheetContent = buildSheetContent(sheetKind.value);
  const iconBadgeShape = { type: "rect" as const, cornerRadius: 12, style: "continuous" as const };
  const bannerShape = { type: "rect" as const, cornerRadius: 12, style: "continuous" as const };

  const pickRef = useRef(pickCoordinateWithGeocode);
  pickRef.current = pickCoordinateWithGeocode;
  const toastRef = useRef(props.onToast);
  toastRef.current = props.onToast;

  const activeLat = activeMapCoordinate?.latitude ?? null;
  const activeLon = activeMapCoordinate?.longitude ?? null;

  // 缓存原生 <Map> 节点：避免搜索输入、ACK 计数刷新或 Toast 变化时重复 diff MapKit 视图树导致卡顿
  const mapNode = useMemo(
    () => (
      <MapReader>
        {(proxy: MapProxy) => (
          <Map
            cameraPosition={cameraPosition}
            selection={mapSelection}
            featureSelectionAccessory={null}
            mapStyle={toMapStyleSpec(settings.mapStyle)}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            onTapGesture={{
              perform: (pt: Point) => {
                const picked = proxy.convertPoint(pt);
                if (!picked) {
                  toastRef.current("地图视角尚未就绪，请稍后再点");
                  return;
                }
                HapticFeedback.lightImpact();
                void pickRef.current(picked.latitude, picked.longitude);
              },
            }}
          >
            <Marker
              coordinate={{
                latitude: selectedTarget.latitude,
                longitude: selectedTarget.longitude,
              }}
              tint={hasPendingShift ? RELOC_COLORS.amber : "systemRed"}
              systemImage={hasPendingShift ? "mappin.and.ellipse" : "mappin"}
            />

            {activeLat !== null && activeLon !== null ? (
              <>
                <Marker
                  coordinate={{
                    latitude: activeLat,
                    longitude: activeLon,
                  }}
                  tint={RELOC_COLORS.emerald}
                  systemImage="location.fill"
                />
                {settings.microJitterEnabled ? (
                  <MapCircle
                    center={{
                      latitude: activeLat,
                      longitude: activeLon,
                    }}
                    radius={1.5}
                    fillColor="rgba(23, 184, 122, 0.22)"
                    strokeColor={RELOC_COLORS.emerald}
                    strokeStyle={{ lineWidth: 1, dash: [3, 2] }}
                  />
                ) : null}
              </>
            ) : null}
          </Map>
        )}
      </MapReader>
    ),
    [
      cameraPosition,
      mapSelection,
      settings.mapStyle,
      settings.microJitterEnabled,
      selectedTarget.latitude,
      selectedTarget.longitude,
      activeLat,
      activeLon,
      hasPendingShift,
    ],
  );

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      sheet={
        sheetKind.value && sheetContent
          ? { content: sheetContent, isPresented: showSheet }
          : undefined
      }
    >
      {mapNode}

      {/* 原版 Reukix/Reloc 全套 HUD：顶栏搜索 + 状态行 + 右侧 Dock + 底部玻璃卡片 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        spacing={10}
        padding={{ horizontal: 12, top: 8, bottom: 10 }}
      >
        {/* Top Row: 可选退出按钮 + 搜索胶囊 */}
        <HStack spacing={8}>
          {props.onClose ? (
            <MapHUDIconButton
              systemName="xmark"
              foregroundColor={RELOC_COLORS.crimson}
              action={props.onClose}
            />
          ) : null}

          <HStack
            spacing={9}
            padding={{ horizontal: 14, vertical: 10 }}
            frame={{ maxWidth: "infinity" }}
            {...floatingPillStyle()}
          >
            <Image systemName="magnifyingglass" font="subheadline" fontWeight="semibold" foregroundStyle={RELOC_COLORS.accent} />

            <TextField
              title="搜索地点或输入 纬度, 经度"
              value={searchText}
              onChanged={setSearchText}
              textInputAutocapitalization="never"
              submitLabel="search"
              onSubmit={() => void performSearch()}
              frame={{ maxWidth: "infinity" }}
            />

            <Button
              buttonStyle="plain"
              action={() => {
                HapticFeedback.lightImpact();
                setSearchRegion((prev) => (prev === "domestic" ? "global" : "domestic"));
              }}
            >
              <HStack
                padding={{ horizontal: 9, vertical: 4 }}
                background={{ style: "rgba(43, 115, 245, 0.12)", shape: "capsule" }}
                contentShape="capsule"
              >
                <Text font="caption2" fontWeight="semibold" foregroundStyle={RELOC_COLORS.accent}>
                  {searchRegion === "domestic" ? "国内" : "全球"}
                </Text>
              </HStack>
            </Button>

            {isSearching ? (
              <ProgressView controlSize="small" />
            ) : searchText.length > 0 ? (
              <Button
                buttonStyle="plain"
                action={() => {
                  setSearchText("");
                  setSearchResults([]);
                }}
              >
                <ZStack frame={{ width: 28, height: 28 }} contentShape="circle">
                  <Image systemName="xmark.circle.fill" foregroundStyle="secondaryLabel" />
                </ZStack>
              </Button>
            ) : (
              <Button
                buttonStyle="plain"
                action={() => {
                  HapticFeedback.lightImpact();
                  openSheet("manual");
                }}
              >
                <ZStack frame={{ width: 28, height: 28 }} contentShape="circle">
                  <Image systemName="number.circle.fill" font="title3" foregroundStyle="secondaryLabel" />
                </ZStack>
              </Button>
            )}
          </HStack>
        </HStack>

        {/* 内联搜索结果下拉浮层 */}
        {searchResults.length > 0 ? (
          <ScrollView frame={{ maxHeight: 220 }} {...floatingCardStyle(18)}>
            <VStack alignment="leading" spacing={0}>
              {searchResults.slice(0, 6).map((item, idx) => (
                <VStack key={`${item.name}-${idx}`} alignment="leading" spacing={0}>
                  <Button
                    buttonStyle="plain"
                    action={() => {
                      HapticFeedback.lightImpact();
                      setSearchResults([]);
                      setSearchText("");
                      moveCameraTo(item.coordinate.latitude, item.coordinate.longitude);
                      void pickCoordinateWithGeocode(
                        item.coordinate.latitude,
                        item.coordinate.longitude,
                        item.name,
                        item.address,
                      );
                    }}
                  >
                    <HStack
                      spacing={10}
                      padding={{ horizontal: 14, vertical: 10 }}
                      frame={{ maxWidth: "infinity" }}
                      contentShape={{ type: "rect", cornerRadius: 0 }}
                    >
                      <Image systemName="mappin.circle.fill" foregroundStyle={RELOC_COLORS.accent} />
                      <VStack alignment="leading" spacing={2}>
                        <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
                          {item.name || "未知地点"}
                        </Text>
                        {item.address ? (
                          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                            {item.address}
                          </Text>
                        ) : null}
                      </VStack>
                      <Spacer />
                    </HStack>
                  </Button>
                  {idx < Math.min(searchResults.length, 6) - 1 ? <Divider /> : null}
                </VStack>
              ))}
            </VStack>
          </ScrollView>
        ) : null}

        {/* 状态行（左侧：链路/认证状态胶囊；右侧：运行中的目标坐标胶囊） */}
        <HStack spacing={8}>
          <Button
            buttonStyle="plain"
            action={() => {
              HapticFeedback.lightImpact();
              props.onSwitchToConfig();
            }}
          >
            <HStack
              spacing={7}
              padding={{ horizontal: 12, vertical: 7 }}
              contentShape="capsule"
              {...floatingPillStyle()}
            >
              <StatusDot color={statusDotColor} active={snapshot.isRunning} />
              <Text font="caption" fontWeight="semibold" monospacedDigit foregroundStyle="label">
                {statusPillTitle}
              </Text>
              <Image systemName="chevron.right" font="caption2" fontWeight="bold" foregroundStyle="secondaryLabel" />
            </HStack>
          </Button>

          <Spacer />

          {snapshot.isRunning ? (
            <HStack spacing={5} padding={{ horizontal: 10, vertical: 7 }} {...floatingPillStyle()}>
              <Image systemName="location.fill" font="caption2" foregroundStyle={RELOC_COLORS.emerald} />
              <Text font="caption2" fontWeight="semibold" fontDesign="monospaced" foregroundStyle="label">
                {formatLatLon(readout.wgs84.latitude, readout.wgs84.longitude, 4)}
              </Text>
            </HStack>
          ) : null}
        </HStack>

        {/* 未正常结束恢复横幅 */}
        {props.interruptedSession && !snapshot.isRunning ? (
          <HStack spacing={10} padding={{ horizontal: 12, vertical: 9 }} {...floatingCardStyle(16)}>
            <SettingsIconBadge systemName="arrow.counterclockwise" color={RELOC_COLORS.amber} />
            <VStack alignment="leading" spacing={1}>
              <Text font="caption" fontWeight="bold">
                上次定位会话意外中断
              </Text>
              <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                {`恢复上次位置：${props.interruptedSession.placeName}`}
              </Text>
            </VStack>
            <Spacer />
            <Button
              buttonStyle="plain"
              action={() => {
                if (props.interruptedSession) {
                  HapticFeedback.mediumImpact();
                  moveCameraTo(props.interruptedSession.latitude, props.interruptedSession.longitude);
                  props.onResumeInterrupted(props.interruptedSession);
                }
              }}
            >
              <HStack
                padding={{ horizontal: 12, vertical: 6 }}
                background={{ style: RELOC_COLORS.amber, shape: "capsule" }}
                contentShape="capsule"
              >
                <Text font="caption" fontWeight="bold" foregroundStyle="white">
                  恢复
                </Text>
              </HStack>
            </Button>
            <Button buttonStyle="plain" action={props.onDismissInterrupted}>
              <ZStack frame={{ width: 28, height: 28 }} contentShape="circle">
                <Image systemName="xmark" font="caption" fontWeight="bold" foregroundStyle="secondaryLabel" />
              </ZStack>
            </Button>
          </HStack>
        ) : null}

        <Spacer />

        {/* 右侧控制栏（对应 Reukix/Reloc rightControlDock：快捷指令设置 / 收藏 / 图层菜单 / 定位） */}
        <HStack>
          <Spacer />
          <VStack spacing={10}>
            {settings.shortcutButtonEnabled ? (
              <MapHUDIconButton
                systemName="gearshape.fill"
                foregroundColor={settings.shortcutName.trim() ? RELOC_COLORS.accent : "label"}
                action={() => {
                  if (!settings.shortcutName.trim()) {
                    toastRef.current("请先在「设置」中填写快捷指令名称");
                    props.onSwitchToConfig();
                    return;
                  }
                  void launchShortcut(settings.shortcutName, (msg) => toastRef.current(msg));
                }}
              />
            ) : null}

            <MapHUDIconButton
              systemName="bookmark.fill"
              foregroundColor={props.favorites.length > 0 ? RELOC_COLORS.accent : "label"}
              action={() => openSheet("library")}
            />

            <Menu
              label={
                <ZStack frame={{ width: 42, height: 42 }} contentShape="circle" {...topCircleButtonStyle()}>
                  <Image systemName="map.fill" font="callout" fontWeight="semibold" foregroundStyle="label" />
                </ZStack>
              }
            >
              <Section header={<Text>地图样式</Text>}>
                {(["standard", "satellite", "hybrid"] as MapDisplayStyle[]).map((style) => (
                  <Button
                    key={style}
                    action={() => {
                      HapticFeedback.lightImpact();
                      props.onChangeMapStyle(style);
                    }}
                  >
                    <HStack>
                      <Image systemName={settings.mapStyle === style ? "checkmark" : "map"} />
                      <Text>{mapStyleTitle(style)}</Text>
                    </HStack>
                  </Button>
                ))}
              </Section>
              <Section header={<Text>坐标工具</Text>}>
                <Button action={() => openSheet("manual")}>
                  <HStack>
                    <Image systemName="number" />
                    <Text>手动输入经纬度 / 解析链接</Text>
                  </HStack>
                </Button>
              </Section>
            </Menu>

            <MapHUDIconButton
              systemName={snapshot.isRunning ? "scope" : "location.fill"}
              action={() => {
                if (snapshot.isRunning && activeMapCoordinate) {
                  moveCameraTo(activeMapCoordinate.latitude, activeMapCoordinate.longitude);
                } else {
                  void locateCurrentPosition();
                }
              }}
            />
          </VStack>
        </HStack>

        {/* 底部固定位置玻璃卡片（对应 fixedLocationCard） */}
        <VStack
          alignment="leading"
          spacing={12}
          padding={15}
          frame={{ maxWidth: "infinity" }}
          {...floatingCardStyle(24)}
        >
          {/* 顶部抓手 */}
          <HStack frame={{ maxWidth: "infinity" }}>
            <Spacer />
            <Capsule fill="rgba(142, 142, 147, 0.30)" frame={{ width: 36, height: 4 }} />
            <Spacer />
          </HStack>

          {/* 地点信息主行 */}
          <HStack spacing={11}>
            <ZStack frame={{ width: 42, height: 42 }} background={{ style: cardBadgeBg, shape: iconBadgeShape }}>
              <Image
                systemName={hasPendingShift ? "mappin.and.ellipse" : snapshot.isRunning ? "location.fill" : "mappin.circle.fill"}
                font="title3"
                fontWeight="semibold"
                foregroundStyle={cardAccentColor}
              />
            </ZStack>

            <VStack alignment="leading" spacing={2}>
              <HStack spacing={6}>
                <Text font="headline" lineLimit={1} foregroundStyle="label">
                  {selectedTarget.name || "当前坐标"}
                </Text>
                {resolvingGeocode ? (
                  <Text font="caption2" foregroundStyle="tertiaryLabel">解析中…</Text>
                ) : null}
              </HStack>

              <HStack spacing={5}>
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {selectedTarget.address || formatLatLon(readout.wgs84.latitude, readout.wgs84.longitude, 5)}
                </Text>
                <Button
                  buttonStyle="plain"
                  action={() => {
                    const text = `${selectedTarget.name || "坐标"} (${formatLatLon(readout.wgs84.latitude, readout.wgs84.longitude)})`;
                    Pasteboard.setString(text);
                    HapticFeedback.lightImpact();
                    setCopiedAddressToast(true);
                    props.onToast("已复制地点与 WGS-84 坐标");
                    setTimeout(() => setCopiedAddressToast(false), 1400);
                  }}
                >
                  <ZStack frame={{ width: 26, height: 22 }} contentShape="circle">
                    <Image
                      systemName={copiedAddressToast ? "checkmark.circle.fill" : "doc.on.doc"}
                      font="caption"
                      foregroundStyle={copiedAddressToast ? RELOC_COLORS.emerald : RELOC_COLORS.accent}
                    />
                  </ZStack>
                </Button>
              </HStack>
            </VStack>

            <Spacer />

            <Button
              buttonStyle="plain"
              action={() => {
                HapticFeedback.lightImpact();
                if (existingFavorite) {
                  props.onRemoveFavorite(existingFavorite.id);
                } else {
                  props.onAddFavorite(selectedTarget);
                }
              }}
            >
              <ZStack
                frame={{ width: 34, height: 34 }}
                background={{ style: "rgba(142, 142, 147, 0.14)", shape: "circle" }}
                contentShape="circle"
              >
                <Image
                  systemName={isFavorite ? "heart.fill" : "heart"}
                  font="subheadline"
                  fontWeight="semibold"
                  foregroundStyle={isFavorite ? "systemPink" : "secondaryLabel"}
                />
              </ZStack>
            </Button>

            {hasPendingShift && activeMapCoordinate ? (
              <Button
                buttonStyle="plain"
                action={() => {
                  props.onSelectTarget({
                    ...activeMapCoordinate,
                    altitude: selectedTarget.altitude,
                  });
                  moveCameraTo(activeMapCoordinate.latitude, activeMapCoordinate.longitude);
                }}
              >
                <ZStack
                  frame={{ width: 34, height: 34 }}
                  background={{ style: "rgba(142, 142, 147, 0.14)", shape: "circle" }}
                  contentShape="circle"
                >
                  <Image systemName="xmark" font="caption" fontWeight="bold" foregroundStyle="secondaryLabel" />
                </ZStack>
              </Button>
            ) : null}
          </HStack>

          {/* 坐标与海拔参数栏 */}
          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Text font="caption2" fontDesign="monospaced" foregroundStyle="secondaryLabel" lineLimit={1}>
              {readout.needsOffset
                ? `地图 ${formatLatLon(readout.map.latitude, readout.map.longitude, 5)} · WGS ${formatLatLon(readout.wgs84.latitude, readout.wgs84.longitude, 5)}`
                : `WGS-84 ${formatLatLon(readout.wgs84.latitude, readout.wgs84.longitude)}`}
            </Text>
            <Spacer />
            <Text font="caption2" foregroundStyle="tertiaryLabel">
              {`${selectedTarget.altitude.toFixed(0)}m${settings.microJitterEnabled ? " · ±0.6m" : ""}`}
            </Text>
          </HStack>

          {/* 静态上下文提示横幅（会话运行中不再增删多行提示，避免开关定位后卡片高度跳动闪烁） */}
          {!canStartSession ? (
            <Button buttonStyle="plain" action={props.onSwitchToConfig}>
              <HStack
                spacing={8}
                padding={10}
                frame={{ maxWidth: "infinity" }}
                background={{ style: "rgba(242, 153, 31, 0.14)", shape: bannerShape }}
                contentShape={bannerShape}
              >
                <Image systemName="exclamationmark.triangle.fill" foregroundStyle={RELOC_COLORS.amber} />
                <Text font="caption" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
                  {!pairingStatus.isLoaded
                    ? "尚未配对这台 iPhone，前往「设备连接」配对"
                    : "尚未导入 MFi 凭据，前往「设备连接」导入"}
                </Text>
                <Spacer />
                <Image systemName="chevron.right" font="caption2" fontWeight="bold" foregroundStyle="secondaryLabel" />
              </HStack>
            </Button>
          ) : snapshot.lastError && !snapshot.isRunning ? (
            <Text font="caption" foregroundStyle={RELOC_COLORS.crimson} lineLimit={1}>
              {`上次错误：${snapshot.lastError}`}
            </Text>
          ) : null}

          {/* 主 CTA 按钮组（iOS 26+ glassProminent 彩色玻璃渲染 + 白色高对比文字 + 全区域点击） */}
          <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
            {!snapshot.isRunning ? (
              <>
                <RelocPrimaryButton
                  title="开始定位"
                  systemImage="paperplane.fill"
                  variant="prominent"
                  tint={RELOC_COLORS.accent}
                  disabled={!canStartSession}
                  action={props.onStartSpoofing}
                />
                <RelocPrimaryButton
                  title="探测"
                  systemImage="waveform.path.ecg"
                  variant="prominent"
                  tint="systemTeal"
                  compact
                  disabled={!canStartSession}
                  action={props.onStartProbe}
                />
              </>
            ) : !snapshot.authenticated ? (
              <RelocPrimaryButton
                title={
                  snapshot.mode === "probe"
                    ? "连接探测中…"
                    : snapshot.packetsAcknowledged > 0
                      ? `重连中（已注入 ${snapshot.packetsAcknowledged} 包）`
                      : "建立连接中…"
                }
                loading
                variant="prominent"
                tint={snapshot.packetsAcknowledged > 0 ? RELOC_COLORS.amber : RELOC_COLORS.accent}
                action={props.onStopSpoofing}
              />
            ) : snapshot.mode === "probe" ? (
              <RelocPrimaryButton
                title="探测就绪 · 停止"
                systemImage="checkmark.circle.fill"
                variant="prominent"
                tint={RELOC_COLORS.emerald}
                action={props.onStopSpoofing}
              />
            ) : (
              <>
                {hasPendingShift ? (
                  <RelocPrimaryButton
                    title="更新到此位置"
                    systemImage="paperplane.fill"
                    variant="prominent"
                    tint={RELOC_COLORS.accent}
                    action={props.onUpdateRunningLocation}
                  />
                ) : null}
                <RelocPrimaryButton
                  title="停止模拟"
                  systemImage="stop.fill"
                  variant="prominent"
                  tint={RELOC_COLORS.crimson}
                  action={() => {
                    HapticFeedback.notificationSuccess();
                    props.onStopSpoofing();
                  }}
                />
              </>
            )}
          </HStack>
        </VStack>
      </VStack>
    </ZStack>
  );
}

// ── 收藏与历史 Sheet ─────────────────────────────────────────────────

function LibrarySheet(props: {
  favorites: FavoriteLocation[];
  recents: RecentLocation[];
  onSelect: (item: {
    name: string;
    subtitle?: string;
    latitude: number;
    longitude: number;
    altitude: number;
  }) => void;
  onRenameFavorite: (id: string, name: string) => void;
  onRemoveFavorite: (id: string) => void;
  onClearRecents: () => void;
  onDismiss: () => void;
}) {
  async function promptRename(fav: FavoriteLocation) {
    const next = await Dialog.prompt({
      title: "重命名收藏",
      message: `当前名称：${fav.name}`,
      defaultValue: fav.name,
      placeholder: "输入新的收藏名称",
      cancelLabel: "取消",
      confirmLabel: "保存",
    });
    if (next && next.trim()) {
      props.onRenameFavorite(fav.id, next.trim());
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="收藏与历史"
        toolbar={{
          topBarTrailing: <Button title="关闭" action={props.onDismiss} />,
        }}
      >
        <Section header={<Text>{`收藏地点 (${props.favorites.length})`}</Text>}>
          {props.favorites.length === 0 ? (
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              点击底部卡片右上角爱心即可保存常用位置。
            </Text>
          ) : (
            props.favorites.map((fav) => (
              <Button
                key={fav.id}
                action={() => props.onSelect(fav)}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button
                      key="delete"
                      title="删除"
                      role="destructive"
                      action={() => props.onRemoveFavorite(fav.id)}
                    />,
                    <Button
                      key="rename"
                      title="改名"
                      action={() => void promptRename(fav)}
                    />,
                  ],
                }}
              >
                <VStack alignment="leading" spacing={3} padding={{ vertical: 2 }}>
                  <HStack>
                    <Text font="headline" foregroundStyle="label">{fav.name}</Text>
                    <Spacer />
                    <Text font="caption2" fontDesign="monospaced" foregroundStyle="tertiaryLabel">
                      {`${fav.altitude.toFixed(0)} m`}
                    </Text>
                  </HStack>
                  <Text font="caption" fontDesign="monospaced" foregroundStyle="secondaryLabel">
                    {fav.subtitle ? `${fav.subtitle} · ` : ""}
                    {formatLatLon(fav.latitude, fav.longitude)}
                  </Text>
                </VStack>
              </Button>
            ))
          )}
        </Section>

        <Section header={<Text>{`最近使用 (${props.recents.length})`}</Text>}>
          {props.recents.length === 0 ? (
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              暂无历史模拟记录。
            </Text>
          ) : (
            <>
              {props.recents.map((rec) => (
                <Button key={rec.id} action={() => props.onSelect(rec)}>
                  <VStack alignment="leading" spacing={3} padding={{ vertical: 2 }}>
                    <Text font="headline" foregroundStyle="label">{rec.name}</Text>
                    <Text font="caption" fontDesign="monospaced" foregroundStyle="secondaryLabel">
                      {formatLatLon(rec.latitude, rec.longitude)}
                    </Text>
                  </VStack>
                </Button>
              ))}
              <Button title="清空最近记录" role="destructive" action={props.onClearRecents} />
            </>
          )}
        </Section>
      </List>
    </NavigationStack>
  );
}

// ── 手动坐标 / 链接解析 Sheet ────────────────────────────────────────

function ManualCoordinateSheet(props: {
  initialTarget: PickTarget & { altitude: number };
  gcj02Enabled: boolean;
  onApply: (target: PickTarget & { altitude: number }) => void;
  onDismiss: () => void;
}) {
  const initialWgs = mapCoordToDeviceWgs84(
    props.initialTarget.latitude,
    props.initialTarget.longitude,
    props.gcj02Enabled,
  );
  const [inputMode, setInputMode] = useState<"map" | "wgs84">("wgs84");
  const [latText, setLatText] = useState(initialWgs.latitude.toFixed(6));
  const [lonText, setLonText] = useState(initialWgs.longitude.toFixed(6));
  const [altText, setAltText] = useState(props.initialTarget.altitude.toFixed(0));
  const [linkText, setLinkText] = useState("");
  const [parseError, setParseError] = useState("");

  async function parseLinkOrClipboard(fromClipboard: boolean) {
    setParseError("");
    const raw = fromClipboard ? (await Pasteboard.getString()) || "" : linkText;
    if (!raw.trim()) {
      setParseError(fromClipboard ? "剪贴板为空" : "请先粘贴地图分享链接或经纬度文本");
      return;
    }
    try {
      const parsed = await parseAndConvertToMapCoord(raw);
      props.onApply({
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        altitude: Number.parseFloat(altText) || props.initialTarget.altitude,
        name: parsed.name || `${parsed.latitude.toFixed(5)}, ${parsed.longitude.toFixed(5)}`,
        address: `解析来源: ${parsed.src || "coordinate"}`,
      });
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error));
    }
  }

  function applyNumbers() {
    setParseError("");
    const lat = Number.parseFloat(latText.trim());
    const lon = Number.parseFloat(lonText.trim());
    const alt = Number.parseFloat(altText.trim());

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setParseError("请输入有效经纬度（纬度 -90~90，经度 -180~180）");
      return;
    }

    let mapLat = lat;
    let mapLon = lon;
    if (inputMode === "wgs84" && props.gcj02Enabled) {
      const mapped = deviceWgs84ToMapCoord(lat, lon, true);
      mapLat = mapped.latitude;
      mapLon = mapped.longitude;
    }

    props.onApply({
      latitude: round6(mapLat),
      longitude: round6(mapLon),
      altitude: Number.isFinite(alt) ? alt : props.initialTarget.altitude,
    });
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="手动输入坐标"
        toolbar={{
          topBarLeading: <Button title="取消" action={props.onDismiss} />,
          topBarTrailing: <Button title="应用" action={applyNumbers} />,
        }}
      >
        <Section
          header={<Text>从地图分享链接解析</Text>}
          footer={<Text>支持 Apple 地图、高德（含短链）、Google Maps、百度 BD-09 及纯经纬度文本。</Text>}
        >
          <TextField
            title="粘贴地图分享链接或 纬度, 经度"
            value={linkText}
            onChanged={setLinkText}
          />
          <Button title="解析链接" action={() => void parseLinkOrClipboard(false)} />
          <Button title="从剪贴板读取并解析" action={() => void parseLinkOrClipboard(true)} />
        </Section>

        <Section header={<Text>手动输入数值</Text>}>
          <Picker
            label={<Text>输入坐标系</Text>}
            value={inputMode}
            onChanged={(v: string) => setInputMode(v === "map" ? "map" : "wgs84")}
            pickerStyle="segmented"
          >
            <Text tag="wgs84">真实 WGS-84</Text>
            <Text tag="map">地图系 (GCJ-02)</Text>
          </Picker>

          <HStack>
            <Text>纬度 (Lat)</Text>
            <Spacer />
            <TextField
              title="37.334606"
              value={latText}
              onChanged={setLatText}
              multilineTextAlignment="trailing"
              keyboardType="numbersAndPunctuation"
              frame={{ width: 160 }}
            />
          </HStack>

          <HStack>
            <Text>经度 (Lon)</Text>
            <Spacer />
            <TextField
              title="-122.009102"
              value={lonText}
              onChanged={setLonText}
              multilineTextAlignment="trailing"
              keyboardType="numbersAndPunctuation"
              frame={{ width: 160 }}
            />
          </HStack>

          <HStack>
            <Text>海拔 (米)</Text>
            <Spacer />
            <TextField
              title="10"
              value={altText}
              onChanged={setAltText}
              multilineTextAlignment="trailing"
              keyboardType="numbersAndPunctuation"
              frame={{ width: 120 }}
            />
          </HStack>

          {parseError ? (
            <Text font="caption" foregroundStyle={RELOC_COLORS.crimson}>
              {parseError}
            </Text>
          ) : null}
        </Section>
      </List>
    </NavigationStack>
  );
}
