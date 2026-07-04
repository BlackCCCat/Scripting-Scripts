// WLOC 常量定义
import type { AppSettings, MapLayerId } from "./types";

/** 默认坐标：深圳 */
export const DEFAULT_COORDINATE = {
  latitude: 22.544577,
  longitude: 113.94114,
};

/** 默认地图缩放跨度 */
export const DEFAULT_SPAN = {
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

/** 设备代理写入接口默认地址（WLOC 模块拦截 gs-loc.apple.com） */
export const DEFAULT_SAVE_API = "https://gs-loc.apple.com/wloc-settings/save";

/** 默认精度（米） */
export const DEFAULT_ACCURACY = 25;

/** 默认应用设置 */
export const DEFAULT_SETTINGS: AppSettings = {
  saveApi: DEFAULT_SAVE_API,
  defaultLayer: "imagery",
  accuracy: DEFAULT_ACCURACY,
};

/** Storage 持久化键 */
export const STORAGE_KEYS = {
  favorites: "wloc_favorites",
  settings: "wloc_settings",
  activeCache: "wloc_active_cache",
} as const;

/** 地图图层可选项（id → 显示名） */
export const MAP_LAYER_OPTIONS: { id: MapLayerId; label: string }[] = [
  { id: "standard", label: "标准" },
  { id: "imagery", label: "卫星" },
  { id: "hybrid", label: "混合" },
];

/** 判断坐标是否处于中国大陆范围（用于 GCJ-02 偏移判断） */
export function isInsideChina(lng: number, lat: number): boolean {
  return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
}
