import type { AppSettings, FavoriteLocation, MapDisplayStyle, SessionSnapshot, TargetLocation, TunnelSource } from "./types";

export const DEFAULT_HOST = "10.7.0.1";
export const DEFAULT_REMOTE_PORT = 49152;
export const DEFAULT_LOCKDOWN_PORT = 62078;
export const DEFAULT_SERVICE_NAME = "com.apple.carkit.service";
export const SHIM_SERVICE_NAME = "com.apple.carkit.service.shim.remote";

export const DEFAULT_SPAN = {
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

export const DEFAULT_TARGET_LOCATION: TargetLocation = {
  latitude: 37.334606,
  longitude: -122.009102,
  altitude: 20.0,
  speedKnots: 0.0,
  courseDegrees: 0.0,
};

export const DEFAULT_FAVORITES: FavoriteLocation[] = [
  {
    id: "preset-apple-park",
    name: "Apple Park",
    subtitle: "Cupertino, CA",
    latitude: 37.334606,
    longitude: -122.009102,
    altitude: 20.0,
  },
  {
    id: "preset-tokyo-station",
    name: "东京站",
    subtitle: "日本东京都千代田区",
    latitude: 35.681236,
    longitude: 139.767125,
    altitude: 10.0,
  },
  {
    id: "preset-taipei-101",
    name: "台北 101",
    subtitle: "台北市信义区",
    latitude: 25.033964,
    longitude: 121.564468,
    altitude: 12.0,
  },
];

export const DEFAULT_GLOBAL_SEARCH_ENDPOINT = "https://wloc-pages.pages.dev/api/search";

export const DEFAULT_SETTINGS: AppSettings = {
  tunnelSource: "proxyApp",
  host: DEFAULT_HOST,
  remotePort: DEFAULT_REMOTE_PORT,
  lockdownPort: DEFAULT_LOCKDOWN_PORT,
  serviceName: DEFAULT_SERVICE_NAME,
  intervalSeconds: 1.0,
  durationSeconds: 0,
  defaultAltitude: 10.0,
  gcj02CorrectionEnabled: true,
  backgroundKeepAliveEnabled: true,
  liveActivityEnabled: true,
  microJitterEnabled: false,
  mapStyle: "standard",
  globalSearchEndpoint: "",
  shortcutButtonEnabled: true,
  shortcutName: "",
};

export const EMPTY_SNAPSHOT: SessionSnapshot = {
  isRunning: false,
  mode: "send",
  lockdownConnected: false,
  linkReady: false,
  identified: false,
  authenticated: false,
  activeSentences: [],
  packetsAcknowledged: 0,
  lastError: null,
};

export const STORAGE_KEYS = {
  settings: "reloc_settings_v1",
  favorites: "reloc_favorites_v1",
  recents: "reloc_recents_v1",
  interrupted: "reloc_interrupted_v1",
  lastLocation: "reloc_last_location_v1",
  sessionID: "reloc_session_id_v1",
  pairingCacheTarget: "reloc_pairing_target_v1",
  changelogHash: "reloc_changelog_hash_v1",
} as const;

export const KEYCHAIN_KEYS = {
  pairingRecord: "reloc_pairing_record_v1",
  mfiCertificateB64: "reloc_mfi_cert_p7b_v1",
  mfiPrivateKeyB64: "reloc_mfi_key_pk8_v1",
  mfiSourceLabel: "reloc_mfi_source_label_v1",
} as const;

export const MAP_STYLE_OPTIONS: { id: MapDisplayStyle; label: string }[] = [
  { id: "standard", label: "标准" },
  { id: "satellite", label: "卫星" },
  { id: "hybrid", label: "混合" },
];

export const DURATION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "持续运行" },
  { value: 60, label: "60 秒" },
  { value: 180, label: "180 秒" },
  { value: 600, label: "600 秒" },
  { value: 1800, label: "1800 秒" },
];

export const TUNNEL_SOURCE_OPTIONS: { id: TunnelSource; label: string; detail: string }[] = [
  {
    id: "proxyApp",
    label: "外部代理回环 (10.7.0.1)",
    detail: "由 Surge / Loon / Egern / ClashMi 等提供本地回环映射，与原版 Reloc 一致。",
  },
  {
    id: "builtIn",
    label: "Scripting 内置本机隧道",
    detail: "内置完整 Remote Pairing + RSD 隧道建连，无需依赖外部 Loopback 脚本（会使用系统本地 VPN 名额）。",
  },
];

export function isInsideChina(lng: number, lat: number): boolean {
  return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
}

export const UPSTREAM_INFO = {
  name: "Reukix/Reloc",
  author: "Reukix",
  repoUrl: "https://github.com/Reukix/Reloc",
  license: "AGPL-3.0-only",
  baseTag: "v1.0.2",
  baseCommit: "8dc5aaa6b9e2599423fdb903e4edc8eecc0b9c9f",
  baseCommitShort: "8dc5aaa",
} as const;
