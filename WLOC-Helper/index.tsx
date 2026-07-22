// WLOC 虚拟定位控制面板 — 入口
// 在地图上选取坐标，通过设备代理模块写入虚拟定位。
//
// 坐标显示和操作按钮在 App 层渲染（与 Map 平级），避免 Map 的 SwiftUI 渲染隔离。

import {
  Script,
  Navigation,
  NavigationStack,
  useEffect,
  useObservable,
  useState,
  ZStack,
  VStack,
  HStack,
  Text,
  Spacer,
  Image,
  Button,
  Toggle,
  Menu,
  Form,
  Section,
  TextField,
  SecureField,
  type VirtualNode,
  type Color,
} from "scripting";
import type { AppSettings, Coordinate, FavoriteLocation, ActiveLocation, MapLayerId } from "./types";
import {
  loadFavorites,
  addFavorite,
  removeFavorite,
  clearFavorites,
  loadSettings,
  saveSettings,
} from "./utils/storage";
import { MapPage } from "./pages/MapPage";
import { SettingsPage } from "./pages/SettingsPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { useMarkdownReleaseNotesSheet } from "./components/ReleaseNotesSheet";
import { parseAndConvert } from "./utils/coords";

type SheetKind = "settings" | "favorites" | "surge" | null;
type SurgeStatus = "checking" | "disconnected" | "missing" | "ready";
type ProxyAppId = "surge" | "quantumultx" | "loon" | "stash" | "shadowrocket" | "egern";

type ProxyAppOption = {
  id: ProxyAppId;
  name: string;
  scheme?: string;
  systemImage: string;
};

type SurgeRemoteConfig = {
  remoteHost: string;
  remotePort: string;
  remotePassword: string;
};

const SURGE_MODULE_MANAGER_CONFIG_KEY = "surge_modules_manager_cfg_v1";
const WLOC_PROXY_APP_KEY = "wloc_proxy_app_v1";
const WLOC_MODULE_KEYWORDS = ["WLOC", "定位", "修改"];
const DEFAULT_WLOC_MODULE_NAME = "Apple WLOC 定位修改";
const WLOC_MODULE_NAME_CANDIDATES = [
  DEFAULT_WLOC_MODULE_NAME,
  "Apple WLOC定位修改",
  "WLOC 定位修改",
  "WLOC",
];
const WLOC_MODULE_INSTALL_URL = "https://github.com/Yu9191/wloc";
const SETTINGS_APP_URL = "App-Prefs:";
const PROXY_APP_OPTIONS: ProxyAppOption[] = [
  { id: "surge", name: "Surge", systemImage: "bolt.horizontal.circle" },
  { id: "quantumultx", name: "Quantumult X", scheme: "quantumult-x://", systemImage: "q.circle" },
  { id: "loon", name: "Loon", scheme: "loon://", systemImage: "l.circle" },
  { id: "stash", name: "Stash", scheme: "stash://", systemImage: "s.circle" },
  { id: "shadowrocket", name: "Shadowrocket", scheme: "shadowrocket://", systemImage: "paperplane.circle" },
  { id: "egern", name: "Egern", scheme: "egern://", systemImage: "e.circle" },
];

function normalizeProxyAppId(value: unknown): ProxyAppId {
  const id = String(value ?? "").trim().toLowerCase();
  return PROXY_APP_OPTIONS.some((option) => option.id === id) ? (id as ProxyAppId) : "surge";
}

function loadSelectedProxyApp(): ProxyAppId {
  try {
    return normalizeProxyAppId(Storage.get<string>(WLOC_PROXY_APP_KEY));
  } catch {
    return "surge";
  }
}

function saveSelectedProxyApp(id: ProxyAppId): void {
  Storage.set(WLOC_PROXY_APP_KEY, id);
}

function getProxyAppOption(id: ProxyAppId): ProxyAppOption {
  return PROXY_APP_OPTIONS.find((option) => option.id === id) ?? PROXY_APP_OPTIONS[0];
}

function loadSurgeRemoteConfig(): SurgeRemoteConfig {
  const fallback: SurgeRemoteConfig = {
    remoteHost: "http://127.0.0.1",
    remotePort: "6171",
    remotePassword: "",
  };

  try {
    const st: any = (globalThis as any).Storage;
    const raw = st?.get?.(SURGE_MODULE_MANAGER_CONFIG_KEY) ?? st?.getString?.(SURGE_MODULE_MANAGER_CONFIG_KEY);
    if (!raw) return fallback;
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      remoteHost: String(obj?.remoteHost ?? fallback.remoteHost).trim() || fallback.remoteHost,
      remotePort: String(obj?.remotePort ?? fallback.remotePort).trim() || fallback.remotePort,
      remotePassword: String(obj?.remotePassword ?? ""),
    };
  } catch {
    return fallback;
  }
}

function saveSurgeRemoteConfig(cfg: SurgeRemoteConfig): void {
  const fixed: SurgeRemoteConfig = {
    remoteHost: String(cfg.remoteHost ?? "").trim() || "http://127.0.0.1",
    remotePort: String(cfg.remotePort ?? "").trim() || "6171",
    remotePassword: String(cfg.remotePassword ?? ""),
  };

  const st: any = (globalThis as any).Storage;
  let existing: Record<string, any> = {};
  try {
    const raw = st?.get?.(SURGE_MODULE_MANAGER_CONFIG_KEY) ?? st?.getString?.(SURGE_MODULE_MANAGER_CONFIG_KEY);
    existing = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  } catch {
    existing = {};
  }

  const next = JSON.stringify({ ...existing, ...fixed });
  if (st?.set) st.set(SURGE_MODULE_MANAGER_CONFIG_KEY, next);
  else if (st?.setString) st.setString(SURGE_MODULE_MANAGER_CONFIG_KEY, next);
  else throw new Error("Storage API 不可用");
}

function getSurgeRemoteBaseURL(cfg: SurgeRemoteConfig): string {
  const host = String(cfg.remoteHost ?? "http://127.0.0.1").trim() || "http://127.0.0.1";
  const port = String(cfg.remotePort ?? "").trim();
  return port ? `${host.replace(/\/+$/, "")}:${port}` : "";
}

function getSurgeRemoteHeaders(cfg: SurgeRemoteConfig): Record<string, string> {
  return {
    "X-Key": String(cfg.remotePassword ?? ""),
    "Content-Type": "application/json",
  };
}

function collectEnabledNames(value: any, out = new Set<string>(), inEnabledGroup = false): Set<string> {
  if (typeof value === "string") {
    if (inEnabledGroup) {
      const name = value.trim();
      if (name) out.add(name);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEnabledNames(item, out, inEnabledGroup);
    return out;
  }
  if (value && typeof value === "object") {
    const ownName = String(value?.name ?? value?.displayName ?? value?.title ?? "").trim();
    if (ownName && value?.enabled === true) out.add(ownName);
    for (const [key, item] of Object.entries(value)) {
      if (key === "enabled") {
        if (Array.isArray(item) || (item && typeof item === "object")) {
          collectEnabledNames(item, out, true);
        }
        continue;
      }
      if (inEnabledGroup && typeof item === "boolean" && item) {
        const name = String(key).trim();
        if (name) out.add(name);
        continue;
      }
      if (item && typeof item === "object") {
        if ((item as any).enabled === true) {
          const name = String((item as any).name ?? (item as any).displayName ?? (item as any).title ?? key).trim();
          if (name) out.add(name);
        }
        collectEnabledNames(item, out, false);
      }
    }
  }
  return out;
}

function parseEnabledNames(data: any): Set<string> {
  const enabled = data?.enabled;
  if (Array.isArray(enabled)) {
    return new Set(enabled.map((x) => String(x).trim()).filter(Boolean));
  }
  if (enabled && typeof enabled === "object") {
    return new Set(
      Object.entries(enabled)
        .filter(([, value]) => !!value)
        .map(([key]) => String(key).trim())
        .filter(Boolean),
    );
  }
  return collectEnabledNames(data);
}

function normalizeModuleName(name: string): string {
  return String(name ?? "").trim().toLowerCase();
}

function isWlocModuleName(name: string): boolean {
  const normalized = normalizeModuleName(name);
  if (!normalized) return false;
  if (WLOC_MODULE_NAME_CANDIDATES.some((candidate) => normalizeModuleName(candidate) === normalized)) {
    return true;
  }
  return WLOC_MODULE_KEYWORDS.every((keyword) => name.toUpperCase().includes(keyword.toUpperCase()));
}

function findEnabledWlocModuleName(enabledNames: Set<string>): string | null {
  return Array.from(enabledNames).find(isWlocModuleName) ?? null;
}

function collectModuleNames(value: any, out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const name = value.trim();
    if (name) out.add(name);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectModuleNames(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "available" || key === "enabled" || key === "disabled" || key === "modules") {
        collectModuleNames(item, out);
        continue;
      }
      if (key === "name" || key === "displayName" || key === "title") {
        collectModuleNames(item, out);
        continue;
      }
      if (item && typeof item === "object") {
        collectModuleNames(item, out);
        continue;
      }
      if (typeof item === "boolean") {
        const name = String(key).trim();
        if (name) out.add(name);
      }
    }
  }
  return out;
}

function findWlocModuleName(data: any): string | null {
  const names = Array.from(collectModuleNames(data));
  const exact = names.find((name) =>
    WLOC_MODULE_NAME_CANDIDATES.some((candidate) => normalizeModuleName(name) === normalizeModuleName(candidate)),
  );
  if (exact) return exact;
  return names.find(isWlocModuleName) ?? null;
}

async function fetchSurgeModules(cfg: SurgeRemoteConfig): Promise<any> {
  const baseURL = getSurgeRemoteBaseURL(cfg);
  if (!baseURL) throw new Error("Surge HTTP API 未配置");

  const fetchFn: any = (globalThis as any).fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用");

  const res = await fetchFn(`${baseURL}/v1/modules`, {
    method: "GET",
    headers: getSurgeRemoteHeaders(cfg),
    allowInsecureRequest: true,
    timeout: 8,
  });
  if (!res?.ok) throw new Error(`Surge HTTP API 请求失败：${res?.status ?? "unknown"}`);
  return await res.json();
}

async function setSurgeModuleEnabled(cfg: SurgeRemoteConfig, moduleName: string, enabled: boolean): Promise<void> {
  const baseURL = getSurgeRemoteBaseURL(cfg);
  if (!baseURL) throw new Error("Surge HTTP API 未配置");

  const fetchFn: any = (globalThis as any).fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用");

  const res = await fetchFn(`${baseURL}/v1/modules`, {
    method: "POST",
    headers: getSurgeRemoteHeaders(cfg),
    body: JSON.stringify({ [moduleName]: enabled }),
    allowInsecureRequest: true,
    timeout: 8,
  });
  if (!res?.ok) throw new Error(`Surge HTTP API 请求失败：${res?.status ?? "unknown"}`);
}

async function setWlocModuleEnabled(
  cfg: SurgeRemoteConfig,
  currentModuleName: string,
  enabled: boolean,
): Promise<{ moduleName: string; enabled: boolean }> {
  const before = await fetchSurgeModules(cfg);
  const beforeEnabledNames = parseEnabledNames(before);
  const beforeEnabledWloc = findEnabledWlocModuleName(beforeEnabledNames);
  const detectedName = findWlocModuleName(before);
  const candidates = Array.from(
    new Set(
      [
        currentModuleName,
        beforeEnabledWloc,
        detectedName,
        ...WLOC_MODULE_NAME_CANDIDATES,
      ]
        .map((name) => String(name ?? "").trim())
        .filter(Boolean),
    ),
  );

  let lastError: unknown = null;
  for (const name of candidates) {
    try {
      await setSurgeModuleEnabled(cfg, name, enabled);
      const after = await fetchSurgeModules(cfg);
      const afterEnabledNames = parseEnabledNames(after);
      const afterEnabledWloc = findEnabledWlocModuleName(afterEnabledNames);

      if (enabled && afterEnabledWloc) {
        return { moduleName: afterEnabledWloc, enabled: true };
      }
      if (!enabled && !afterEnabledWloc) {
        return { moduleName: detectedName ?? beforeEnabledWloc ?? name, enabled: false };
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError) throw lastError;
  throw new Error(`Surge 接受请求但模块状态未变化。已尝试：${candidates.join("、")}`);
}

async function openExternalURL(url: string): Promise<void> {
  const Safari = (globalThis as any).Safari;
  if (Safari?.openURL) {
    const ok = await Safari.openURL(url);
    if (ok === false) throw new Error("打开 URL 失败");
    return;
  }
  if (Safari?.open) {
    const ok = await Safari.open(url);
    if (ok === false) throw new Error("打开 URL 失败");
    return;
  }
  const openURL = (globalThis as any).openURL;
  if (typeof openURL === "function") {
    const ok = await openURL(url);
    if (ok === false) throw new Error("打开 URL 失败");
    return;
  }
  throw new Error("无法打开 URL");
}

function SurgeRemoteConfigPage(props: {
  initial: SurgeRemoteConfig;
  onSave: (cfg: SurgeRemoteConfig) => void;
}) {
  const [remoteHost, setRemoteHost] = useState(props.initial.remoteHost);
  const [remotePort, setRemotePort] = useState(props.initial.remotePort);
  const [remotePassword, setRemotePassword] = useState(props.initial.remotePassword);

  function handleSave() {
    props.onSave({
      remoteHost: remoteHost.trim() || "http://127.0.0.1",
      remotePort: remotePort.trim() || "6171",
      remotePassword,
    });
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle="HTTP 远程控制"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarTrailing: <Button title="保存" action={handleSave} />,
        }}
      >
        <Form formStyle="grouped">
          <Section
            header={<Text>Surge 连接信息</Text>}
            footer={<Text foregroundStyle="tertiaryLabel">需要在 Surge 中开启 HTTP API，并填写对应端口与 X-Key 密码。</Text>}
          >
            <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Text frame={{ width: 64, alignment: "leading" as any }}>地址：</Text>
              <TextField
                title=""
                value={remoteHost}
                onChanged={setRemoteHost}
                prompt="http://127.0.0.1"
                keyboardType="URL"
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              />
            </HStack>
            <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Text frame={{ width: 64, alignment: "leading" as any }}>端口：</Text>
              <TextField
                title=""
                value={remotePort}
                onChanged={setRemotePort}
                prompt="6171"
                keyboardType="numberPad"
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              />
            </HStack>
            <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Text frame={{ width: 64, alignment: "leading" as any }}>密码：</Text>
              <SecureField
                title=""
                value={remotePassword}
                onChanged={setRemotePassword}
                prompt="X-Key"
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              />
            </HStack>
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  );
}

function App() {
  const dismiss = Navigation.useDismiss();
  const releaseNotesSheet = useMarkdownReleaseNotesSheet({
    markdownFile: "release-notes.md",
    storageKey: "wloc-helper:release-notes:last-seen-hash",
    title: "更新内容",
  });
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [favorites, setFavorites] = useState<FavoriteLocation[]>(() => loadFavorites());
  const [surgeStatus, setSurgeStatus] = useState<SurgeStatus>("checking");
  const [surgeModuleName, setSurgeModuleName] = useState("");
  const [surgeModuleEnabled, setSurgeModuleEnabledState] = useState(false);
  const [surgeBusy, setSurgeBusy] = useState(false);
  const [selectedProxyApp, setSelectedProxyApp] = useState<ProxyAppId>(() => loadSelectedProxyApp());
  const [showCredit, setShowCredit] = useState(true);

  // 当前选点（来自搜索/链接解析/收藏），供 MapPage 监听并跳转
  const pendingCoord = useObservable<Coordinate | null>(null);

  // 坐标状态（App 层管理）
  const coordLat = useObservable(0);
  const coordLng = useObservable(0);
  const coordReady = useObservable(false);
  const activeLoc = useObservable<ActiveLocation | null>(null);

  // 图层状态（App 层管理）
  const layer = useObservable<MapLayerId>(settings.defaultLayer);

  // Sheet 呈现状态
  const sheetKind = useObservable<SheetKind>(null);
  const showSheet = useObservable(false);

  // Toast
  const toastMsg = useObservable("");
  const showToast = useObservable(false);

  // Error
  const errorMsg = useObservable("");
  const showError = useObservable(false);

  function fireToast(msg: string) {
    toastMsg.setValue(msg);
    showToast.setValue(true);
  }

  function showErrorAlert(msg: string) {
    errorMsg.setValue(msg);
    showError.setValue(true);
  }

  async function refreshSurgeStatus(silent = true) {
    setSurgeBusy(true);
    try {
      const cfg = loadSurgeRemoteConfig();
      const data = await fetchSurgeModules(cfg);
      const enabledNames = parseEnabledNames(data);
      const moduleName =
        findEnabledWlocModuleName(enabledNames) ??
        findWlocModuleName(data) ??
        WLOC_MODULE_NAME_CANDIDATES.find((candidate) => enabledNames.has(candidate)) ??
        DEFAULT_WLOC_MODULE_NAME;
      setSurgeStatus("ready");
      setSurgeModuleName(moduleName);
      setSurgeModuleEnabledState(!!findEnabledWlocModuleName(enabledNames));
    } catch (e) {
      setSurgeStatus("disconnected");
      setSurgeModuleName("");
      setSurgeModuleEnabledState(false);
      if (!silent) {
        showErrorAlert(`代理未开启：${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setSurgeBusy(false);
    }
  }

  useEffect(() => {
    if (selectedProxyApp === "surge") {
      void refreshSurgeStatus(true);
    }
  }, [selectedProxyApp]);

  useEffect(() => {
    const timer = setTimeout(() => setShowCredit(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  function openSheet(kind: SheetKind) {
    sheetKind.setValue(kind);
    showSheet.setValue(true);
  }

  function closeSheet() {
    showSheet.setValue(false);
    setTimeout(() => sheetKind.setValue(null), 200);
  }

  function handleCloseApp() {
    dismiss();
  }

  function handleSelectProxyApp(id: ProxyAppId) {
    setSelectedProxyApp(id);
    saveSelectedProxyApp(id);
    if (id === "surge") {
      setSurgeStatus("checking");
      void refreshSurgeStatus(true);
    }
  }

  function cycleLayer() {
    const layers: MapLayerId[] = ["standard", "imagery", "hybrid"];
    const idx = layers.indexOf(layer.value);
    layer.setValue(layers[(idx + 1) % layers.length]);
  }

  function layerIcon(id: MapLayerId): string {
    switch (id) {
      case "imagery":
        return "globe.europe.africa.fill";
      case "hybrid":
        return "map.fill";
      case "standard":
      default:
        return "map";
    }
  }

  function handlePick(coord: Coordinate) {
    coordLat.setValue(coord.latitude);
    coordLng.setValue(coord.longitude);
    coordReady.setValue(true);
    pendingCoord.setValue(coord);
    closeSheet();
    fireToast("已定位到该坐标");
  }

  function handleCoordChange(lat: number, lng: number) {
    coordLat.setValue(lat);
    coordLng.setValue(lng);
    coordReady.setValue(true);
  }

  function handleActiveLocChange(loc: ActiveLocation | null) {
    activeLoc.setValue(loc);
  }

  async function handleAddFavorite(coord: Coordinate) {
    const name = await Dialog.prompt({
      title: "收藏此位置",
      message: `经度 ${coord.longitude.toFixed(6)}  纬度 ${coord.latitude.toFixed(6)}`,
      defaultValue: "我的收藏",
      placeholder: "备注名称（如：公司、家）",
      selectAll: true,
      confirmLabel: "保存",
      cancelLabel: "取消",
    });
    if (name == null) return;

    const trimmed = name.trim();
    if (trimmed) {
      const list = addFavorite(trimmed, coord.latitude, coord.longitude);
      setFavorites(list);
      fireToast(`已收藏：${trimmed}`);
    }
  }

  async function handleLinkParse() {
    const rawUrl = await Dialog.prompt({
      title: "解析地图链接或坐标",
      message: "支持 苹果/Google/高德/百度 地图链接或经纬度文本。高德坐标会自动转为 WGS-84。",
      placeholder: "在此粘贴地图链接或经纬度",
      selectAll: true,
      confirmLabel: "解析并定位",
      cancelLabel: "取消",
    });
    if (rawUrl == null) return;

    const trimmed = rawUrl.trim();
    if (!trimmed) return;

    try {
      const result = await parseAndConvert(trimmed);
      handlePick({ latitude: result.latitude, longitude: result.longitude });
      fireToast(result.name ? `已定位到：${result.name}` : "已成功定位");
    } catch (e) {
      await Dialog.alert({
        title: "解析失败",
        message: e instanceof Error ? e.message : String(e),
        buttonLabel: "好",
      });
    }
  }

  async function handlePickFromMap() {
    try {
      const picked = await Location.pickFromMap();
      if (picked) {
        handlePick({ latitude: picked.latitude, longitude: picked.longitude });
      }
    } catch (e) {
      showErrorAlert(`选点失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleCurrentLocation() {
    try {
      const gps = await Location.requestCurrent({ forceRequest: true });
      if (gps) {
        handlePick({ latitude: gps.latitude, longitude: gps.longitude });
        fireToast("已定位到当前位置");
      }
    } catch (e) {
      showErrorAlert(`定位失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function handleSaveSettings(next: AppSettings) {
    setSettings(next);
    saveSettings(next);
    layer.setValue(next.defaultLayer);
    closeSheet();
    fireToast("设置已保存");
  }

  function handleDeleteFav(id: string) {
    const list = removeFavorite(id);
    setFavorites(list);
    fireToast("已删除");
  }

  function handleClearAllFav() {
    clearFavorites();
    setFavorites([]);
    fireToast("已清空收藏");
  }

  function isCurrentCoordFavorited(): boolean {
    if (!coordReady.value) return false;
    return favorites.some(
      (f) =>
        Math.abs(f.latitude - coordLat.value) < 1e-6 &&
        Math.abs(f.longitude - coordLng.value) < 1e-6,
    );
  }

  function handleRemoveCurrentFavorite() {
    const fav = favorites.find(
      (f) =>
        Math.abs(f.latitude - coordLat.value) < 1e-6 &&
        Math.abs(f.longitude - coordLng.value) < 1e-6,
    );
    if (fav) {
      handleDeleteFav(fav.id);
    }
  }

  async function handleSave() {
    try {
      const { saveToDevice } = await import("./api/deviceApi");
      const loc = await saveToDevice(settings.saveApi, coordLat.value, coordLng.value, settings.accuracy);
      activeLoc.setValue(loc);
      fireToast("✓ 坐标已写入设备，下次定位生效");
    } catch (e) {
      showErrorAlert(`储存失败：${e instanceof Error ? e.message : String(e)}\n请检查 WLOC 模块配置`);
    }
  }

  async function handleClear() {
    try {
      const { clearDevice } = await import("./api/deviceApi");
      await clearDevice(settings.saveApi);
      activeLoc.setValue(null);
      fireToast("已清除设备坐标");
    } catch (e) {
      showErrorAlert(`清除失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleToggleWlocModule(nextValue: boolean) {
    if (!surgeModuleName) return;

    const previous = surgeModuleEnabled;
    const previousName = surgeModuleName;
    setSurgeModuleEnabledState(nextValue);
    setSurgeBusy(true);
    try {
      const result = await setWlocModuleEnabled(loadSurgeRemoteConfig(), surgeModuleName, nextValue);
      setSurgeModuleName(result.moduleName || surgeModuleName);
      setSurgeModuleEnabledState(result.enabled);
      setSurgeStatus("ready");
      fireToast(nextValue ? "WLOC 模块已开启" : "WLOC 模块已关闭");
    } catch (e) {
      setSurgeModuleEnabledState(previous);
      setSurgeModuleName(previousName);
      const message = e instanceof Error ? e.message : String(e);
      if (/404|400|not\s*found|不存在|未找到/i.test(message)) {
        setSurgeStatus("missing");
      } else {
        setSurgeStatus("ready");
      }
      showErrorAlert(`切换 WLOC 模块失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSurgeBusy(false);
    }
  }

  async function handleOpenWlocInstallPage() {
    try {
      await openExternalURL(WLOC_MODULE_INSTALL_URL);
    } catch (e) {
      showErrorAlert(`打开安装页面失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleOpenLocationSettings() {
    try {
      await openExternalURL(SETTINGS_APP_URL);
    } catch (e) {
      showErrorAlert(`打开设置失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleOpenCreditLink() {
    try {
      await openExternalURL(WLOC_MODULE_INSTALL_URL);
    } catch (e) {
      showErrorAlert(`打开项目页面失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleOpenSelectedProxyApp() {
    const option = getProxyAppOption(selectedProxyApp);
    if (!option.scheme) return;
    try {
      await openExternalURL(option.scheme);
    } catch (e) {
      showErrorAlert(`打开 ${option.name} 失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function handleSaveSurgeRemoteConfig(next: SurgeRemoteConfig) {
    try {
      saveSurgeRemoteConfig(next);
      closeSheet();
      fireToast("HTTP 连接信息已保存");
      void refreshSurgeStatus(false);
    } catch (e) {
      showErrorAlert(`保存 HTTP 连接信息失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function buildSheetContent(kind: SheetKind): VirtualNode | null {
    switch (kind) {
      case "settings":
        return <SettingsPage settings={settings} onSave={handleSaveSettings} />;
      case "surge":
        return (
          <SurgeRemoteConfigPage
            initial={loadSurgeRemoteConfig()}
            onSave={handleSaveSurgeRemoteConfig}
          />
        );
      case "favorites":
        return (
          <FavoritesPage
            favorites={favorites}
            active={activeLoc.value}
            onPick={(coord: Coordinate) => handlePick(coord)}
            onDelete={handleDeleteFav}
            onClearAll={handleClearAllFav}
          />
        );
      default:
        return null;
    }
  }

  const sheetContent = buildSheetContent(sheetKind.value);
  const activeSheet =
    sheetKind.value && sheetContent
      ? { content: sheetContent, isPresented: showSheet }
      : releaseNotesSheet.isPresented
        ? releaseNotesSheet
        : undefined;
  const loc = activeLoc.value;

  const topBtnSize = 24;
  const topBtnPadding = 9;

  function topBtn(icon: string, tint: Color, action: () => void) {
    return (
      <Button action={action} glassEffect="circle">
        <Image
          systemName={icon}
          foregroundStyle={tint}
          frame={{ width: topBtnSize, height: topBtnSize }}
          padding={topBtnPadding}
        />
      </Button>
    );
  }

  function proxyAppMenu() {
    const selected = getProxyAppOption(selectedProxyApp);
    return (
      <Menu
        label={(
          <Image
            systemName={selected.systemImage}
            foregroundStyle={selectedProxyApp === "surge" ? "systemGreen" : "systemBlue"}
            frame={{ width: topBtnSize, height: topBtnSize }}
            padding={topBtnPadding}
            glassEffect="circle"
          />
        )}
      >
        {PROXY_APP_OPTIONS.map((option) => (
          <Button
            key={option.id}
            title={option.name}
            systemImage={selectedProxyApp === option.id ? "checkmark.circle.fill" : option.systemImage}
            action={() => handleSelectProxyApp(option.id)}
          />
        ))}
      </Menu>
    );
  }

  function renderSurgeModuleControl() {
    if (surgeStatus === "checking") {
      return (
        <HStack spacing={6}>
          <Image systemName="bolt.horizontal.circle" foregroundStyle="tertiaryLabel" font="subheadline" />
          <Text font="subheadline" foregroundStyle="tertiaryLabel">
            检测中…
          </Text>
        </HStack>
      );
    }

    if (surgeStatus === "disconnected") {
      return (
        <Button action={() => openSheet("surge")} disabled={surgeBusy}>
          <HStack spacing={6}>
            <Image systemName="bolt.slash" foregroundStyle="systemOrange" font="subheadline" />
            <Text font="subheadline" foregroundStyle="systemOrange">
              代理未开启
            </Text>
          </HStack>
        </Button>
      );
    }

    if (surgeStatus === "missing") {
      return (
        <Button action={handleOpenWlocInstallPage} disabled={surgeBusy}>
          <HStack spacing={6}>
            <Image systemName="puzzlepiece.extension" foregroundStyle="systemOrange" font="subheadline" />
            <Text font="subheadline" foregroundStyle="systemOrange">
              未安装WLOC模块
            </Text>
          </HStack>
        </Button>
      );
    }

    return (
      <HStack spacing={8} frame={{ alignment: "leading" as any }}>
        <Image
          systemName={surgeModuleEnabled ? "bolt.horizontal.circle.fill" : "bolt.horizontal.circle"}
          foregroundStyle={surgeModuleEnabled ? "systemGreen" : "secondaryLabel"}
          font="subheadline"
        />
        <Text font="subheadline" foregroundStyle="label">
          WLOC
        </Text>
        <Toggle
          title=""
          value={surgeModuleEnabled}
          disabled={surgeBusy}
          toggleStyle="switch"
          frame={{ width: 52, alignment: "leading" as any }}
          onChanged={(value: boolean) => {
            void handleToggleWlocModule(value);
          }}
        />
      </HStack>
    );
  }

  function renderProxyModuleControl() {
    if (selectedProxyApp === "surge") {
      return renderSurgeModuleControl();
    }

    const option = getProxyAppOption(selectedProxyApp);
    return (
      <Button action={handleOpenSelectedProxyApp}>
        <HStack spacing={6}>
          <Image systemName={option.systemImage} foregroundStyle="systemBlue" font="subheadline" />
          <Text font="subheadline" foregroundStyle="systemBlue">
            在{option.name}中开启/关闭WLOC
          </Text>
        </HStack>
      </Button>
    );
  }

  return (
    <ZStack
      sheet={activeSheet}
      alert={{
        title: "提示",
        message: <Text>{errorMsg.value}</Text>,
        actions: <Button title="好" action={() => showError.setValue(false)} />,
        isPresented: showError,
      }}
      toast={
        toastMsg.value
          ? { message: toastMsg.value, isPresented: showToast, position: "top", duration: 2.5 }
          : undefined
      }
    >
      <MapPage
        settings={settings}
        pendingCoord={pendingCoord}
        coordLat={coordLat}
        coordLng={coordLng}
        layer={layer}
        onCycleLayer={cycleLayer}
        onCoordChange={handleCoordChange}
        onActiveLocChange={handleActiveLocChange}
      />

      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="leading">
        <HStack spacing={8} padding={{ top: 12, leading: 16, trailing: 16 }}>
          {topBtn("xmark", "systemRed", handleCloseApp)}
          {topBtn(layerIcon(layer.value), "label", cycleLayer)}
          {proxyAppMenu()}
          <Spacer />
          {topBtn("mappin.and.ellipse", "label", handlePickFromMap)}
          {topBtn("link", "label", handleLinkParse)}
          {topBtn(
            favorites.length > 0 ? "star.fill" : "star",
            favorites.length > 0 ? "systemYellow" : "label",
            () => openSheet("favorites"),
          )}
          {topBtn("gearshape", "label", () => openSheet("settings"))}
        </HStack>
        <HStack frame={{ maxWidth: "infinity" }} padding={{ trailing: 16 }}>
          <Spacer />
          {topBtn("location", "systemBlue", handleCurrentLocation)}
        </HStack>
        <Spacer />
      </VStack>

      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        alignment="leading"
        padding={{ leading: 16, trailing: 16, bottom: 0 }}
      >
        <Spacer />
        {showCredit ? (
          <Button action={handleOpenCreditLink}>
            <HStack
              spacing={6}
              padding={{ vertical: 8, leading: 12, trailing: 12 }}
            >
              <Text font="caption" foregroundStyle="secondaryLabel">致谢：</Text>
              <Text font="caption" foregroundStyle="systemBlue">Yu9191/wloc</Text>
            </HStack>
          </Button>
        ) : null}
        <VStack
          alignment="leading"
          spacing={12}
          padding={{ top: 16, bottom: 16, leading: 16, trailing: 16 }}
          frame={{ maxWidth: "infinity" }}
          glassEffect={{ type: "rect", cornerRadius: 24 }}
          shadow={{ color: "rgba(0,0,0,0.15)", radius: 20, y: -5 }}
          clipShape={{ type: "rect", cornerRadius: 24 }}
        >
          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            {renderProxyModuleControl()}
            <Spacer />
            <Button action={handleOpenLocationSettings}>
              <Image systemName="gearshape" foregroundStyle="systemBlue" font="title3" />
            </Button>
          </HStack>

          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Image systemName="mappin.and.ellipse" foregroundStyle="systemRed" font="subheadline" />
            <Text font="headline" foregroundStyle="label">
              当前坐标
            </Text>
          </HStack>

          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {coordReady.value
                ? `经度 ${coordLng.value.toFixed(6)}  纬度 ${coordLat.value.toFixed(6)}`
                : "请通过选点或地图移动来选择坐标"}
            </Text>
          </HStack>

          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Button
              action={handleSave}
              frame={{ maxWidth: "infinity" }}
              background={{ style: "systemBlue", shape: "capsule" }}
              tint="white"
            >
              <HStack spacing={4} padding={{ vertical: 9, leading: 10, trailing: 10 }}>
                <Image systemName="square.and.arrow.down" font="caption" />
                <Text font="caption" fontWeight="medium" lineLimit={1} allowsTightening>
                  储存到设备
                </Text>
              </HStack>
            </Button>
            <Button
              action={
                isCurrentCoordFavorited()
                  ? handleRemoveCurrentFavorite
                  : () => handleAddFavorite({ latitude: coordLat.value, longitude: coordLng.value })
              }
              frame={{ maxWidth: "infinity" }}
              background={{ style: isCurrentCoordFavorited() ? "systemGray" : "systemOrange", shape: "capsule" }}
              tint="white"
            >
              <HStack spacing={4} padding={{ vertical: 9, leading: 10, trailing: 10 }}>
                <Image systemName={isCurrentCoordFavorited() ? "star.slash" : "star"} font="caption" />
                <Text font="caption" fontWeight="medium" lineLimit={1} allowsTightening>
                  {isCurrentCoordFavorited() ? "取消收藏" : "收藏"}
                </Text>
              </HStack>
            </Button>
            <Button
              action={handleClear}
              disabled={!loc}
              frame={{ maxWidth: "infinity" }}
              background={{ style: "systemRed", shape: "capsule" }}
              tint="white"
              opacity={loc ? 1 : 0.45}
            >
              <HStack spacing={4} padding={{ vertical: 9, leading: 10, trailing: 10 }}>
                <Image systemName="trash" font="caption" />
                <Text font="caption" fontWeight="medium" lineLimit={1} allowsTightening>
                  移除定位
                </Text>
              </HStack>
            </Button>
          </HStack>

          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            {loc ? (
              <>
                <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" font="subheadline" />
                <Text font="subheadline" foregroundStyle="systemGreen">
                  经度 {loc.longitude.toFixed(6)} 纬度 {loc.latitude.toFixed(6)} {loc.accuracy ? `精度 ${loc.accuracy}m` : ""}
                </Text>
              </>
            ) : (
              <>
                <Image systemName="location.slash" foregroundStyle="tertiaryLabel" font="subheadline" />
                <Text font="subheadline" foregroundStyle="tertiaryLabel">
                  设备无已保存坐标
                </Text>
              </>
            )}
          </HStack>
        </VStack>
      </VStack>
    </ZStack>
  );
}

const run = async () => {
  await Navigation.present({ element: <App />, modalPresentationStyle: "fullScreen" });
  Script.exit();
};

run();
