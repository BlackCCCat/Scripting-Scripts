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
import { RelocLiveActivity, type RelocActivityState } from "./live_activity";
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
import { formatLatLon, mapCoordToDeviceWgs84, round6 } from "./utils/coords";
import {
  refreshKeepAliveAfterLocationToggle,
  releaseKeepAlive,
  retainKeepAlive,
  startLocationMonitorUpdates,
  stopLocationMonitorUpdates,
} from "./utils/keepalive";
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

export function App(props: { shared?: { latitude: number; longitude: number; name?: string } }) {
  const dismiss = Navigation.useDismiss();
  const canDismiss = Script.env !== "home_screen";
  const isUnsupportedIPad =
    typeof Device !== "undefined" &&
    typeof Device.hardwareModel === "string" &&
    Device.hardwareModel.startsWith("iPad");
  const tabSelection = useObservable<number>(0);
  const showPiP = useObservable<boolean>(false);
  const changelog = useMarkdownChangelogSheet({ title: "更新说明" });

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [selectedTarget, setSelectedTarget] = useState<PickTarget & { altitude: number }>(() => {
    if (props.shared) {
      return {
        latitude: round6(props.shared.latitude),
        longitude: round6(props.shared.longitude),
        altitude: loadSettings().defaultAltitude,
        name: props.shared.name || "共享位置",
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
  const liveActivityEnabledRef = useRef<boolean>(settings.liveActivityEnabled);
  liveActivityEnabledRef.current = settings.liveActivityEnabled;
  const locationPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartedAtRef = useRef<number>(Date.now());
  const activePlaceNameRef = useRef<string>(selectedTarget.name || "模拟位置");
  const isTelemetryTabRef = useRef<boolean>(false);
  const isSessionRunningRef = useRef<boolean>(false);
  isSessionRunningRef.current = snapshot.isRunning;
  const latestTelemetryRef = useRef<LiveLocationTelemetry | null>(null);
  const eventBufferRef = useRef<ProtocolEvent[]>([]);
  const eventFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const incoming = batch.reverse();
    setEvents((prev) => [...incoming, ...prev].slice(0, MAX_EVENTS));
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
    setPairingStatus(getPairingStatus());
  }

  const lastLocLogAtRef = useRef<number>(0);

  async function refreshCurrentTelemetry(verbose = false) {
    try {
      const current = await Location.requestCurrent({ forceRequest: true });
      if (current) {
        const sample: LiveLocationTelemetry = {
          latitude: current.latitude,
          longitude: current.longitude,
          timestamp: current.timestamp,
        };
        latestTelemetryRef.current = sample;
        setTelemetry(sample);
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

  function startLocationPoll(intervalMs = 5000) {
    if (locationPollTimerRef.current) clearInterval(locationPollTimerRef.current);
    void refreshCurrentTelemetry();
    locationPollTimerRef.current = setInterval(() => {
      void refreshCurrentTelemetry();
    }, intervalMs);
  }

  function stopLocationPoll() {
    if (locationPollTimerRef.current) {
      clearInterval(locationPollTimerRef.current);
      locationPollTimerRef.current = null;
    }
  }

  function liveActivityStateFrom(
    snap: SessionSnapshot,
    placeName: string,
    wgs84: TargetLocation,
  ): RelocActivityState {
    let label = "连接中";
    if (snap.lastError) label = "异常重连";
    else if (snap.authenticated && snap.activeSentences.length > 0) {
      label = snap.mode === "probe" ? "探测就绪" : "位置模拟中";
    } else if (snap.authenticated) {
      label = "等待定位订阅";
    } else if (snap.identified) {
      label = "MFi 认证中";
    }
    return {
      kind: "simulation",
      placeName,
      latitude: wgs84.latitude,
      longitude: wgs84.longitude,
      statusLabel: label,
      packetsAcknowledged: snap.packetsAcknowledged,
      startedAt: sessionStartedAtRef.current,
      isError: Boolean(snap.lastError),
    };
  }

  async function startSimulationLiveActivity(
    placeName: string,
    wgs84: TargetLocation,
    snap: SessionSnapshot,
  ) {
    if (!liveActivityEnabledRef.current) return;
    try {
      const allowed = await LiveActivity.areActivitiesEnabled();
      debugLog("liveactivity", `areActivitiesEnabled=${allowed}`);
      if (!allowed) {
        fireToast("实时活动未开启，请在「设置 → Scripting → 实时活动」中打开");
        return;
      }
      await LiveActivity.endAllActivities({ dismissTimeInterval: 0 }).catch(() => undefined);
      const fresh = RelocLiveActivity();
      liveActivity.setValue(fresh);
      const initial = liveActivityStateFrom(snap, placeName, wgs84);
      lastLiveActivityKeyRef.current = `${initial.statusLabel}|${initial.latitude.toFixed(5)}|${initial.longitude.toFixed(5)}|0`;
      await fresh.start(initial);
    } catch (error) {
      debugLog("liveactivity", "启动模拟实时活动失败", describeError(error));
      fireToast(`灵动岛启动失败：${describeError(error)}`);
    }
  }

  async function updateSimulationLiveActivity(
    snap: SessionSnapshot,
    wgs84: TargetLocation,
    force = false,
  ) {
    if (!liveActivityEnabledRef.current) return;
    try {
      const next = liveActivityStateFrom(snap, activePlaceNameRef.current, wgs84);
      const ackBucket = next.packetsAcknowledged === 1 ? 1 : Math.floor(next.packetsAcknowledged / 5);
      const key = `${next.statusLabel}|${next.latitude.toFixed(5)}|${next.longitude.toFixed(5)}|${ackBucket}`;
      if (!force && key === lastLiveActivityKeyRef.current) return;
      lastLiveActivityKeyRef.current = key;
      await liveActivity.value.update(next);
    } catch {
      // 用户手动关闭卡片时忽略更新错误
    }
  }

  async function stopAllLiveActivities() {
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
        fireToast(`已自动载入本地 MFi 凭据：${found.status.leafSubject ?? ""}`);
      }
    }

    const onLoc = (loc: { latitude: number; longitude: number; timestamp: number }) => {
      const sample: LiveLocationTelemetry = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: loc.timestamp,
      };
      latestTelemetryRef.current = sample;
      // 仅在实测日志页同步到 React 状态，避免在定位页/设置页每秒触发全树与地图重绘
      if (isTelemetryTabRef.current) {
        setTelemetry(sample);
      }
    };
    Location.addLocationListener(onLoc);

    const onTabChanged = (tab: number) => {
      const onTelemetry = tab === 2;
      isTelemetryTabRef.current = onTelemetry;
      if (onTelemetry) {
        if (latestTelemetryRef.current) {
          setTelemetry(latestTelemetryRef.current);
        }
        if (isSessionRunningRef.current) {
          void startLocationMonitorUpdates(true);
          startLocationPoll(5000);
        }
      } else {
        stopLocationPoll();
        if (isSessionRunningRef.current) {
          void startLocationMonitorUpdates(false);
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
      stopLocationPoll();
      pairingHandleRef.current?.cancel("页面卸载");
      void sessionRef.current?.stop();
      void stopLocationMonitorUpdates();
      void releaseKeepAlive("session");
      void releaseKeepAlive("pairing");
    };
  }, [isUnsupportedIPad]);

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
        fireToast("未连接 Wi-Fi：请先确认代理回环正常，或开关一次飞行模式后重试");
        return;
      }
    } catch {
      // 忽略网络状态读取失败，直接展示简洁错误提示
    }
    fireToast(`连接异常：${describeError(err)}`);
  }

  async function startSession(
    mode: "probe" | "send",
    overrideTarget?: PickTarget & { altitude: number },
  ) {
    const signer = loadMFiSigner();
    if (!signer) {
      fireToast("尚未加载本地 MFi 凭据（certificate.p7b + identity.pk8）");
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
    if (mode === "send" && isTelemetryTabRef.current) startLocationPoll();
    await startSimulationLiveActivity(placeName, wgsTarget, {
      ...EMPTY_SNAPSHOT,
      isRunning: true,
      mode,
    });

    const session = new AccessoryLocationSession(
      wgsTarget,
      (ev) => appendEvent(ev),
      (nextSnap) => {
        setSnapshot(nextSnap);
        void updateSimulationLiveActivity(nextSnap, session.locationBox.get());
        if (!nextSnap.isRunning && sessionRef.current === session) {
          sessionRef.current = null;
          stopLocationPoll();
          flushBufferedEvents();
          setActiveMapCoordinate(null);
          clearInterruptedSession();
          void stopLocationMonitorUpdates();
          void releaseKeepAlive("session");
          void stopAllLiveActivities();
          if (nextSnap.lastError) {
            fireToast(`会话结束：${nextSnap.lastError}`);
          } else if (nextSnap.mode === "probe") {
            fireToast("探测完成：MFi 认证与 CarKit 链路正常");
          }
        }
      },
      () => {
        void refreshKeepAliveAfterLocationToggle(isTelemetryTabRef.current);
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
        // 对齐上游 Reloc v1.0.1：MFi 鉴权通过 (0xAA05) 后再启动定位订阅，避免过早耗电与系统告警
        void startLocationMonitorUpdates(isTelemetryTabRef.current)
          .then(() => {
            if (settings.backgroundKeepAliveEnabled && isSessionRunningRef.current) {
              return retainKeepAlive("session");
            }
          })
          .catch((error) => {
            debugLog("keepalive", "鉴权后升级定位订阅失败", describeError(error));
          });
      },
    );

    sessionRef.current = session;
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
    fireToast(`已切换目标至：${placeName}`);
  }

  async function stopSession() {
    const session = sessionRef.current;
    sessionRef.current = null;
    stopLocationPoll();
    if (session) {
      await session.stop();
    }
    flushBufferedEvents();
    setActiveMapCoordinate(null);
    setSnapshot({ ...EMPTY_SNAPSHOT });
    clearInterruptedSession();
    setInterruptedSession(null);
    await stopAllLiveActivities();
    await releaseKeepAlive("session");
    await stopLocationMonitorUpdates();
    if (isTelemetryTabRef.current) {
      void refreshCurrentTelemetry();
    }
  }

  function handleUpdateSettings(next: AppSettings) {
    liveActivityEnabledRef.current = next.liveActivityEnabled;
    setSettings(next);
    saveSettings(next);
    if (!next.liveActivityEnabled) {
      void stopAllLiveActivities();
    }
  }

  function handleChangeMapStyle(style: MapDisplayStyle) {
    handleUpdateSettings({ ...settings, mapStyle: style });
  }

  async function handleStartOnDevicePairing() {
    if (pairingInProgress) return;
    setPairingInProgress(true);
    setPairingStepMessage("正在准备 Bonjour 广播与 SRP 密钥…");
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
            statusLabel: "等待设置输入 PIN",
            packetsAcknowledged: 0,
            startedAt: Date.now(),
            isError: false,
          })
          .catch(() => undefined);
      }

      try {
        hasLease = await retainKeepAlive("pairing");
      } catch {
        hasLease = false;
      }

      setPairingStepMessage(
        `PIN 码 ${pin}：请前往「系统设置 → 隐私与安全性 → 开发者 → 配对」选择主机并输入 PIN`,
      );

      const handle = startOnDevicePairing(host, pin, (ev) => {
        if (ev.type === "connected") {
          setPairingStepMessage(`设备已连入，请核对并输入 PIN：${pin}`);
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
      fireToast(`✓ 配对成功：${record.deviceName || record.identifier}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setPairingStepMessage(`配对未完成：${msg}`);
      fireToast(`配对失败：${msg}`);
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
    pairingHandleRef.current?.cancel("用户取消配对");
  }

  async function handleImportPairingBytes(bytes: Uint8Array): Promise<boolean> {
    try {
      const record = await parsePairingFile(bytes);
      savePairing(record);
      refreshPairing();
      fireToast(`✓ 已导入配对记录：${record.deviceName || record.identifier}`);
      return true;
    } catch (error) {
      fireToast(`导入失败：${error instanceof Error ? error.message : String(error)}`);
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
      return "请先配对这台 iPhone 或导入配对文件";
    }

    verifyingConnRef.current = true;
    setConnectionState("checking");
    if (!silent) {
      setConnectionSummary("正在探测设备端口与 CarKit 服务…");
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
      const summary = `✓ 已连上设备 (${result.udid.slice(0, 8)}… · 端口 ${result.port})，服务数 ${result.servicesCount}，CarKit: ${result.carkitService || "未显式列出，将直连探测"}`;
      setConnectionState("verified");
      setConnectionSummary(summary);
      if (!silent) {
        fireToast("✓ 测试通过：设备与 CarKit 服务正常");
      }
      return summary;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const summary = `测试失败：${msg}`;
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
          暂不支持 iPad 设备
        </Text>
        <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
          iPadOS 缺乏 iPhone 上 CarKit / CoreLocation 虚拟配件定位的完整系统路径，当前版本仅支持在 iPhone 上运行。
        </Text>
        {canDismiss ? (
          <Button title="关闭" buttonStyle="borderedProminent" action={() => dismiss()} />
        ) : null}
        <Spacer />
      </VStack>
    );
  }

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
                系统设置 → 隐私与安全性 → 开发者 → 配对
              </Text>
            </VStack>
          ),
        }}
      >
        <EmptyView />
      </Group>

      <TabView selection={tabSelection} tint={RELOC_COLORS.accent}>
        <MapPickerView
          tabItem={<Label title="定位" systemImage="location.north.circle.fill" />}
          tag={0}
          selectedTarget={selectedTarget}
          activeMapCoordinate={activeMapCoordinate}
          settings={settings}
          snapshot={snapshot}
          mfiStatus={mfiStatus}
          pairingStatus={pairingStatus}
          connectionState={connectionState}
          favorites={favorites}
          recents={recents}
          interruptedSession={interruptedSession}
          onSelectTarget={(next) => {
            setSelectedTarget(next);
            saveLastLocation(next);
          }}
          onStartSpoofing={() => void startSession("send")}
          onUpdateRunningLocation={updateRunningLocation}
          onStopSpoofing={() => void stopSession()}
          onStartProbe={() => void startSession("probe")}
          onSwitchToConfig={() => tabSelection.setValue(1)}
          onChangeMapStyle={handleChangeMapStyle}
          onAddFavorite={(t) => {
            setFavorites(
              addFavorite({
                name: t.name || formatLatLon(t.latitude, t.longitude, 5),
                subtitle: t.address,
                latitude: t.latitude,
                longitude: t.longitude,
                altitude: t.altitude,
              }),
            );
            fireToast("已加入收藏");
          }}
          onRenameFavorite={(id, name) => setFavorites(renameFavorite(id, name))}
          onRemoveFavorite={(id) => {
            setFavorites(removeFavorite(id));
            fireToast("已移除收藏");
          }}
          onClearRecents={() => {
            clearRecents();
            setRecents([]);
          }}
          onResumeInterrupted={(rec) => {
            const restored: PickTarget & { altitude: number } = {
              latitude: rec.latitude,
              longitude: rec.longitude,
              altitude: rec.altitude,
              name: rec.placeName,
            };
            setSelectedTarget(restored);
            setInterruptedSession(null);
            clearInterruptedSession();
            void startSession("send", restored);
          }}
          onDismissInterrupted={() => {
            clearInterruptedSession();
            setInterruptedSession(null);
          }}
          onToast={fireToast}
          onClose={canDismiss ? () => dismiss() : undefined}
        />

        <ConfigurationView
          tabItem={<Label title="设备连接" systemImage="antenna.radiowaves.left.and.right" />}
          tag={1}
          settings={settings}
          mfiStatus={mfiStatus}
          pairingStatus={pairingStatus}
          pairingInProgress={pairingInProgress}
          pairingPIN={pairingPIN}
          pairingStepMessage={pairingStepMessage}
          connectionState={connectionState}
          connectionSummary={connectionSummary}
          isSessionRunning={snapshot.isRunning}
          onUpdateSettings={handleUpdateSettings}
          onMFiChanged={refreshMFi}
          onStartOnDevicePairing={() => void handleStartOnDevicePairing()}
          onCancelOnDevicePairing={handleCancelOnDevicePairing}
          onImportPairingBytes={handleImportPairingBytes}
          onDeletePairing={() => {
            deletePairing();
            refreshPairing();
          }}
          onTestConnection={handleTestConnection}
          onToast={fireToast}
          onOpenChangelog={() => void changelog.openManually()}
          onClose={canDismiss ? () => dismiss() : undefined}
        />

        <ProtocolLogsView
          tabItem={<Label title="实测与日志" systemImage="waveform.path.ecg" />}
          tag={2}
          snapshot={snapshot}
          events={events}
          mfiStatus={mfiStatus}
          telemetry={telemetry}
          activeWgs84Target={activeWgs84Target}
          onStartProbe={() => void startSession("probe")}
          onStartSend={() => void startSession("send")}
          onStop={() => void stopSession()}
          onRefreshTelemetry={() => void refreshCurrentTelemetry(true)}
          onClearLogs={() => {
            eventBufferRef.current = [];
            if (eventFlushTimerRef.current) {
              clearTimeout(eventFlushTimerRef.current);
              eventFlushTimerRef.current = null;
            }
            setEvents([]);
            clearDebugLog();
            fireToast("已清空日志");
          }}
          onToast={fireToast}
          onClose={canDismiss ? () => dismiss() : undefined}
        />
      </TabView>
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
