import { FuelCode } from "./types"

/** 应用设置存取（基于 Storage 持久化） */

const KEY_PREFERRED_FUEL = "preferredFuel"
const KEY_SEARCH_RADIUS = "searchRadiusKm"
const KEY_LOCATION_MODE = "locationMode"
const KEY_MANUAL_PROVINCE = "manualProvince"
const KEY_LAST_AUTO_PROVINCE = "lastAutoProvince"
const PRIVATE_STORAGE = { shared: false }

export type LocationMode = "auto" | "manual"

/** 用户选择的高亮油品，默认 95 号 */
export function getPreferredFuel(): FuelCode {
  const v = Storage.get<FuelCode>(KEY_PREFERRED_FUEL, PRIVATE_STORAGE)
  if (v === "92" || v === "95" || v === "98" || v === "0") {
    return v
  }
  return "95"
}

export function setPreferredFuel(code: FuelCode): void {
  Storage.set(KEY_PREFERRED_FUEL, code, PRIVATE_STORAGE)
}

/** 附近油站搜索半径（公里），默认 5 公里 */
export const RADIUS_OPTIONS = [1, 3, 5, 10, 20]

export function getSearchRadiusKm(): number {
  const v = Storage.get<number>(KEY_SEARCH_RADIUS, PRIVATE_STORAGE)
  if (typeof v === "number" && RADIUS_OPTIONS.includes(v)) {
    return v
  }
  return 5
}

export function setSearchRadiusKm(km: number): void {
  Storage.set(KEY_SEARCH_RADIUS, km, PRIVATE_STORAGE)
}

/** 首页省份来源：自动定位或手动指定 */
export function getLocationMode(): LocationMode {
  const v = Storage.get<LocationMode>(KEY_LOCATION_MODE, PRIVATE_STORAGE)
  return v === "manual" ? "manual" : "auto"
}

export function setLocationMode(mode: LocationMode): void {
  Storage.set(KEY_LOCATION_MODE, mode, PRIVATE_STORAGE)
}

export function getManualProvinceName(): string | null {
  const v = Storage.get<string>(KEY_MANUAL_PROVINCE, PRIVATE_STORAGE)
  return typeof v === "string" && v.trim() ? v : null
}

export function setManualProvinceName(name: string): void {
  Storage.set(KEY_MANUAL_PROVINCE, name, PRIVATE_STORAGE)
}

/** 最近一次自动定位成功匹配到的省份，供小组件定位失败时兜底使用。 */
export function getLastAutoProvinceName(): string | null {
  const v = Storage.get<string>(KEY_LAST_AUTO_PROVINCE, PRIVATE_STORAGE)
  return typeof v === "string" && v.trim() ? v : null
}

export function setLastAutoProvinceName(name: string): void {
  Storage.set(KEY_LAST_AUTO_PROVINCE, name, PRIVATE_STORAGE)
}
