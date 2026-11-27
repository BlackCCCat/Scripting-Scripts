import {
  Button,
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
  AppLanguage,
  AppSettings,
  ConnectionCheckState,
  FavoriteLocation,
  InterruptedSessionRecord,
  LiveLocationTelemetry,
  MFiStatus,
  MapDisplayStyle,
  PairingStatus,
  PickTarget,
  RecentLocation,
  SessionSnapshot,
  TargetLocation,
} from "../types";
import {
  coordinateDisplayPair,
  deviceWgs84ToMapCoord,
  distanceMeters,
  formatDistanceMeters,
  formatLatLon,
  mapCoordToDeviceWgs84,
  parseAltitudeValue,
  parseAndConvertToMapCoord,
  round6,
} from "../utils/coords";
import { formatText, getStrings } from "../utils/i18n";
import {
  reverseGeocodePlace,
  searchDomesticPlaces,
  searchGlobalPlaces,
  type PlaceSearchResult,
} from "../utils/searchApi";
import { HomePageSwitcherMenu, MapHUDIconButton, RelocPrimaryButton, SettingsIconBadge, StatusDot } from "./components";
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
  telemetry: LiveLocationTelemetry | null;
  activeWgs84Target: TargetLocation | null;
  resolvingAltitude?: boolean;
  mfiStatus: MFiStatus;
  pairingStatus: PairingStatus;
  connectionState: ConnectionCheckState;
  favorites: FavoriteLocation[];
  recents: RecentLocation[];
  interruptedSession: InterruptedSessionRecord | null;
  onRefreshTelemetry: () => Promise<void> | void;
  onSelectTarget: (target: PickTarget & { altitude: number }, resolveAltitude?: boolean) => void;
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
  homeTabSwitcher?: { currentTab: number; onSelectTab: (tab: number) => void };
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

function mapStyleTitle(style: MapDisplayStyle, language?: AppLanguage): string {
  const m = getStrings(language).map;
  switch (style) {
    case "satellite":
      return m.styleSatellite;
    case "hybrid":
      return m.styleHybrid;
    case "standard":
    default:
      return m.styleStandard;
  }
}

export function MapPickerView(props: MapPickerViewProps) {
  const { selectedTarget, activeMapCoordinate, settings, snapshot, mfiStatus, pairingStatus } = props;
  const s = getStrings(settings.language);

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
  const [locatingCurrent, setLocatingCurrent] = useState(false);
  const [checkingTelemetry, setCheckingTelemetry] = useState(false);
  const locateReqIdRef = useRef(0);

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

  async function focusLocatedCoord(
    loc: { latitude: number; longitude: number },
    reqId: number,
  ): Promise<void> {
    if (locateReqIdRef.current !== reqId) return;
    const mapped = deviceWgs84ToMapCoord(
      loc.latitude,
      loc.longitude,
      settings.gcj02CorrectionEnabled,
    );
    moveCameraTo(mapped.latitude, mapped.longitude);
    setLocatingCurrent(false);
    await pickCoordinateWithGeocode(mapped.latitude, mapped.longitude, undefined, undefined, true, true);
  }

  async function locateCurrentPosition() {
    if (locatingCurrent) return;
    const reqId = ++locateReqIdRef.current;
    setLocatingCurrent(true);
    try {
      const now = Date.now();
      let initial: { latitude: number; longitude: number; timestamp: number } | null =
        props.telemetry && now - props.telemetry.timestamp < 60_000
          ? props.telemetry
          : null;

      // 先取系统缓存坐标，避免 forceRequest: true 导致室内等待 3~10 秒才动镜头
      if (!initial) {
        initial = await Location.requestCurrent().catch(() => null);
      }

      if (initial) {
        const geocodeTask = focusLocatedCoord(initial, reqId);
        // 若缓存已超过 15 秒，后台静默高精度校准一次；位置变化 > 25m 再微调镜头
        if (Date.now() - initial.timestamp > 15_000) {
          const refined = await Location.requestCurrent({ forceRequest: true }).catch(() => null);
          if (refined && locateReqIdRef.current === reqId && distanceMeters(initial, refined) > 25) {
            await focusLocatedCoord(refined, reqId);
            return;
          }
        }
        await geocodeTask;
        return;
      }

      const fresh = await Location.requestCurrent({ forceRequest: true });
      if (!fresh) {
        if (locateReqIdRef.current === reqId) {
          props.onToast(s.map.locateUnavailable);
        }
        return;
      }
      await focusLocatedCoord(fresh, reqId);
    } catch (error) {
      if (locateReqIdRef.current === reqId) {
        props.onToast(formatText(s.map.locateFailed, error instanceof Error ? error.message : String(error)));
      }
    } finally {
      setLocatingCurrent(false);
    }
  }

  async function pickCoordinateWithGeocode(
    lat: number,
    lon: number,
    presetName?: string,
    presetAddress?: string,
    fromAutoLocate = false,
    resolveAltitude = true,
    explicitAltitude?: number,
  ) {
    if (!fromAutoLocate) {
      locateReqIdRef.current += 1;
    }
    const cleanLat = round6(lat);
    const cleanLon = round6(lon);
    const immediate: PickTarget & { altitude: number } = {
      latitude: cleanLat,
      longitude: cleanLon,
      altitude:
        typeof explicitAltitude === "number" && Number.isFinite(explicitAltitude)
          ? explicitAltitude
          : (selectedTarget.altitude ?? settings.defaultAltitude),
      name: presetName || `${cleanLat.toFixed(5)}, ${cleanLon.toFixed(5)}`,
      address: presetAddress,
    };
    props.onSelectTarget(immediate, resolveAltitude);

    if (presetName) return;

    setResolvingGeocode(true);
    const wgs = mapCoordToDeviceWgs84(cleanLat, cleanLon, settings.gcj02CorrectionEnabled);
    const place = await reverseGeocodePlace(cleanLat, cleanLon, {
      customEndpoint: settings.globalSearchEndpoint,
      wgs84Coordinate: wgs,
      language: settings.language,
    });
    setResolvingGeocode(false);

    if (place.name) {
      props.onSelectTarget(
        {
          latitude: cleanLat,
          longitude: cleanLon,
          altitude: immediate.altitude,
          name: place.name,
          address: place.address || undefined,
        },
        undefined,
      );
    }
  }

  async function performSearch() {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    setIsSearching(true);
    try {
      try {
        const parsed = await parseAndConvertToMapCoord(trimmed);
        const hasAlt = typeof parsed.altitude === "number" && Number.isFinite(parsed.altitude);
        setSearchResults([]);
        setSearchText("");
        moveCameraTo(parsed.latitude, parsed.longitude);
        await pickCoordinateWithGeocode(
          parsed.latitude,
          parsed.longitude,
          parsed.name || undefined,
          formatLatLon(parsed.latitude, parsed.longitude),
          false,
          !hasAlt,
          parsed.altitude,
        );
        return;
      } catch {
        // 非纯坐标或地图链接，继续按关键词检索
      }

      if (searchRegion === "domestic") {
        const hits = await searchDomesticPlaces(trimmed);
        setSearchResults(hits);
        if (hits.length === 0) props.onToast(s.map.searchDomesticEmpty);
      } else {
        const { results: hits, translatedQuery } = await searchGlobalPlaces(
          trimmed,
          settings.globalSearchEndpoint,
          settings.gcj02CorrectionEnabled,
          settings.language,
        );
        setSearchResults(hits);
        if (translatedQuery && hits.length > 0) {
          props.onToast(formatText(s.map.searchTranslatedToast, translatedQuery));
        } else if (hits.length === 0) {
          props.onToast(s.map.searchGlobalEmpty);
        }
      }
    } catch (error) {
      props.onToast(formatText(s.map.searchFailed, error instanceof Error ? error.message : String(error)));
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
      ? formatText(s.map.statusAck, snapshot.packetsAcknowledged)
      : snapshot.authenticated
        ? s.map.statusWaitSub
        : s.map.statusConnecting
    : !pairingStatus.isLoaded
      ? s.map.statusNoPairing
      : !mfiStatus.isLoaded
        ? s.map.statusNoMFi
        : props.connectionState === "verified"
          ? s.map.statusVerified
          : props.connectionState === "checking"
            ? s.map.statusChecking
            : props.connectionState === "failed"
              ? s.map.statusFailed
              : s.map.statusPendingVerify;

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

  function renderParameterRow() {
    const showSpoofStatus = snapshot.isRunning && snapshot.mode === "send" && !hasPendingShift;
    const spoofOffsetMeters =
      showSpoofStatus && props.activeWgs84Target && props.telemetry
        ? distanceMeters(props.telemetry, props.activeWgs84Target)
        : null;
    const isSpoofSuccess = spoofOffsetMeters !== null && spoofOffsetMeters <= 50;

    let statusText = s.map.spoofVerifying;
    let statusColor: Color = "secondaryLabel";
    let statusBg: Color = "rgba(142, 142, 147, 0.13)";

    if (checkingTelemetry) {
      statusText = s.map.spoofChecking;
      statusColor = RELOC_COLORS.accent;
      statusBg = "rgba(43, 115, 245, 0.14)";
    } else if (snapshot.packetsAcknowledged === 0) {
      statusText = snapshot.authenticated ? s.map.spoofWaitSub : s.map.spoofConnecting;
    } else if (spoofOffsetMeters !== null) {
      statusText = isSpoofSuccess
        ? formatText(s.map.spoofEffective, formatDistanceMeters(spoofOffsetMeters))
        : formatText(s.map.spoofIneffective, formatDistanceMeters(spoofOffsetMeters));
      statusColor = isSpoofSuccess ? RELOC_COLORS.emerald : RELOC_COLORS.amber;
      statusBg = isSpoofSuccess ? "rgba(23, 184, 122, 0.15)" : "rgba(242, 153, 31, 0.15)";
    }

    const altDisplayText = props.resolvingAltitude
      ? s.map.resolvingAlt
      : `${selectedTarget.altitude.toFixed(1)} m${settings.microJitterEnabled ? s.map.altitudeMicroSuffix : ""}`;

    return (
      <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
        <Text font="caption2" fontDesign="monospaced" foregroundStyle="secondaryLabel" lineLimit={1}>
          {readout.needsOffset
            ? `${s.map.mapLabelPrefix} ${formatLatLon(readout.map.latitude, readout.map.longitude, 5)} · ${s.map.wgsLabelPrefix} ${formatLatLon(readout.wgs84.latitude, readout.wgs84.longitude, 5)}`
            : `${s.map.wgsFullPrefix} ${formatLatLon(readout.wgs84.latitude, readout.wgs84.longitude)}`}
        </Text>
        <Spacer />
        {showSpoofStatus ? (
          <Button
            buttonStyle="plain"
            disabled={checkingTelemetry}
            action={async () => {
              HapticFeedback.lightImpact();
              setCheckingTelemetry(true);
              try {
                await props.onRefreshTelemetry();
              } finally {
                setCheckingTelemetry(false);
              }
            }}
          >
            <HStack
              spacing={4}
              padding={{ horizontal: 8, vertical: 3 }}
              background={{ style: statusBg, shape: "capsule" }}
              contentShape="capsule"
            >
              <Text
                font="caption2"
                fontWeight="semibold"
                monospacedDigit
                foregroundStyle={statusColor}
                lineLimit={1}
              >
                {statusText}
              </Text>
            </HStack>
          </Button>
        ) : (
          <Button
            buttonStyle="plain"
            action={() => {
              HapticFeedback.lightImpact();
              openSheet("manual");
            }}
          >
            <HStack
              spacing={4}
              padding={{ horizontal: 7, vertical: 3 }}
              background={{ style: "rgba(142, 142, 147, 0.12)", shape: "capsule" }}
              contentShape="capsule"
            >
              <Image systemName="mountain.2.fill" font="caption2" foregroundStyle="secondaryLabel" />
              <Text font="caption2" fontDesign="monospaced" foregroundStyle="secondaryLabel" lineLimit={1}>
                {altDisplayText}
              </Text>
            </HStack>
          </Button>
        )}
      </HStack>
    );
  }

  function buildSheetContent(kind: MapSheetKind) {
    if (kind === "library") {
      return (
        <LibrarySheet
          favorites={props.favorites}
          recents={props.recents}
          language={settings.language}
          onSelect={(item) => {
            locateReqIdRef.current += 1;
            closeSheet();
            moveCameraTo(item.latitude, item.longitude);
            props.onSelectTarget(
              {
                latitude: item.latitude,
                longitude: item.longitude,
                altitude: item.altitude,
                name: item.name,
                address: item.subtitle,
              },
              false,
            );
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
          language={settings.language}
          onApply={(target, resolveAltitude) => {
            closeSheet();
            moveCameraTo(target.latitude, target.longitude);
            void pickCoordinateWithGeocode(
              target.latitude,
              target.longitude,
              target.name,
              target.address,
              false,
              resolveAltitude,
              target.altitude,
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
                  toastRef.current(s.map.tapNotReady);
                  return;
                }
                HapticFeedback.lightImpact();
                void pickRef.current(picked.latitude, picked.longitude, undefined, undefined, false, true);
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
        {/* Top Row: 左上角页面切换菜单/可选退出按钮 + 搜索胶囊 */}
        <HStack spacing={8}>
          {props.homeTabSwitcher ? (
            <HomePageSwitcherMenu
              currentTab={props.homeTabSwitcher.currentTab}
              onSelectTab={props.homeTabSwitcher.onSelectTab}
              style="mapCircle"
              language={settings.language}
            />
          ) : null}

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
              title={s.map.searchPlaceholder}
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
                  {searchRegion === "domestic" ? s.map.regionDomestic : s.map.regionGlobal}
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
                          {item.name || s.map.unknownPlace}
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
                {`${formatLatLon(readout.wgs84.latitude, readout.wgs84.longitude, 4)} · ${selectedTarget.altitude.toFixed(0)}m`}
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
                {s.map.interruptedTitle}
              </Text>
              <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                {formatText(s.map.interruptedSubtitle, props.interruptedSession.placeName)}
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
                  {s.map.restoreButton}
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
                systemName="bolt.fill"
                foregroundColor={settings.shortcutName.trim() ? RELOC_COLORS.accent : "label"}
                action={() => {
                  if (!settings.shortcutName.trim()) {
                    toastRef.current(s.map.needShortcutToast);
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
              <Section header={<Text>{s.map.styleMenuTitle}</Text>}>
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
                      <Text>{mapStyleTitle(style, settings.language)}</Text>
                    </HStack>
                  </Button>
                ))}
              </Section>
              <Section header={<Text>{s.map.coordToolsSection}</Text>}>
                <Button action={() => openSheet("manual")}>
                  <HStack>
                    <Image systemName="number" />
                    <Text>{s.map.manualInputMenu}</Text>
                  </HStack>
                </Button>
              </Section>
            </Menu>

            <MapHUDIconButton
              systemName={snapshot.isRunning ? "scope" : "location.fill"}
              loading={!snapshot.isRunning && locatingCurrent}
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
                  {selectedTarget.name || s.map.currentCoord}
                </Text>
                {resolvingGeocode ? (
                  <Text font="caption2" foregroundStyle="tertiaryLabel">{s.map.resolvingGeocode}</Text>
                ) : null}
              </HStack>

              <HStack spacing={5}>
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {selectedTarget.address || formatLatLon(readout.wgs84.latitude, readout.wgs84.longitude, 5)}
                </Text>
                <Button
                  buttonStyle="plain"
                  action={() => {
                    const text = `${selectedTarget.name || s.map.currentCoord} (${formatLatLon(readout.wgs84.latitude, readout.wgs84.longitude)})`;
                    Pasteboard.setString(text);
                    HapticFeedback.lightImpact();
                    setCopiedAddressToast(true);
                    props.onToast(s.map.copyAddressToast);
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
                {snapshot.isRunning && snapshot.mode === "send" && !hasPendingShift ? (
                  <Button
                    buttonStyle="plain"
                    action={() => {
                      HapticFeedback.lightImpact();
                      openSheet("manual");
                    }}
                  >
                    <HStack
                      spacing={3}
                      padding={{ horizontal: 6, vertical: 2 }}
                      background={{ style: "rgba(142, 142, 147, 0.12)", shape: "capsule" }}
                      contentShape="capsule"
                    >
                      <Image systemName="mountain.2.fill" font="caption2" foregroundStyle="secondaryLabel" />
                      <Text font="caption2" fontDesign="monospaced" foregroundStyle="secondaryLabel" lineLimit={1}>
                        {props.resolvingAltitude
                          ? s.map.resolvingAlt
                          : formatText(s.map.altitudeBadge, selectedTarget.altitude.toFixed(1))}
                      </Text>
                    </HStack>
                  </Button>
                ) : null}
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

          {/* 坐标与海拔 / 模拟实测结果参数栏 */}
          {renderParameterRow()}

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
                    ? s.map.needPairingBanner
                    : s.map.needMFiBanner}
                </Text>
                <Spacer />
                <Image systemName="chevron.right" font="caption2" fontWeight="bold" foregroundStyle="secondaryLabel" />
              </HStack>
            </Button>
          ) : snapshot.lastError && !snapshot.isRunning ? (
            <Text font="caption" foregroundStyle={RELOC_COLORS.crimson} lineLimit={1}>
              {formatText(s.map.lastErrorPrefix, snapshot.lastError)}
            </Text>
          ) : null}

          {/* 主 CTA 按钮组（iOS 26+ glassProminent 彩色玻璃渲染 + 白色高对比文字 + 全区域点击） */}
          <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
            {!snapshot.isRunning ? (
              <>
                <RelocPrimaryButton
                  title={s.map.btnStart}
                  systemImage="paperplane.fill"
                  variant="prominent"
                  tint={RELOC_COLORS.accent}
                  disabled={!canStartSession}
                  action={props.onStartSpoofing}
                />
                <RelocPrimaryButton
                  title={s.map.btnProbe}
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
                    ? s.map.btnProbing
                    : snapshot.packetsAcknowledged > 0
                      ? formatText(s.map.btnReconnectingPackets, snapshot.packetsAcknowledged)
                      : s.map.btnConnecting
                }
                loading
                variant="prominent"
                tint={snapshot.packetsAcknowledged > 0 ? RELOC_COLORS.amber : RELOC_COLORS.accent}
                action={props.onStopSpoofing}
              />
            ) : snapshot.mode === "probe" ? (
              <RelocPrimaryButton
                title={s.map.btnProbeReadyStop}
                systemImage="checkmark.circle.fill"
                variant="prominent"
                tint={RELOC_COLORS.emerald}
                action={props.onStopSpoofing}
              />
            ) : (
              <>
                {hasPendingShift ? (
                  <RelocPrimaryButton
                    title={s.map.btnUpdateTarget}
                    systemImage="paperplane.fill"
                    variant="prominent"
                    tint={RELOC_COLORS.accent}
                    action={props.onUpdateRunningLocation}
                  />
                ) : null}
                <RelocPrimaryButton
                  title={s.map.btnStopSpoofing}
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
  language?: AppLanguage;
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
  const s = getStrings(props.language);

  async function promptRename(fav: FavoriteLocation) {
    const next = await Dialog.prompt({
      title: s.library.renameTitle,
      message: formatText(s.library.renameMessage, fav.name),
      defaultValue: fav.name,
      placeholder: s.library.renamePlaceholder,
      cancelLabel: s.common.cancel,
      confirmLabel: s.common.save,
    });
    if (next && next.trim()) {
      props.onRenameFavorite(fav.id, next.trim());
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={s.library.title}
        toolbar={{
          topBarTrailing: <Button title={s.common.close} action={props.onDismiss} />,
        }}
      >
        <Section header={<Text>{formatText(s.library.favoritesSection, props.favorites.length)}</Text>}>
          {props.favorites.length === 0 ? (
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {s.library.favoritesEmpty}
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
                      title={s.common.delete}
                      role="destructive"
                      action={() => props.onRemoveFavorite(fav.id)}
                    />,
                    <Button
                      key="rename"
                      title={s.common.rename}
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

        <Section header={<Text>{formatText(s.library.recentsSection, props.recents.length)}</Text>}>
          {props.recents.length === 0 ? (
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {s.library.recentsEmpty}
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
              <Button title={s.library.clearRecents} role="destructive" action={props.onClearRecents} />
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
  language?: AppLanguage;
  onApply: (target: PickTarget & { altitude: number }, resolveAltitude: boolean) => void;
  onDismiss: () => void;
}) {
  const s = getStrings(props.language);
  const initialWgs = mapCoordToDeviceWgs84(
    props.initialTarget.latitude,
    props.initialTarget.longitude,
    props.gcj02Enabled,
  );
  const [inputMode, setInputMode] = useState<"map" | "wgs84">("wgs84");
  const [latText, setLatText] = useState(initialWgs.latitude.toFixed(6));
  const [lonText, setLonText] = useState(initialWgs.longitude.toFixed(6));
  const [altText, setAltText] = useState(props.initialTarget.altitude.toFixed(1));
  const [linkText, setLinkText] = useState("");
  const [parseError, setParseError] = useState("");

  async function parseLinkOrClipboard(fromClipboard: boolean) {
    setParseError("");
    const raw = fromClipboard ? (await Pasteboard.getString()) || "" : linkText;
    if (!raw.trim()) {
      setParseError(fromClipboard ? s.manual.clipboardEmpty : s.manual.needInput);
      return;
    }
    try {
      const parsed = await parseAndConvertToMapCoord(raw);
      const hasExplicitAlt = typeof parsed.altitude === "number" && Number.isFinite(parsed.altitude);
      const fallbackAlt = parseAltitudeValue(altText) ?? props.initialTarget.altitude;
      props.onApply(
        {
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          altitude: hasExplicitAlt ? (parsed.altitude as number) : fallbackAlt,
          name: parsed.name || `${parsed.latitude.toFixed(5)}, ${parsed.longitude.toFixed(5)}`,
          address: formatText(s.manual.parseSourcePrefix, parsed.src || "coordinate"),
        },
        !hasExplicitAlt,
      );
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error));
    }
  }

  function applyNumbers() {
    setParseError("");
    const lat = Number.parseFloat(latText.trim());
    const lon = Number.parseFloat(lonText.trim());
    const trimmedAlt = altText.trim();
    const parsedAlt = trimmedAlt ? parseAltitudeValue(trimmedAlt) : props.initialTarget.altitude;

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setParseError(s.manual.invalidLatLon);
      return;
    }
    if (trimmedAlt && parsedAlt === undefined) {
      setParseError(s.manual.invalidAlt);
      return;
    }

    let mapLat = lat;
    let mapLon = lon;
    if (inputMode === "wgs84" && props.gcj02Enabled) {
      const mapped = deviceWgs84ToMapCoord(lat, lon, true);
      mapLat = mapped.latitude;
      mapLon = mapped.longitude;
    }

    props.onApply(
      {
        latitude: round6(mapLat),
        longitude: round6(mapLon),
        altitude: parsedAlt ?? props.initialTarget.altitude,
      },
      false,
    );
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={s.manual.title}
        toolbar={{
          topBarLeading: <Button title={s.common.cancel} action={props.onDismiss} />,
          topBarTrailing: <Button title={s.common.apply} action={applyNumbers} />,
        }}
      >
        <Section
          header={<Text>{s.manual.linkSection}</Text>}
          footer={<Text>{s.manual.linkFooter}</Text>}
        >
          <TextField
            title={s.manual.linkFieldPlaceholder}
            value={linkText}
            onChanged={setLinkText}
          />
          <Button title={s.manual.parseLinkBtn} action={() => void parseLinkOrClipboard(false)} />
          <Button title={s.manual.parseClipboardBtn} action={() => void parseLinkOrClipboard(true)} />
        </Section>

        <Section header={<Text>{s.manual.valuesSection}</Text>}>
          <Picker
            label={<Text>{s.manual.coordSystemLabel}</Text>}
            value={inputMode}
            onChanged={(v: string) => setInputMode(v === "map" ? "map" : "wgs84")}
            pickerStyle="segmented"
          >
            <Text tag="wgs84">{s.manual.coordWgs84}</Text>
            <Text tag="map">{s.manual.coordGcj02}</Text>
          </Picker>

          <HStack>
            <Text>{s.manual.latLabel}</Text>
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
            <Text>{s.manual.lonLabel}</Text>
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
            <Text>{s.manual.altLabel}</Text>
            <Spacer />
            <TextField
              title="10.0"
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
