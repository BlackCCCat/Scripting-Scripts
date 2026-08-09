// 设备代理 API：通过 WLOC 代理模块拦截的 gs-loc.apple.com 接口，
// 实现 save / query / clear 三类操作。模块未生效时请求会失败。

import type { ActiveLocation, DeviceApiResponse } from "../types";
import { MAX_RANDOM_RADIUS } from "../constants";

declare const fetch: (input: string, init?: any) => Promise<any>;
type RequestCache = any;

function parseOptionalNumber(value: number | string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// 将坐标写入设备（下次定位生效）
export async function saveToDevice(
  saveApi: string,
  latitude: number,
  longitude: number,
  accuracy: number,
  randomRadius: number,
): Promise<ActiveLocation> {
  const radius = Number.isFinite(randomRadius)
    ? Math.min(MAX_RANDOM_RADIUS, Math.max(0, Math.round(randomRadius)))
    : 0;
  const url = `${saveApi}?lon=${longitude}&lat=${latitude}&acc=${accuracy}&randomRadius=${radius}`;
  const resp = await fetch(url, { method: "GET", cache: "no-store" as RequestCache });
  const data = (await resp.json()) as DeviceApiResponse;
  if (!data.success) throw new Error(data.error || "写入失败");
  return { longitude, latitude, accuracy, randomRadius: radius };
}

// 查询设备上当前已保存的坐标
export async function queryDevice(saveApi: string): Promise<ActiveLocation | null> {
  const url = `${saveApi}?action=query`;
  const resp = await fetch(url, { method: "GET", cache: "no-store" as RequestCache });
  const data = (await resp.json()) as DeviceApiResponse;
  const longitude = parseOptionalNumber(data.longitude);
  const latitude = parseOptionalNumber(data.latitude);
  if (data.success && longitude != null && latitude != null) {
    return {
      longitude,
      latitude,
      accuracy: parseOptionalNumber(data.accuracy),
      randomRadius: parseOptionalNumber(data.randomRadius) ?? 0,
    };
  }
  return null;
}

// 清除设备上已保存的坐标
export async function clearDevice(saveApi: string): Promise<void> {
  const url = `${saveApi}?action=clear`;
  const resp = await fetch(url, { method: "GET", cache: "no-store" as RequestCache });
  const data = (await resp.json()) as DeviceApiResponse;
  if (!data.success) throw new Error(data.error || "清除失败");
}
