import {
  AppEvents,
  Button,
  EmptyView,
  Group,
  HStack,
  Image,
  Label,
  LiveActivity,
  Navigation,
  Script,
  Spacer,
  TabView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useRef,
  useState,
} from "scripting";
import {
  DEFAULT_TARGET_LOCATION,
  EMPTY_SNAPSHOT,
} from "./constants";
import {
  AccessoryLocationSession,
  verifyDeviceConnection,
} from "./core/accessory_session";
import { clearDebugLog, debugLog, describeError } from "./core/debug";
import {
  createHostIdentity,
  createPIN,
  startOnDevicePairing,
  type OnDevicePairingHandle,
} from "./core/pair_setup";
import {
  deletePairing,
  getPairingStatus,
  loadPairing,
  parsePairingFile,
  savePairing,
} from "./core/pairing";
import { RelocLiveActivity, isIPhoneDuo, type RelocActivityState } from "./live_activity";
import { liveActivityUpdateKey } from "./utils/liveActivityFormat";
import type {
  AppSettings,
  ConnectionCheckState,
  FavoriteLocation,
  InterruptedSessionRecord,
  LiveLocationTelemetry,
  MFiStatus,
  MapDisplayStyle,
  PairingStatus,
  PickTarget,
  ProtocolEvent,
  RecentLocation,
  SessionSnapshot,
  TargetLocation,
} from "./types";
import { RELOC_COLORS } from "./ui/theme";
import { ConfigurationView } from "./ui/ConfigurationView";
import { MapPickerView } from "./ui/MapPickerView";
import { ProtocolLogsView } from "./ui/ProtocolLogsView";
import { useMarkdownChangelogSheet } from "./ui/ReleaseNotesSheet";
import { distanceMeters, formatLatLon, mapCoordToDeviceWgs84, round6 } from "./utils/coords";
import { fetchTerrainElevation } from "./utils/elevation";
import { formatText, getStrings, resolveLanguageCode } from "./utils/i18n";
import {
  nudgeLocationSubscription,
  pulseLocationSubscription,
  refreshKeepAliveAfterLocationToggle,
  releaseKeepAlive,
  retainKeepAlive,
  startLocationMonitorUpdates,
  stopLocationMonitorUpdates,
} from "./utils/keepalive";
import { reverseGeocodePlace } from "./utils/searchApi";
import {
  addFavorite,
  addRecent,
  buildSessionConfigFromSettings,
  clearInterruptedSession,
  clearRecents,
  clearSessionID,
  loadFavorites,
  loadInterruptedSession,
  loadLastLocation,
  loadMFiSigner,
  loadMFiStatus,
  loadRecents,
  loadSettings,
  removeFavorite,
  renameFavorite,
  saveInterruptedSession,
  saveLastLocation,
  saveSessionID,
  saveSettings,
  scanLocalMFiDirectory,
} from "./utils/storage";

const MAX_EVENTS = 250;

export function App(props: {
  shared?: { latitude: number; longitude: number; altitude?: number; name?: string };
}) {
  const dismiss = Navigation.useDismiss();
  const isHomeScreen = Script.env === "home_screen";
  const canDismiss = !isHomeScreen;
  const isUnsupportedIPad =
    typeof Device !== "undefined" &&
    typeof Device.hardwareModel === "string" &&
    Device.hardwareModel.startsWith("iPad");
  const tabSelection = useObservable<number>(0);
  const [homeTab, setHomeTab] = useState<number>(0);
  const showPiP = useObservable<boolean>(false);

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const s = getStrings(settings.language);
  const changelog = useMarkdownChangelogSheet({ title: s.config.changelogTitle });
  const [resolvingAltitude, setResolvingAltitude] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<PickTarget & { altitude: number }>(() => {
    if (props.shared) {
      const fallbackAlt = loadSettings().defaultAltitude;
      return {
        latitude: round6(props.shared.latitude),
        longitude: round6(props.shared.longitude),
        altitude:
          typeof props.shared.altitude === "number" && Number.isFinite(props.shared.altitude)
            ? props.shared.altitude
            : fallbackAlt,
        name: props.shared.name || getStrings(loadSettings().language).map.sharedPlace,
      };
    }
    return (
      loadLastLocation() ?? {
        latitude: DEFAULT_TARGET_LOCATION.latitude,
        longitude: DEFAULT_TARGET_LOCATION.longitude,
        altitude: DEFAULT_TARGET_LOCATION.altitude,
        name: "Apple Park",
        address: "Cupertino, CA",
      }
    );
  });

  const [activeMapCoordinate, setActiveMapCoordinate] = useState<PickTarget | null>(null);
  const [activeWgs84Target, setActiveWgs84Target] = useState<TargetLocation | null>(null);
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;
  const liveS = () => getStrings(settingsRef.current.language);
  const selectedTargetRef = useRef<PickTarget & { altitude: number }>(selectedTarget);
  selectedTargetRef.current = selectedTarget;
  const activeMapCoordinateRef = useRef<PickTarget | null>(activeMapCoordinate);
  activeMapCoordinateRef.current = activeMapCoordinate;
  const activeWgs84TargetRef = useRef<TargetLocation | null>(activeWgs84Target);
  activeWgs84TargetRef.current = activeWgs84Target;
  const elevationGenRef = useRef<number>(0);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>({ ...EMPTY_SNAPSHOT });
  const [events, setEvents] = useState<ProtocolEvent[]>([]);

  const [mfiStatus, setMFiStatus] = useState<MFiStatus>(() => loadMFiStatus());
  const [pairingStatus, setPairingStatus] = useState<PairingStatus>(() => getPairingStatus());
  const [favorites, setFavorites] = useState<FavoriteLocation[]>(() => loadFavorites());
  const [recents, setRecents] = useState<RecentLocation[]>(() => loadRecents());
  const [interruptedSession, setInterruptedSession] = useState<InterruptedSessionRecord | null>(() =>
    loadInterruptedSession(),
  );

  const [telemetry, setTelemetry] = useState<LiveLocationTelemetry | null>(null);

  // 配对流程与自动连接校验状态
  const [pairingInProgress, setPairingInProgress] = useState(false);
  const [pairingPIN, setPairingPIN] = useState("");
  const [pairingStepMessage, setPairingStepMessage] = useState("");
  const pairingHandleRef = useRef<OnDevicePairingHandle | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionCheckState>("idle");
  const [connectionSummary, setConnectionSummary] = useState("");
  const verifyingConnRef = useRef(false);
  const lastAutoVerifyAtRef = useRef(0);

  const lastModeRef = useRef<"probe" | "send">("send");

  // Toast
  const toastMessage = useObservable<string>("");
  const showToast = useObservable<boolean>(false);

  // 活跃会话与 LiveActivity
  const sessionRef = useRef<AccessoryLocationSession | null>(null);
  const liveActivity = useObservable(() => RelocLiveActivity());
  const lastLiveActivityKeyRef = useRef<string>("");
  const duoLiveActivityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestSnapForLiveActivityRef = useRef<{ snap: SessionSnapshot; wgs84: TargetLocation } | null>(null);
  const liveActivityEnabledRef = useRef<boolean>(settings.liveActivityEnabled);
  liveActivityEnabledRef.current = settings.liveActivityEnabled;
  const sessionStartedAtRef = useRef<number>(Date.now());
  const activePlaceNameRef = useRef<string>(selectedTarget.name || liveS().map.simulatingPlace);
  const isTelemetryTabRef = useRef<boolean>(false);
  const latestTelemetryRef = useRef<LiveLocationTelemetry | null>(null);
  const eventBufferRef = useRef<ProtocolEvent[]>([]);
  const eventFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscriptionWakeTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const didAutoReconnectSubRef = useRef<boolean>(false);
  const activeSentencesRef = useRef<number[]>([]);
  const lastKnownRealLocationRef = useRef<TargetLocation | null>(null);
  const isRestoringRef = useRef<boolean>(false);
  const stoppedWgsTargetRef = useRef<TargetLocation | null>(null);
  const restoreTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  function compactToastText(raw: string): string {
    const firstLine =
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
    if (firstLine.length <= 32) return firstLine;
    return `${firstLine.slice(0, 31)}…`;
  }

  function fireToast(message: string) {
    const compact = compactToastText(message);
    if (!compact) return;
    toastMessage.setValue(compact);
    showToast.setValue(true);
  }

  function flushBufferedEvents() {
    if (eventFlushTimerRef.current) {
      clearTimeout(eventFlushTimerRef.current);
      eventFlushTimerRef.current = null;
    }
    const batch = eventBufferRef.current;
    if (batch.length === 0) return;
    eventBufferRef.current = [];
    // 按时间正序追加到底部（对齐上游 ProtocolLogsView.swift），避免实时测试下方第一行随 ACK 频繁跳动
    setEvents((prev) => [...prev, ...batch].slice(-MAX_EVENTS));
  }

  function appendEvent(ev: ProtocolEvent) {
    eventBufferRef.current.push(ev);
    if (eventFlushTimerRef.current) return;
    eventFlushTimerRef.current = setTimeout(() => {
      eventFlushTimerRef.current = null;
      flushBufferedEvents();
    }, 300);
  }

  function refreshMFi() {
    setMFiStatus(loadMFiStatus());
  }

  function refreshPairing() {
    const next = getPairingStatus();
    setPairingStatus((prev) =>
      prev.isLoaded === next.isLoaded &&
      prev.summaryID === next.summaryID &&
      prev.deviceUDID === next.deviceUDID &&
      prev.kind === next.kind &&
      prev.deviceName === next.deviceName &&
      prev.errorMessage === next.errorMessage
        ? prev
        : next,
    );
  }

  const lastLocLogAtRef = useRef<number>(0);

  async function refreshCurrentTelemetry(verbose = false, force = true) {
    try {
      const current = await Location.requestCurrent(force ? { forceRequest: true } : undefined);
      if (current) {
        const sample: LiveLocationTelemetry = {
          latitude: current.latitude,
          longitude: current.longitude,
          timestamp: current.timestamp,
        };
        latestTelemetryRef.current = sample;
        setTelemetry(sample);
        if (!sessionRef.current && !isRestoringRef.current) {
          lastKnownRealLocationRef.current = {
            latitude: sample.latitude,
            longitude: sample.longitude,
            altitude: settingsRef.current.defaultAltitude,
            speedKnots: 0,
            courseDegrees: 0,
          };
        } else if (
          sessionRef.current &&
          lastModeRef.current === "send" &&
          activeWgs84TargetRef.current
        ) {
          sessionRef.current.markCoreLocationConfirmed(
            distanceMeters(sample, activeWgs84TargetRef.current) <= 50,
          );
        } else if (
          isRestoringRef.current &&
          stoppedWgsTargetRef.current &&
          distanceMeters(stoppedWgsTargetRef.current, sample) > 80
        ) {
          completeRealLocationRecovery(sample);
        }
        const now = Date.now();
        if (verbose || now - lastLocLogAtRef.current >= 10_000) {
          lastLocLogAtRef.current = now;
          debugLog("location", `当前定位读数 lat=${current.latitude.toFixed(6)}, lon=${current.longitude.toFixed(6)}`);
        }
      } else if (verbose) {
        debugLog("location", "requestCurrent 返回空");
      }
    } catch (error) {
      const now = Date.now();
      if (verbose || now - lastLocLogAtRef.current >= 10_000) {
        lastLocLogAtRef.current = now;
        debugLog("location", "requestCurrent 失败", describeError(error));
      }
    }
  }

  function cancelSubscriptionWakeups() {
    for (const timer of subscriptionWakeTimersRef.current) {
      clearTimeout(timer);
    }
    subscriptionWakeTimersRef.current = [];
  }

  function scheduleSubscriptionWakeups(session: AccessoryLocationSession, mode: "probe" | "send") {
    cancelSubscriptionWakeups();
    if (mode !== "send") return;

    const steps = [
      { delayMs: 1500, attempt: 1, action: "nudge" as const },
      { delayMs: 3500, attempt: 2, action: "nudge" as const },
      { delayMs: 5500, attempt: 3, action: "pulse" as const },
    ];
    for (const step of steps) {
      const id = setTimeout(() => {
        if (sessionRef.current !== session || activeSentencesRef.current.length > 0) return;
        appendEvent({
          id: `${Date.now()}-wake-${step.attempt}`,
          timestamp: new Date().toISOString(),
          name: "auto_subscription_pulse",
          detail: JSON.stringify({ attempt: step.attempt, mode: step.action }),
          isError: false,
        });
        if (step.action === "nudge") {
          void nudgeLocationSubscription();
        } else {
          void pulseLocationSubscription();
        }
      }, step.delayMs);
      subscriptionWakeTimersRef.current.push(id);
    }

    const reconnectTimer = setTimeout(() => {
      if (sessionRef.current !== session || activeSentencesRef.current.length > 0) return;
      if (!didAutoReconnectSubRef.current) {
        didAutoReconnectSubRef.current = true;
        appendEvent({
          id: `${Date.now()}-wake-reconnect`,
          timestamp: new Date().toISOString(),
          name: "auto_subscription_reconnect",
          detail: JSON.stringify({ reason: "waiting_subscription_timeout" }),
          isError: false,
        });
        session.requestLinkReconnect("waiting_subscription_timeout");
      } else {
        fireToast(liveS().sessionToast.subTimeoutToast);
      }
    }, 8000);
    subscriptionWakeTimersRef.current.push(reconnectTimer);
  }

  function cancelRealLocationRecovery() {
    for (const timer of restoreTimersRef.current) {
      clearTimeout(timer);
    }
    restoreTimersRef.current = [];
    isRestoringRef.current = false;
    stoppedWgsTargetRef.current = null;
  }

  function completeRealLocationRecovery(sample: LiveLocationTelemetry) {
    if (!isRestoringRef.current) return;
    lastKnownRealLocationRef.current = {
      latitude: sample.latitude,
      longitude: sample.longitude,
      altitude: settingsRef.current.defaultAltitude,
      speedKnots: 0,
      courseDegrees: 0,
    };
    cancelRealLocationRecovery();
    appendEvent({
      id: `${Date.now()}-real-restored`,
      timestamp: new Date().toISOString(),
      name: "real_location_restored",
      detail: JSON.stringify({
        lat: Number(sample.latitude.toFixed(5)),
        lon: Number(sample.longitude.toFixed(5)),
      }),
      isError: false,
    });
    fireToast(liveS().sessionToast.realRestored);
    void stopLocationMonitorUpdates();
  }

  function beginRealLocationRecovery(stoppedTarget: TargetLocation) {
    cancelRealLocationRecovery();
    isRestoringRef.current = true;
    stoppedWgsTargetRef.current = stoppedTarget;

    // 对齐上游 v1.0.2 beginRealLocationRecovery：等退位报文落盘后脉冲拉取本机真实定位冲刷缓存
    const t1 = setTimeout(() => {
      if (!isRestoringRef.current || sessionRef.current) return;
      appendEvent({
        id: `${Date.now()}-real-recovery-start`,
        timestamp: new Date().toISOString(),
        name: "real_location_recovery_started",
        detail: JSON.stringify({ reason: "stop_session" }),
        isError: false,
      });
      void startLocationMonitorUpdates()
        .then(() => pulseLocationSubscription())
        .then(() => refreshCurrentTelemetry());
    }, 650);

    const t2 = setTimeout(() => {
      if (!isRestoringRef.current || sessionRef.current) return;
      void pulseLocationSubscription().then(() => refreshCurrentTelemetry());
    }, 3500);

    const t3 = setTimeout(() => {
      if (!isRestoringRef.current || sessionRef.current) return;
      appendEvent({
        id: `${Date.now()}-real-recovery-pending`,
        timestamp: new Date().toISOString(),
        name: "real_location_recovery_pending",
        detail: JSON.stringify({ hint: "toggle_location_services_if_indoors" }),
        isError: false,
      });
      fireToast(liveS().sessionToast.realRecoveryHint);
    }, 7500);

    const t4 = setTimeout(() => {
      if (!isRestoringRef.current || sessionRef.current) return;
      cancelRealLocationRecovery();
      void stopLocationMonitorUpdates();
    }, 12_000);

    restoreTimersRef.current.push(t1, t2, t3, t4);
  }

  function stopDuoLiveActivityTimer() {
    if (duoLiveActivityTimerRef.current) {
      clearInterval(duoLiveActivityTimerRef.current);
      duoLiveActivityTimerRef.current = null;
    }
  }

  function liveActivityStateFrom(
    snap: SessionSnapshot,
    placeName: string,
    wgs84: TargetLocation,
    language = settingsRef.current.language,
  ): RelocActivityState {
    const la = getStrings(language).liveActivity;
    let label = la.connecting;
    if (snap.lastError) label = la.reconnecting;
    else if (snap.authenticated && snap.activeSentences.length > 0) {
      label = snap.mode === "probe" ? la.probeReady : la.simulating;
    } else if (snap.authenticated) {
      label = la.waitSub;
    } else if (snap.identified) {
      label = la.mfiAuth;
    }
    return {
      kind: "simulation",
      placeName,
      latitude: wgs84.latitude,
      longitude: wgs84.longitude,
      statusLabel: label,
      packetsAcknowledged: snap.packetsAcknowledged,
      startedAt: sessionStartedAtRef.current,
      now: Date.now(),
      isDuo: isIPhoneDuo(),
      isError: Boolean(snap.lastError),
    };
  }

  async function startSimulationLiveActivity(
    placeName: string,
    wgs84: TargetLocation,
    snap: SessionSnapshot,
  ) {
    stopDuoLiveActivityTimer();
    latestSnapForLiveActivityRef.current = { snap, wgs84 };
    if (!liveActivityEnabledRef.current) return;
    try {
      const allowed = await LiveActivity.areActivitiesEnabled();
      debugLog("liveactivity", `areActivitiesEnabled=${allowed}`);
      if (!allowed) {
        fireToast(liveS().sessionToast.liveActivityDisabled);
        return;
      }
      await LiveActivity.endAllActivities({ dismissTimeInterval: 0 }).catch(() => undefined);
      const fresh = RelocLiveActivity();
      liveActivity.setValue(fresh);
      const initial = liveActivityStateFrom(snap, placeName, wgs84);
      lastLiveActivityKeyRef.current = liveActivityUpdateKey({
        ...initial,
        duo: Boolean(initial.isDuo),
      });
      await fresh.start(initial);
      if (initial.isDuo) {
        // iPhone Duo 竖向灵动岛使用双行文本展示时长，仅在 Duo 设备上每秒刷新一次状态
        duoLiveActivityTimerRef.current = setInterval(() => {
          const latest = latestSnapForLiveActivityRef.current;
          if (!latest || !sessionRef.current || !liveActivityEnabledRef.current) return;
          void updateSimulationLiveActivity(latest.snap, latest.wgs84);
        }, 1000);
      }
    } catch (error) {
      debugLog("liveactivity", "启动模拟实时活动失败", describeError(error));
      fireToast(formatText(liveS().sessionToast.liveActivityFailed, describeError(error)));
    }
  }

  async function updateSimulationLiveActivity(
    snap: SessionSnapshot,
    wgs84: TargetLocation,
    force = false,
    language = settingsRef.current.language,
  ) {
    latestSnapForLiveActivityRef.current = { snap, wgs84 };
    if (!liveActivityEnabledRef.current) return;
    try {
      const next = liveActivityStateFrom(snap, activePlaceNameRef.current, wgs84, language);
      const key = liveActivityUpdateKey({
        ...next,
        duo: Boolean(next.isDuo),
      });
      if (!force && key === lastLiveActivityKeyRef.current) return;
      lastLiveActivityKeyRef.current = key;
      await liveActivity.value.update(next);
    } catch {
      // 用户手动关闭卡片时忽略更新错误
    }
  }

  async function stopAllLiveActivities() {
    stopDuoLiveActivityTimer();
    latestSnapForLiveActivityRef.current = null;
    lastLiveActivityKeyRef.current = "";
    await LiveActivity.endAllActivities({ dismissTimeInterval: 0 }).catch(() => undefined);
  }

  // 启动时扫描本地 MFi 目录 + 注册 Location、Tab 监听与 ScriptSession
  useEffect(() => {
    if (isUnsupportedIPad) return;

    if (!loadMFiStatus().isLoaded) {
      const found = scanLocalMFiDirectory();
      if (found) {
        setMFiStatus(found.status);
        fireToast(formatText(liveS().sessionToast.autoLoadedMFi, found.status.leafSubject ?? ""));
      }
    }

    if (props.shared && typeof props.shared.altitude !== "number") {
      resolveElevationForTarget(selectedTargetRef.current);
    }

    const onLoc = (loc: { latitude: number; longitude: number; timestamp: number }) => {
      const prev = latestTelemetryRef.current;
      const sample: LiveLocationTelemetry = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: loc.timestamp,
      };
      const samePoint =
        prev !== null &&
        Math.abs(prev.latitude - sample.latitude) < 1e-6 &&
        Math.abs(prev.longitude - sample.longitude) < 1e-6 &&
        sample.timestamp - prev.timestamp < 4000;
      latestTelemetryRef.current = sample;
      if (!prev || distanceMeters(prev, sample) > 50) {
        debugLog("location", `监听定位更新 lat=${sample.latitude.toFixed(5)}, lon=${sample.longitude.toFixed(5)}`);
      }
      if (!sessionRef.current && !isRestoringRef.current) {
        lastKnownRealLocationRef.current = {
          latitude: sample.latitude,
          longitude: sample.longitude,
          altitude: settingsRef.current.defaultAltitude,
          speedKnots: 0,
          courseDegrees: 0,
        };
      } else if (
        sessionRef.current &&
        lastModeRef.current === "send" &&
        activeWgs84TargetRef.current
      ) {
        sessionRef.current.markCoreLocationConfirmed(
          distanceMeters(sample, activeWgs84TargetRef.current) <= 50,
        );
      } else if (
        isRestoringRef.current &&
        stoppedWgsTargetRef.current &&
        distanceMeters(stoppedWgsTargetRef.current, sample) > 80
      ) {
        completeRealLocationRecovery(sample);
      }
      // 在实测日志页或会话运行期间同步更新 telemetry，确保地图底卡实时显示生效偏差；坐标未明显变化时不触发多余重绘
      if ((isTelemetryTabRef.current || sessionRef.current !== null) && !samePoint) {
        setTelemetry(sample);
      }
    };
    Location.addLocationListener(onLoc);

    const onTabChanged = (tab: number) => {
      if (isHomeScreen) {
        setHomeTab(tab);
      }
      const onTelemetry = tab === 2;
      isTelemetryTabRef.current = onTelemetry;
      if (onTelemetry) {
        if (latestTelemetryRef.current) {
          setTelemetry(latestTelemetryRef.current);
        } else {
          void refreshCurrentTelemetry();
        }
      }
    };
    tabSelection.subscribe(onTabChanged);

    let sid: string | null = null;
    if (Script.env === "index" || Script.env === "home_screen") {
      try {
        sid = ScriptSession.register(async (msg) => {
          const action =
            msg && typeof msg === "object" && "type" in msg
              ? (msg as { type?: unknown }).type
              : undefined;
          if (action === "stop") {
            await stopSession();
            return { ok: true, message: null };
          }
          return { ok: false, message: "未知请求" };
        });
        saveSessionID(sid);
      } catch (error) {
        debugLog("session", "ScriptSession.register 跳过（可能已有活跃主会话）", describeError(error));
      }
    }

    return () => {
      Location.removeLocationListener(onLoc);
      tabSelection.unsubscribe(onTabChanged);
      cancelSubscriptionWakeups();
      cancelRealLocationRecovery();
      stopDuoLiveActivityTimer();
      latestSnapForLiveActivityRef.current = null;
      if (eventFlushTimerRef.current) {
        clearTimeout(eventFlushTimerRef.current);
        eventFlushTimerRef.current = null;
      }
      if (sid !== null) {
        try {
          ScriptSession.unregister(sid);
        } catch {
          // 忽略重复或已失效会话的注销异常
        }
        clearSessionID();
      }
      pairingHandleRef.current?.cancel("页面卸载");
      void sessionRef.current?.stop();
      void stopLocationMonitorUpdates();
      void releaseKeepAlive("session");
      void releaseKeepAlive("pairing");
    };
  }, [isUnsupportedIPad]);

  function resolveElevationForTarget(target: PickTarget & { altitude: number }) {
    const gen = ++elevationGenRef.current;
    setResolvingAltitude(true);
    const wgs = mapCoordToDeviceWgs84(
      target.latitude,
      target.longitude,
      settingsRef.current.gcj02CorrectionEnabled,
    );
    void fetchTerrainElevation(wgs.latitude, wgs.longitude)
      .then((alt) => {
        if (elevationGenRef.current !== gen || alt === null) return;
        const latest = selectedTargetRef.current;
        if (
          Math.abs(latest.latitude - target.latitude) > 1e-5 ||
          Math.abs(latest.longitude - target.longitude) > 1e-5
        ) {
          return;
        }
        const updated: PickTarget & { altitude: number } = { ...latest, altitude: alt };
        setSelectedTarget(updated);
        saveLastLocation(updated);
        const session = sessionRef.current;
        const activeMap = activeMapCoordinateRef.current;
        if (
          session &&
          lastModeRef.current === "send" &&
          activeMap &&
          Math.abs(activeMap.latitude - updated.latitude) < 1e-5 &&
          Math.abs(activeMap.longitude - updated.longitude) < 1e-5
        ) {
          const wgsUpdated = buildTargetWgs84(updated, settingsRef.current);
          session.locationBox.set(wgsUpdated);
          setActiveWgs84Target(wgsUpdated);
        }
      })
      .finally(() => {
        if (elevationGenRef.current === gen) {
          setResolvingAltitude(false);
        }
      });
  }

  function selectTarget(next: PickTarget & { altitude: number }, resolveAltitude?: boolean) {
    if (resolveAltitude === undefined) {
      setSelectedTarget((prev) => {
        const sameCoord =
          Math.abs(prev.latitude - next.latitude) < 1e-5 &&
          Math.abs(prev.longitude - next.longitude) < 1e-5;
        const merged = sameCoord ? { ...next, altitude: prev.altitude } : next;
        saveLastLocation(merged);
        return merged;
      });
      return;
    }
    setSelectedTarget(next);
    saveLastLocation(next);
    if (resolveAltitude) {
      resolveElevationForTarget(next);
    } else {
      elevationGenRef.current += 1;
      setResolvingAltitude(false);
    }
  }

  function buildTargetWgs84(target: PickTarget & { altitude: number }, cfg = settings): TargetLocation {
    const wgs = mapCoordToDeviceWgs84(
      target.latitude,
      target.longitude,
      cfg.gcj02CorrectionEnabled,
    );
    return {
      latitude: wgs.latitude,
      longitude: wgs.longitude,
      altitude: Number.isFinite(target.altitude) ? target.altitude : cfg.defaultAltitude,
      speedKnots: 0,
      courseDegrees: 0,
    };
  }

  async function notifyConnectionFailureToast(err: unknown) {
    try {
      const net = await Device.getNetworkState();
      if (net.interfaces.includes("cellular") && !net.interfaces.includes("wifi")) {
        fireToast(liveS().sessionToast.cellularGuide);
        return;
      }
    } catch {
      // 忽略网络状态读取失败，直接展示简洁错误提示
    }
    fireToast(formatText(liveS().sessionToast.connError, describeError(err)));
  }

  async function startSession(
    mode: "probe" | "send",
    overrideTarget?: PickTarget & { altitude: number },
  ) {
    const signer = loadMFiSigner();
    if (!signer) {
      fireToast(liveS().sessionToast.missingMFi);
      tabSelection.setValue(1);
      return;
    }

    if (sessionRef.current) {
      await sessionRef.current.stop();
      sessionRef.current = null;
    }

    const target = overrideTarget ?? selectedTarget;
    lastModeRef.current = mode;
    const wgsTarget = buildTargetWgs84(target);
    const placeName = target.name || formatLatLon(target.latitude, target.longitude, 5);
    activePlaceNameRef.current = placeName;
    sessionStartedAtRef.current = Date.now();

    setActiveWgs84Target(wgsTarget);
    setActiveMapCoordinate(mode === "send" ? { ...target } : null);
    setSnapshot({
      ...EMPTY_SNAPSHOT,
      isRunning: true,
      mode,
    });

    if (mode === "send") {
      saveLastLocation(target);
      setRecents(
        addRecent({
          name: placeName,
          subtitle: target.address,
          latitude: target.latitude,
          longitude: target.longitude,
          altitude: target.altitude,
        }),
      );
      const interrupted: InterruptedSessionRecord = {
        placeName,
        latitude: target.latitude,
        longitude: target.longitude,
        altitude: target.altitude,
        savedAt: new Date().toISOString(),
      };
      saveInterruptedSession(interrupted);
      setInterruptedSession(null);
    }

    if (settings.backgroundKeepAliveEnabled) {
      try {
        await retainKeepAlive("session");
      } catch (error) {
        debugLog("keepalive", "会话申请保活失败", describeError(error));
      }
    }
    didAutoReconnectSubRef.current = false;
    activeSentencesRef.current = [];
    cancelSubscriptionWakeups();
    cancelRealLocationRecovery();
    await startSimulationLiveActivity(placeName, wgsTarget, {
      ...EMPTY_SNAPSHOT,
      isRunning: true,
      mode,
    });

    const session = new AccessoryLocationSession(
      wgsTarget,
      (ev) => appendEvent(ev),
      (nextSnap) => {
        activeSentencesRef.current = nextSnap.activeSentences;
        setSnapshot(nextSnap);
        void updateSimulationLiveActivity(nextSnap, session.locationBox.get());
        if (!nextSnap.isRunning && sessionRef.current === session) {
          sessionRef.current = null;
          activeSentencesRef.current = [];
          cancelSubscriptionWakeups();
          flushBufferedEvents();
          setActiveMapCoordinate(null);
          clearInterruptedSession();
          void stopLocationMonitorUpdates();
          void releaseKeepAlive("session");
          void stopAllLiveActivities();
          if (nextSnap.lastError) {
            fireToast(formatText(liveS().sessionToast.sessionEnded, nextSnap.lastError));
          } else if (nextSnap.mode === "probe") {
            fireToast(liveS().sessionToast.probeDone);
          }
        }
      },
      () => {
        void refreshKeepAliveAfterLocationToggle();
        appendEvent({
          id: `${Date.now()}-restarted`,
          timestamp: new Date().toISOString(),
          name: "location_subscription_restarted",
          detail: "iOS 重新启用了位置订阅 (0xFFFC -> 0xFFFA)，已重建后台定位与保活",
          isError: false,
        });
      },
      (err) => {
        debugLog("cellular", "连接或隧道异常", describeError(err));
        void notifyConnectionFailureToast(err);
      },
      () => {
        // 对齐上游 Reloc：MFi 鉴权通过 (0xAA05) 后启用导航级定位订阅与纯定位后台保活
        void startLocationMonitorUpdates()
          .then(() => {
            if (settingsRef.current.backgroundKeepAliveEnabled && sessionRef.current === session) {
              return retainKeepAlive("session");
            }
          })
          .catch((error) => {
            debugLog("keepalive", "鉴权后升级定位订阅失败", describeError(error));
          });
        scheduleSubscriptionWakeups(session, mode);
      },
      () => {
        cancelSubscriptionWakeups();
      },
      () => {
        activeSentencesRef.current = [];
      },
    );

    sessionRef.current = session;
    session.setFallbackRealLocation(lastKnownRealLocationRef.current);
    session.start({
      configuration: buildSessionConfigFromSettings(settings, mode),
      pairing: loadPairing(),
      mfiSigner: signer,
    });
  }

  function updateRunningLocation() {
    const session = sessionRef.current;
    if (!session) return;
    const wgsTarget = buildTargetWgs84(selectedTarget);
    const placeName = selectedTarget.name || formatLatLon(selectedTarget.latitude, selectedTarget.longitude, 5);
    activePlaceNameRef.current = placeName;

    session.locationBox.set(wgsTarget);
    session.notifyLocationUpdated(true, 10);
    setActiveWgs84Target(wgsTarget);
    setActiveMapCoordinate({ ...selectedTarget });
    saveLastLocation(selectedTarget);
    setRecents(
      addRecent({
        name: placeName,
        subtitle: selectedTarget.address,
        latitude: selectedTarget.latitude,
        longitude: selectedTarget.longitude,
        altitude: selectedTarget.altitude,
      }),
    );

    saveInterruptedSession({
      placeName,
      latitude: selectedTarget.latitude,
      longitude: selectedTarget.longitude,
      altitude: selectedTarget.altitude,
      savedAt: new Date().toISOString(),
    });

    appendEvent({
      id: `${Date.now()}-update`,
      timestamp: new Date().toISOString(),
      name: "target_location_updated",
      detail: JSON.stringify({
        place: placeName,
        wgs84: formatLatLon(wgsTarget.latitude, wgsTarget.longitude),
      }),
      isError: false,
    });

    void updateSimulationLiveActivity(snapshot, wgsTarget, true);
    fireToast(formatText(liveS().sessionToast.targetSwitched, placeName));
  }

  async function stopSession() {
    const session = sessionRef.current;
    const stoppedMode = lastModeRef.current;
    const stoppedTarget = activeWgs84Target ?? buildTargetWgs84(selectedTarget);
    sessionRef.current = null;
    activeSentencesRef.current = [];
    cancelSubscriptionWakeups();
    if (session) {
      await session.stop();
    }
    flushBufferedEvents();
    setActiveMapCoordinate(null);
    setActiveWgs84Target(null);
    setSnapshot({ ...EMPTY_SNAPSHOT });
    clearInterruptedSession();
    setInterruptedSession(null);
    await stopAllLiveActivities();
    await releaseKeepAlive("session");
    if (stoppedMode === "send") {
      beginRealLocationRecovery(stoppedTarget);
    } else {
      await stopLocationMonitorUpdates();
    }
  }

  function handleUpdateSettings(next: AppSettings) {
    const prevLang = resolveLanguageCode(settings.language);
    const nextLang = resolveLanguageCode(next.language);
    liveActivityEnabledRef.current = next.liveActivityEnabled;
    setSettings(next);
    saveSettings(next);
    if (!next.liveActivityEnabled) {
      void stopAllLiveActivities();
    }
    if (sessionRef.current && activeWgs84TargetRef.current) {
      void updateSimulationLiveActivity(snapshot, activeWgs84TargetRef.current, true, next.language);
    }
    if (prevLang !== nextLang) {
      const current = selectedTargetRef.current;
      const wgs = mapCoordToDeviceWgs84(
        current.latitude,
        current.longitude,
        next.gcj02CorrectionEnabled,
      );
      void reverseGeocodePlace(current.latitude, current.longitude, {
        customEndpoint: next.globalSearchEndpoint,
        wgs84Coordinate: wgs,
        language: next.language,
      })
        .then((info) => {
          const latest = selectedTargetRef.current;
          if (
            Math.abs(latest.latitude - current.latitude) > 1e-5 ||
            Math.abs(latest.longitude - current.longitude) > 1e-5
          ) {
            return;
          }
          if (info.name || info.address) {
            const updated: PickTarget & { altitude: number } = {
              ...latest,
              name: info.name ?? latest.name,
              address: info.address ?? latest.address,
            };
            setSelectedTarget(updated);
            saveLastLocation(updated);
          }
        })
        .catch(() => undefined);
    }
  }

  function handleChangeMapStyle(style: MapDisplayStyle) {
    handleUpdateSettings({ ...settings, mapStyle: style });
  }

  async function handleStartOnDevicePairing() {
    if (pairingInProgress) return;
    setPairingInProgress(true);
    setPairingStepMessage(liveS().sessionToast.pairingInit);
    let hasLease = false;
    let pairingActivity: ReturnType<typeof RelocLiveActivity> | null = null;

    try {
      const host = await createHostIdentity();
      const pin = createPIN();
      setPairingPIN(pin);
      showPiP.setValue(true);

      if (
        liveActivityEnabledRef.current &&
        (await LiveActivity.areActivitiesEnabled().catch(() => false))
      ) {
        await LiveActivity.endAllActivities({ dismissTimeInterval: 0 }).catch(() => undefined);
        pairingActivity = RelocLiveActivity();
        await pairingActivity
          .start({
            kind: "pairing",
            pin,
            placeName: "Remote Pairing",
            latitude: 0,
            longitude: 0,
            statusLabel: liveS().liveActivity.pairingWaitPin,
            packetsAcknowledged: 0,
            startedAt: Date.now(),
            now: Date.now(),
            isDuo: isIPhoneDuo(),
            isError: false,
          })
          .catch(() => undefined);
      }

      try {
        hasLease = await retainKeepAlive("pairing");
      } catch {
        hasLease = false;
      }

      setPairingStepMessage(formatText(liveS().sessionToast.pairingPinGuide, pin));

      const handle = startOnDevicePairing(host, pin, (ev) => {
        if (ev.type === "connected") {
          setPairingStepMessage(formatText(liveS().sessionToast.pairingConnected, pin));
        } else if (ev.type === "status") {
          setPairingStepMessage(ev.message);
        } else if (ev.type === "pin") {
          setPairingPIN(ev.pin);
        }
      });
      pairingHandleRef.current = handle;

      const record = await handle.promise;
      savePairing(record);
      refreshPairing();
      setPairingStepMessage("");
      fireToast(formatText(liveS().sessionToast.pairingSuccess, record.deviceName || record.identifier));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setPairingStepMessage(formatText(liveS().sessionToast.pairingIncomplete, msg));
      fireToast(formatText(liveS().sessionToast.pairingFailed, msg));
    } finally {
      pairingHandleRef.current = null;
      showPiP.setValue(false);
      setPairingPIN("");
      setPairingInProgress(false);
      if (pairingActivity) {
        await pairingActivity
          .end(
            {
              kind: "pairing",
              pin: "",
              placeName: "",
              latitude: 0,
              longitude: 0,
              statusLabel: "",
              packetsAcknowledged: 0,
              startedAt: Date.now(),
              isError: false,
            },
            { dismissTimeInterval: 0 },
          )
          .catch(() => undefined);
      }
      if (hasLease) await releaseKeepAlive("pairing");
    }
  }

  function handleCancelOnDevicePairing() {
    pairingHandleRef.current?.cancel(liveS().sessionToast.pairingCancelled);
  }

  async function handleImportPairingBytes(bytes: Uint8Array): Promise<boolean> {
    try {
      const record = await parsePairingFile(bytes);
      savePairing(record);
      refreshPairing();
      fireToast(formatText(liveS().sessionToast.importPairingOk, record.deviceName || record.identifier));
      return true;
    } catch (error) {
      fireToast(
        formatText(
          liveS().sessionToast.importPairingFail,
          error instanceof Error ? error.message : String(error),
        ),
      );
      return false;
    }
  }

  async function runConnectionCheck(silent: boolean): Promise<string> {
    if (verifyingConnRef.current || snapshot.isRunning || pairingInProgress) {
      return connectionSummary;
    }
    if (!pairingStatus.isLoaded) {
      setConnectionState("idle");
      setConnectionSummary("");
      return liveS().sessionToast.needPairingHint;
    }

    verifyingConnRef.current = true;
    setConnectionState("checking");
    if (!silent) {
      setConnectionSummary(liveS().config.testConnChecking);
    }

    try {
      const cfg = buildSessionConfigFromSettings(settings, "probe");
      const result = await verifyDeviceConnection({
        host: cfg.host,
        remotePort: cfg.remotePort,
        tunnelSource: cfg.tunnelSource,
        pairing: loadPairing(),
        silent,
      });
      const st = liveS().sessionToast;
      const summary = formatText(
        st.probeSummary,
        result.udid.slice(0, 8),
        result.port,
        result.servicesCount,
        result.carkitService || st.carkitDirectProbe,
      );
      setConnectionState("verified");
      setConnectionSummary(summary);
      if (!silent) {
        fireToast(st.probePassedToast);
      }
      return summary;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const summary = formatText(liveS().sessionToast.testFailedSummary, msg);
      setConnectionState("failed");
      setConnectionSummary(summary);
      if (!silent) {
        fireToast(summary);
      }
      throw error;
    } finally {
      verifyingConnRef.current = false;
    }
  }

  async function verifyConnectionIfNeeded(force = false) {
    if (isUnsupportedIPad || verifyingConnRef.current || snapshot.isRunning || pairingInProgress) return;
    if (!pairingStatus.isLoaded) return;
    if (!force && connectionState === "verified") return;

    const now = Date.now();
    if (!force && now - lastAutoVerifyAtRef.current < 8000) return;
    lastAutoVerifyAtRef.current = now;
    try {
      await runConnectionCheck(true);
    } catch {
      // 静默自动检测失败时只更新状态指示，不弹出打扰 Toast
    }
  }

  async function handleTestConnection(): Promise<string> {
    return runConnectionCheck(false);
  }

  const sceneActiveRef = useRef<() => void>(() => {});
  sceneActiveRef.current = () => {
    refreshPairing();
    void verifyConnectionIfNeeded(false);
    // 仅使用非强制读取同步已收敛的位置，绝不在后台触发 forceRequest: true 干扰 locationd 外设锁定
    if (sessionRef.current && lastModeRef.current === "send") {
      void refreshCurrentTelemetry(false, false);
    }
  };

  // 配置或配对状态变更时自动重新校验设备连接；切回前台时自动补检（对齐原版 Reloc）
  useEffect(() => {
    if (isUnsupportedIPad) return;
    setConnectionState("idle");
    setConnectionSummary("");
    void verifyConnectionIfNeeded(true);
  }, [isUnsupportedIPad, pairingStatus.isLoaded, pairingStatus.summaryID, settings.tunnelSource, settings.host, settings.remotePort]);

  useEffect(() => {
    if (isUnsupportedIPad) return;
    const onScene = (phase: string) => {
      if (phase === "active") {
        sceneActiveRef.current();
      }
    };
    AppEvents.scenePhase.addListener(onScene);
    return () => {
      AppEvents.scenePhase.removeListener(onScene);
    };
  }, [isUnsupportedIPad]);

  if (isUnsupportedIPad) {
    return (
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding={28}
        spacing={16}
        background="systemGroupedBackground"
      >
        <Spacer />
        <Image systemName="ipad.slash" font="largeTitle" foregroundStyle="systemOrange" />
        <Text font="title3" fontWeight="semibold" multilineTextAlignment="center">
          {s.ipad.title}
        </Text>
        <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
          {s.ipad.body}
        </Text>
        {canDismiss ? (
          <Button title={s.common.close} buttonStyle="borderedProminent" action={() => dismiss()} />
        ) : null}
        <Spacer />
      </VStack>
    );
  }

  const mapPickerProps = {
    selectedTarget,
    activeMapCoordinate,
    settings,
    snapshot,
    telemetry,
    activeWgs84Target,
    resolvingAltitude,
    mfiStatus,
    pairingStatus,
    connectionState,
    favorites,
    recents,
    interruptedSession,
    onRefreshTelemetry: () => refreshCurrentTelemetry(true, !sessionRef.current),
    onSelectTarget: selectTarget,
    onStartSpoofing: () => void startSession("send"),
    onUpdateRunningLocation: updateRunningLocation,
    onStopSpoofing: () => void stopSession(),
    onStartProbe: () => void startSession("probe"),
    onSwitchToConfig: () => tabSelection.setValue(1),
    onChangeMapStyle: handleChangeMapStyle,
    onAddFavorite: (t: PickTarget & { altitude: number }) => {
      setFavorites(
        addFavorite({
          name: t.name || formatLatLon(t.latitude, t.longitude, 5),
          subtitle: t.address,
          latitude: t.latitude,
          longitude: t.longitude,
          altitude: t.altitude,
        }),
      );
      fireToast(s.map.addedFavToast);
    },
    onRenameFavorite: (id: string, name: string) => setFavorites(renameFavorite(id, name)),
    onRemoveFavorite: (id: string) => {
      setFavorites(removeFavorite(id));
      fireToast(s.map.removedFavToast);
    },
    onClearRecents: () => {
      clearRecents();
      setRecents([]);
    },
    onResumeInterrupted: (rec: InterruptedSessionRecord) => {
      const restored: PickTarget & { altitude: number } = {
        latitude: rec.latitude,
        longitude: rec.longitude,
        altitude: rec.altitude,
        name: rec.placeName,
      };
      selectTarget(restored, false);
      setInterruptedSession(null);
      clearInterruptedSession();
      void startSession("send", restored);
    },
    onDismissInterrupted: () => {
      clearInterruptedSession();
      setInterruptedSession(null);
    },
    onToast: fireToast,
    onClose: canDismiss ? () => dismiss() : undefined,
    homeTabSwitcher: isHomeScreen
      ? { currentTab: homeTab, onSelectTab: (tab: number) => tabSelection.setValue(tab) }
      : undefined,
  };

  const configProps = {
    settings,
    mfiStatus,
    pairingStatus,
    pairingInProgress,
    pairingPIN,
    pairingStepMessage,
    connectionState,
    connectionSummary,
    isSessionRunning: snapshot.isRunning,
    onUpdateSettings: handleUpdateSettings,
    onMFiChanged: refreshMFi,
    onStartOnDevicePairing: () => void handleStartOnDevicePairing(),
    onCancelOnDevicePairing: handleCancelOnDevicePairing,
    onImportPairingBytes: handleImportPairingBytes,
    onDeletePairing: () => {
      deletePairing();
      refreshPairing();
    },
    onTestConnection: handleTestConnection,
    onToast: fireToast,
    onOpenChangelog: () => void changelog.openManually(),
    onClose: canDismiss ? () => dismiss() : undefined,
    homeTabSwitcher: isHomeScreen
      ? { currentTab: homeTab, onSelectTab: (tab: number) => tabSelection.setValue(tab) }
      : undefined,
  };

  const logsProps = {
    snapshot,
    events,
    mfiStatus,
    telemetry,
    activeWgs84Target,
    language: settings.language,
    onStartProbe: () => void startSession("probe"),
    onStartSend: () => void startSession("send"),
    onStop: () => void stopSession(),
    onRefreshTelemetry: () => void refreshCurrentTelemetry(true),
    onClearLogs: () => {
      eventBufferRef.current = [];
      if (eventFlushTimerRef.current) {
        clearTimeout(eventFlushTimerRef.current);
        eventFlushTimerRef.current = null;
      }
      setEvents([]);
      clearDebugLog();
      fireToast(s.sessionToast.clearedLogs);
    },
    onToast: fireToast,
    onClose: canDismiss ? () => dismiss() : undefined,
    homeTabSwitcher: isHomeScreen
      ? { currentTab: homeTab, onSelectTab: (tab: number) => tabSelection.setValue(tab) }
      : undefined,
  };

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      sheet={changelog.sheetConfig}
      toast={{
        content: (
          <Text
            font="subheadline"
            fontWeight="medium"
            lineLimit={2}
            multilineTextAlignment="center"
            padding={{ horizontal: 8, vertical: 2 }}
          >
            {toastMessage.value}
          </Text>
        ),
        isPresented: showToast,
        position: "top",
        duration: 2.0,
        cornerRadius: 20,
      }}
    >
      {/* 画中画悬浮 PIN 提示（配对期间切去「系统设置」时保持可见） */}
      <Group
        pip={{
          isPresented: showPiP,
          maximumUpdatesPerSecond: 2,
          content: (
            <VStack
              alignment="leading"
              spacing={6}
              padding={16}
              background="systemBackground"
              pipHideOnForeground={true}
              onPipStop={() => {
                showPiP.setValue(false);
              }}
            >
              <HStack spacing={8}>
                <Image systemName="personalhotspot" foregroundStyle="systemBlue" />
                <Text font="caption" foregroundStyle="secondaryLabel">
                  Remote Pairing PIN
                </Text>
                <Spacer />
              </HStack>
              <Text font="largeTitle" fontWeight="bold" fontDesign="monospaced">
                {pairingPIN || "------"}
              </Text>
              <Text font="caption2" foregroundStyle="secondaryLabel">
                {s.liveActivity.pairingGuide}
              </Text>
            </VStack>
          ),
        }}
      >
        <EmptyView />
      </Group>

      {isHomeScreen ? (
        <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <ZStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            opacity={homeTab === 0 ? 1 : 0}
            allowsHitTesting={homeTab === 0}
            zIndex={homeTab === 0 ? 2 : 0}
          >
            <MapPickerView {...mapPickerProps} />
          </ZStack>

          {homeTab === 1 ? (
            <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} zIndex={2}>
              <ConfigurationView {...configProps} />
            </ZStack>
          ) : null}

          {homeTab === 2 ? (
            <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} zIndex={2}>
              <ProtocolLogsView {...logsProps} />
            </ZStack>
          ) : null}
        </ZStack>
      ) : (
        <TabView selection={tabSelection} tint={RELOC_COLORS.accent}>
          <MapPickerView
            tabItem={<Label title={s.tabs.location} systemImage="location.north.circle.fill" />}
            tag={0}
            {...mapPickerProps}
          />

          <ConfigurationView
            tabItem={<Label title={s.tabs.connection} systemImage="antenna.radiowaves.left.and.right" />}
            tag={1}
            {...configProps}
          />

          <ProtocolLogsView
            tabItem={<Label title={s.tabs.logs} systemImage="waveform.path.ecg" />}
            tag={2}
            {...logsProps}
          />
        </TabView>
      )}
    </ZStack>
  );
}

async function run() {
  await Navigation.present({
    element: <App />,
    modalPresentationStyle: "fullScreen",
  });
  Script.exit();
}

if (Script.env === "index") {
  void run();
}
