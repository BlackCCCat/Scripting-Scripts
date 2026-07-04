// 设备代理 API：通过 WLOC 代理模块拦截的 gs-loc.apple.com 接口，
// 实现 save / query / clear 三类操作。模块未生效时请求会失败。

import type { ActiveLocation, DeviceApiResponse } from "../types";

declare const fetch: (input: string, init?: any) => Promise<any>;
type RequestCache = any;

// 将坐标写入设备（下次定位生效）
export async function saveToDevice(
  saveApi: string,
  latitude: number,
  longitude: number,
  accuracy: number,
): Promise<ActiveLocation> {
  const url = `${saveApi}?lon=${longitude}&lat=${latitude}&acc=${accuracy}`;
  const resp = await fetch(url, { method: "GET", cache: "no-store" as RequestCache });
  const data = (await resp.json()) as DeviceApiResponse;
  if (!data.success) throw new Error(data.error || "写入失败");
  return { longitude, latitude, accuracy };
}

// 查询设备上当前已保存的坐标
export async function queryDevice(saveApi: string): Promise<ActiveLocation | null> {
  const url = `${saveApi}?action=query`;
  const resp = await fetch(url, { method: "GET", cache: "no-store" as RequestCache });
  const data = (await resp.json()) as DeviceApiResponse;
  if (data.success && data.longitude && data.latitude) {
    return {
      longitude: parseFloat(data.longitude),
      latitude: parseFloat(data.latitude),
      accuracy: data.accuracy ? parseFloat(data.accuracy) : undefined,
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
