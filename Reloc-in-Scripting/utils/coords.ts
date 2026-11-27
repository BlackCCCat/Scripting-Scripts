import { isInsideChina } from "../constants";
import { CoordinateTransform } from "../core/nmea";
import type { Coordinate, ParsedCoord } from "../types";

function safeDecode(s: string | null | undefined): string {
  if (!s) return "";
  try {
    return decodeURIComponent(String(s).replace(/\+/g, " "));
  } catch {
    return String(s);
  }
}

export function round6(n: number): number {
  return Math.round(Number(n) * 1e6) / 1e6;
}

export function isValidCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

export function parseAltitudeValue(raw: string): number | undefined {
  const cleaned = raw.trim().replace(/[mM米]$/u, "").trim();
  if (!cleaned) return undefined;
  const val = Number(cleaned);
  if (!Number.isFinite(val) || val < -500 || val > 50_000) return undefined;
  return Math.round(val * 10) / 10;
}

export function extractCoordFromString(raw: string): ParsedCoord | null {
  if (!raw) return null;
  const str = String(raw);
  let m: RegExpMatchArray | null;

  // 百度地图：BD-09，先识别域名避免被通用 rule 误认
  if (/(?:^|\/\/|\.)(?:api\.)?map\.baidu\.com/i.test(str)) {
    m = str.match(/(?:location|latlng)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
    if (m) {
      const nm = str.match(/[?&](?:title|name)=([^&]+)/i);
      return {
        latitude: +m[1],
        longitude: +m[2],
        name: nm ? safeDecode(nm[1]) : "",
        src: "baidu",
      };
    }
  }

  // 明确声明了 WGS-84 的链接
  if (/(?:datum|coord_?type|coordsys)=wgs ?-?84/i.test(str)) {
    m = str.match(/(-?\d{1,3}\.\d{3,})(?:,|%2C)(-?\d{1,3}\.\d{3,})/);
    if (m) {
      const a = +m[1];
      const b = +m[2];
      const flipped = Math.abs(a) > 90 && Math.abs(b) <= 90;
      return {
        latitude: flipped ? b : a,
        longitude: flipped ? a : b,
        src: "wgs84",
      };
    }
  }

  // 苹果地图 coordinate=/ll=/sll=纬度,经度
  m = str.match(/(?:coordinate|ll|sll)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  if (m) {
    const nm = str.match(/[?&]name=([^&]+)/i);
    return {
      latitude: +m[1],
      longitude: +m[2],
      name: nm ? safeDecode(nm[1]) : "",
      src: "apple",
    };
  }

  // 高德 ?p=POIID,纬度,经度,名称,城市
  m = str.match(
    /[?&]p=[^,&%]*(?:,|%2C)(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i,
  );
  if (m) {
    return {
      latitude: +m[1],
      longitude: +m[2],
      name: m[3] ? safeDecode(m[3]) : "",
      src: "amap",
    };
  }

  // 高德 ?q=纬度,经度,名称
  m = str.match(
    /[?&]q=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i,
  );
  if (m) {
    return {
      latitude: +m[1],
      longitude: +m[2],
      name: m[3] ? safeDecode(m[3]) : "",
      src: "amap",
    };
  }

  // Google Maps ll= / lnglat= / @lat,lng
  m = str.match(/ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { latitude: +m[1], longitude: +m[2], src: "google" };

  m = str.match(/lnglat=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { latitude: +m[2], longitude: +m[1], src: "amap" };

  m = str.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { latitude: +m[1], longitude: +m[2], src: "google" };

  // 通用 location=/center=
  m = str.match(/(?:location|center)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/i);
  if (m) return { latitude: +m[2], longitude: +m[1], src: "text" };

  // 纯文本 纬度,经度[,海拔]（支持中文逗号与可选海拔 52 / 52m）
  const normalized = str.replace(/，/g, ",");
  const parts = normalized.split(",").map((p) => p.trim());
  if (parts.length === 3) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    const alt = parseAltitudeValue(parts[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && alt !== undefined) {
      if (Math.abs(a) <= 90 && Math.abs(b) > 90) return { latitude: a, longitude: b, altitude: alt, src: "text" };
      if (Math.abs(b) <= 90 && Math.abs(a) > 90) return { latitude: b, longitude: a, altitude: alt, src: "text" };
      return { latitude: a, longitude: b, altitude: alt, src: "text" };
    }
  }

  // 纯文本 纬度,经度（自动兼容 经度,纬度）
  m = normalized.match(/(-?\d{1,3}\.\d{3,})\s*(?:,|%2C|\s)\s*(-?\d{1,3}\.\d{3,})/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (Math.abs(a) <= 90 && Math.abs(b) > 90) return { latitude: a, longitude: b, src: "text" };
    if (Math.abs(b) <= 90 && Math.abs(a) > 90) return { latitude: b, longitude: a, src: "text" };
    return { latitude: a, longitude: b, src: "text" };
  }

  return null;
}

async function expandShortUrl(raw: string): Promise<string> {
  const urlMatch = raw.match(/https?:\/\/[^\s'"<>]+/i);
  if (!urlMatch) return raw;
  const url = urlMatch[0];
  const isKnownShort =
    /surl\.amap\.com|amap\.com\/s\/|maps\.app\.goo\.gl|goo\.gl\/maps|bit\.ly|t\.cn|dwz\.cn|url\.cn|tinyurl/i.test(
      url,
    );
  const hasCoordParam = /[?&](p=|q=|ll=|coordinate=|sll=|lnglat=)/i.test(url);
  if (!isKnownShort && hasCoordParam) return raw;

  try {
    const resp = await fetch(url, {
      method: "GET",
      allowInsecureRequest: true,
      timeout: 8,
    } as RequestInit);
    const finalUrl = resp.url;
    if (finalUrl && finalUrl !== url) return finalUrl;
  } catch {
    // 网络展开失败静默回退
  }
  return raw;
}

function bd09ToGcj02(lat: number, lon: number): Coordinate {
  const xPi = (Math.PI * 3000) / 180;
  const x = lon - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * xPi);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * xPi);
  return { latitude: z * Math.sin(theta), longitude: z * Math.cos(theta) };
}

/**
 * 解析地图链接或文本为应用内地图坐标系（大陆为 GCJ-02，境外为 WGS-84）。
 */
export async function parseAndConvertToMapCoord(raw: string): Promise<ParsedCoord> {
  const text = String(raw || "").trim();
  if (!text) throw new Error("请输入地图分享链接或经纬度");

  const urlMatch = text.match(/https?:\/\/[^\s'"<>]+/i);
  const target = urlMatch ? urlMatch[0] : text;
  let hit = extractCoordFromString(target);

  if (!hit && urlMatch) {
    const expanded = await expandShortUrl(raw);
    if (expanded !== raw) {
      const expMatch = expanded.match(/https?:\/\/[^\s'"<>]+/i);
      hit = extractCoordFromString(expMatch ? expMatch[0] : expanded);
    }
  }

  if (!hit) {
    throw new Error("未能从输入中解析出有效经纬度（支持 Apple / 高德 / Google / 百度链接或 纬度, 经度）");
  }

  if (!isValidCoordinate(hit.latitude, hit.longitude)) {
    throw new Error(`坐标超出合法范围（${hit.latitude}, ${hit.longitude}）`);
  }

  let latitude = hit.latitude;
  let longitude = hit.longitude;

  if (hit.src === "baidu") {
    ({ latitude, longitude } = bd09ToGcj02(latitude, longitude));
  } else if (hit.src === "wgs84") {
    ({ latitude, longitude } = CoordinateTransform.wgs84ToGCJ02(latitude, longitude));
  }

  if (!isValidCoordinate(latitude, longitude)) {
    throw new Error("坐标换算后超出合法范围");
  }

  return {
    ...hit,
    latitude: round6(latitude),
    longitude: round6(longitude),
  };
}

/**
 * 地图坐标系（中国大陆 GCJ-02）-> NMEA/iAP2 设备坐标系（WGS-84）。
 */
export function mapCoordToDeviceWgs84(
  lat: number,
  lon: number,
  gcj02CorrectionEnabled: boolean,
): Coordinate {
  if (!gcj02CorrectionEnabled) {
    return { latitude: lat, longitude: lon };
  }
  return CoordinateTransform.gcj02ToWGS84(lat, lon);
}

/**
 * 设备真实 GPS / WGS-84 坐标 -> 地图显示坐标系（中国大陆 GCJ-02）。
 */
export function deviceWgs84ToMapCoord(
  lat: number,
  lon: number,
  gcj02CorrectionEnabled: boolean,
): Coordinate {
  if (!gcj02CorrectionEnabled) {
    return { latitude: lat, longitude: lon };
  }
  return CoordinateTransform.wgs84ToGCJ02(lat, lon);
}

export function coordinateDisplayPair(
  mapLat: number,
  mapLon: number,
  gcj02CorrectionEnabled: boolean,
): { map: Coordinate; wgs84: Coordinate; needsOffset: boolean } {
  const map = { latitude: round6(mapLat), longitude: round6(mapLon) };
  const wgs = mapCoordToDeviceWgs84(mapLat, mapLon, gcj02CorrectionEnabled);
  const wgs84 = { latitude: round6(wgs.latitude), longitude: round6(wgs.longitude) };
  return {
    map,
    wgs84,
    needsOffset: gcj02CorrectionEnabled && isInsideChina(mapLon, mapLat),
  };
}

export function formatLatLon(lat: number, lon: number, decimals = 6): string {
  return `${lat.toFixed(decimals)}, ${lon.toFixed(decimals)}`;
}

/**
 * 计算两点间球面距离（米，Haversine）。
 */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/**
 * 将米数格式化为人类可读的紧凑偏差标签（<1000m 显示 m，>=1000m 显示 km）。
 */
export function formatDistanceMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "--";
  if (meters < 1000) return `${meters.toFixed(meters < 10 ? 1 : 0)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}
