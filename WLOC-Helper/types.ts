// WLOC 类型定义

/** 地理坐标，等价于 MapKit 的 CLLocationCoordinate2D */
export interface Coordinate {
  latitude: number;
  longitude: number;
}

/** 收藏的位置条目 */
export interface FavoriteLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** ISO 时间字符串 */
  createdAt: string;
}

/** 设备代理返回的已保存坐标 */
export interface ActiveLocation {
  longitude: number;
  latitude: number;
  accuracy?: number;
}

/** 设备代理 save/query/clear 的统一响应 */
export interface DeviceApiResponse {
  success: boolean;
  longitude?: string;
  latitude?: string;
  accuracy?: string;
  error?: string;
}

/** 地图样式标识（对应 MapKit 样式集合） */
export type MapLayerId = "standard" | "imagery" | "hybrid";

/** 应用持久化设置 */
export interface AppSettings {
  /** 设备代理写入接口地址，默认指向 apple 的 wloc-settings/save */
  saveApi: string;
  /** 默认地图图层 */
  defaultLayer: MapLayerId;
  /** 写入时使用的精度（米） */
  accuracy: number;
}

/** 地图链接解析结果 */
export interface ParsedCoord {
  latitude: number;
  longitude: number;
  name?: string;
  src?: string;
}
