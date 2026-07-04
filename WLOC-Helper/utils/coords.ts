// 坐标解析与转换：从地图链接（苹果/高德/Google/百度）或纯文本提取经纬度，
// 并提供 GCJ-02 ↔ WGS-84 互转。移植自 wloc worker 的 parse.js。

import type { ParsedCoord } from "../types";
import { isInsideChina } from "../constants";

/** 安全解码 URL 组件 */
export function safeDecode(s: string | null | undefined): string {
  if (!s) return "";
  try {
    return decodeURIComponent(String(s).replace(/\+/g, " "));
  } catch {
    return String(s);
  }
}

/** 保留 6 位小数 */
export function round6(n: number): number {
  return Math.round(Number(n) * 1e6) / 1e6;
}

/**
 * 从一段字符串里提取经纬度+名称。兼容：
 *  - 苹果地图 coordinate=/ll=/sll=纬度,经度（名称在 name=...）
 *  - 高德 ?p=POIID,纬度,经度,名称,城市
 *  - 高德 ?q=纬度,经度,名称（新版分享链）
 *  - Google Maps ll=/@/center=
 *  - 纯文本 纬度,经度
 */
export function extractFromString(s: string): ParsedCoord | null {
  if (!s) return null;
  const str = String(s);
  let m: RegExpMatchArray | null;

  // 苹果地图 coordinate=/ll=/sll=纬度,经度
  m = str.match(/(?:coordinate|ll|sll)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  if (m) {
    const nm = str.match(/[?&]name=([^&]+)/i);
    return { latitude: +m[1], longitude: +m[2], name: nm ? safeDecode(nm[1]) : "", src: "apple" };
  }

  // 高德 ?p=POIID,纬度,经度,名称,城市
  m = str.match(
    /[?&]p=[^,&%]*(?:,|%2C)(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i,
  );
  if (m) return { latitude: +m[1], longitude: +m[2], name: m[3] ? safeDecode(m[3]) : "", src: "amap" };

  // 高德 ?q=纬度,经度,名称
  m = str.match(
    /[?&]q=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i,
  );
  if (m) return { latitude: +m[1], longitude: +m[2], name: m[3] ? safeDecode(m[3]) : "", src: "amap" };

  // Google Maps ll=纬度,经度 / lnglat=经度,纬度
  m = str.match(/ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { latitude: +m[1], longitude: +m[2], src: "google" };
  m = str.match(/lnglat=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { latitude: +m[2], longitude: +m[1], src: "amap" };

  // @纬度,经度（Google Maps / 高德常见）
  m = str.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { latitude: +m[1], longitude: +m[2], src: "google" };

  // location=/center=经度,纬度（部分格式）
  m = str.match(/(?:location|center)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/i);
  if (m) return { latitude: +m[2], longitude: +m[1], src: "text" };

  // 纯文本 纬度,经度（自动判断顺序）
  m = str.match(/(-?\d{1,3}\.\d{4,})\s*(?:,|%2C|\s)\s*(-?\d{1,3}\.\d{4,})/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (a <= 90 && b > 90) return { latitude: a, longitude: b, src: "text" };
    if (b <= 90 && a > 90) return { latitude: b, longitude: a, src: "text" };
    return { latitude: a, longitude: b, src: "text" };
  }
  return null;
}

declare const fetch: (input: string, init?: any) => Promise<any>;

/**
 * 展开短链接：对疑似短链发 fetch 请求，跟踪 302 重定向后
 * 返回最终落地 URL。非链接或展开失败则原样返回。
 */
export async function expandShortUrl(raw: string): Promise<string> {
  const urlMatch = raw.match(/https?:\/\/[^\s'"<>]+/i);
  if (!urlMatch) return raw;
  const url = urlMatch[0];
  // 判断是否需要做网络展开：已知短链域名 / 任何不含坐标参数的 URL
  const isKnownShort = /surl\.amap\.com|amap\.com\/s\/|bit\.ly|t\.cn|dwz\.cn|url\.cn|tinyurl|j\.mp|b23\.tv|outu\.in/i.test(url);
  const hasCoordParam = /[?&](p=|q=|ll=|coordinate=|sll=|lnglat=)/i.test(url);
  // 已含坐标参数的长链无需展开；已知短链或任何无坐标参数的链接都尝试展开
  if (!isKnownShort && hasCoordParam) return raw;
  try {
    const resp = await fetch(url, {
      method: "GET",
      allowInsecureRequest: true,
      timeout: 8,
    });
    const finalUrl = resp.url;
    // 若最终 URL 与输入不同，说明发生了重定向，返回展开后的 URL
    if (finalUrl && finalUrl !== url) return finalUrl;
  } catch {
    // 网络失败则静默回退，继续尝试同步正则
  }
  return raw;
}

/**
 * 解析输入（可能含中文地名+链接），返回坐标。
 * 同步版本：不做远程请求，仅正则匹配。
 */
export function parseCoordsSync(raw: string): ParsedCoord {
  const text = String(raw || "").trim();
  if (!text) throw new Error("空输入");

  const urlMatch = text.match(/https?:\/\/[^\s'"<>]+/i);
  const target = urlMatch ? urlMatch[0] : text;

  const hit = extractFromString(target);
  if (hit) return hit;

  throw new Error("未能从链接中解析出经纬度");
}

/**
 * 解析输入，返回坐标。异步版本：
 * 先尝试同步正则，失败后展开短链再重试。
 */
export async function parseCoordsAsync(raw: string): Promise<ParsedCoord> {
  // 第一步：同步正则快速路径
  const text = String(raw || "").trim();
  if (!text) throw new Error("空输入");

  const urlMatch = text.match(/https?:\/\/[^\s'"<>]+/i);
  const target = urlMatch ? urlMatch[0] : text;
  const hit = extractFromString(target);
  if (hit) return hit;

  // 第二步：同步正则失败 → 尝试展开短链后重试
  const expanded = await expandShortUrl(raw);
  if (expanded !== raw) {
    const expUrlMatch = expanded.match(/https?:\/\/[^\s'"<>]+/i);
    const expTarget = expUrlMatch ? expUrlMatch[0] : expanded;
    const hit2 = extractFromString(expTarget);
    if (hit2) return hit2;
  }

  throw new Error("未能从链接中解析出经纬度，请确认链接是否有效");
}

// ── GCJ-02 ↔ WGS-84 转换 ──────────────────────────────────────────

const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function gcjDeltaLat(x: number, y: number): number {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return r;
}

function gcjDeltaLon(x: number, y: number): number {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return r;
}

/** WGS-84 → GCJ-02（正向偏移），与高德/苹果中国所用偏移一致 */
export function wgs84ToGcj02(lat: number, lon: number): { latitude: number; longitude: number } {
  if (!isInsideChina(lon, lat)) return { latitude: lat, longitude: lon };
  let dLat = gcjDeltaLat(lon - 105.0, lat - 35.0);
  let dLon = gcjDeltaLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { latitude: lat + dLat, longitude: lon + dLon };
}

/** GCJ-02 → WGS-84（迭代反算，亚米级精度） */
export function gcj02ToWgs84(lat: number, lon: number): { latitude: number; longitude: number } {
  if (!isInsideChina(lon, lat)) return { latitude: lat, longitude: lon };
  let wgsLat = lat;
  let wgsLon = lon;
  for (let i = 0; i < 6; i++) {
    const g = wgs84ToGcj02(wgsLat, wgsLon);
    const errLat = g.latitude - lat;
    const errLon = g.longitude - lon;
    if (Math.abs(errLat) < 1e-9 && Math.abs(errLon) < 1e-9) break;
    wgsLat -= errLat;
    wgsLon -= errLon;
  }
  return { latitude: wgsLat, longitude: wgsLon };
}

/**
 * 解析链接并按来源做坐标系转换（异步版）。
 * 高德(GCJ-02)自动转 WGS-84；苹果/Google 原样返回。
 * 内部调用 parseCoordsAsync，支持短链 302 重定向展开。
 */
export async function parseAndConvert(raw: string): Promise<ParsedCoord> {
  const hit = await parseCoordsAsync(raw);
  if (hit.src === "amap") {
    const wgs = gcj02ToWgs84(hit.latitude, hit.longitude);
    return { ...hit, latitude: round6(wgs.latitude), longitude: round6(wgs.longitude) };
  }
  return { ...hit, latitude: round6(hit.latitude), longitude: round6(hit.longitude) };
}
