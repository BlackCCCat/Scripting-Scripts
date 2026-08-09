// 坐标解析与转换：在设备本地解析地图链接，并统一输出 WGS-84 坐标。
// 解析规则移植自 Yu9191/wloc worker/src/parse.js，不请求上游 Worker。

import type { Coordinate, MapSource, ParsedCoord } from "../types";
import { isInsideChina } from "../constants";

interface ExtractOptions {
  allowBare?: boolean;
}

/** 安全解码 URL 组件。 */
export function safeDecode(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(String(value).replace(/\+/g, " "));
  } catch {
    return String(value);
  }
}

/** 保留 6 位小数，约为 0.1 米精度。 */
export function round6(value: number): number {
  return Math.round(Number(value) * 1e6) / 1e6;
}

/** 校验纬度、经度值域，同时排除 NaN 和 Infinity。 */
export function inRange(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

function queryName(value: string): string {
  const match = value.match(/[?&]name=([^&]+)/i);
  return match ? safeDecode(match[1]) : "";
}

function googleName(value: string): string {
  const match = value.match(/\/maps\/place\/([^/@?]+)/);
  return match ? safeDecode(match[1]).replace(/\+/g, " ").trim() : "";
}

function baiduPathName(value: string): string {
  const match = value.match(/\/poi\/([^/@?]+)/);
  return match ? safeDecode(match[1]).trim() : "";
}

function extractRaw(value: string, options?: ExtractOptions): ParsedCoord | null {
  if (!value) return null;
  const allowBare = options?.allowBare !== false;
  const text = String(value);
  let match: RegExpMatchArray | null;

  // Apple Maps: coordinate/ll/sll 均为纬度,经度。
  match = text.match(/(?:^|[?&])(?:coordinate|ll|sll)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  if (match) {
    return {
      latitude: Number(match[1]),
      longitude: Number(match[2]),
      name: queryName(text),
      src: "apple",
    };
  }

  // Google 地点针脚坐标优先于 @ 后面的相机视口中心。
  match = text.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (match) {
    return {
      latitude: Number(match[1]),
      longitude: Number(match[2]),
      name: googleName(text),
      src: "google",
    };
  }

  // 高德 p/q 参数为纬度,经度。
  match = text.match(
    /[?&]p=[^,&%]*(?:,|%2C)(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i,
  );
  if (match) {
    return {
      latitude: Number(match[1]),
      longitude: Number(match[2]),
      name: match[3] ? safeDecode(match[3]) : "",
      src: "amap",
    };
  }

  match = text.match(
    /[?&]q=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i,
  );
  if (match) {
    return {
      latitude: Number(match[1]),
      longitude: Number(match[2]),
      name: match[3] ? safeDecode(match[3]) : "",
      src: "amap",
    };
  }

  // 高德 URI API 的 lnglat/position 为经度,纬度。
  match = text.match(/(?:^|[?&])(?:lnglat|position)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  if (match) {
    return {
      latitude: Number(match[2]),
      longitude: Number(match[1]),
      name: queryName(text),
      src: "amap",
    };
  }

  // 百度网页把 BD09MC 米制坐标放在 /poi/名称/@x,y,19z 路径中。
  match = text.match(/baidu\.com\/[^\s]*?@(-?\d{6,9}(?:\.\d+)?)(?:,|%2C)(-?\d{6,9}(?:\.\d+)?)/i);
  if (match) {
    const baidu = bd09mcToBd09(Number(match[1]), Number(match[2]));
    if (baidu) {
      return {
        ...baidu,
        name: baiduPathName(text),
        src: "baidu",
      };
    }
  }

  // Google 没有针脚坐标时，回退到相机视口中心。
  match = text.match(/\/maps\/[^\s]*@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (match) {
    return {
      latitude: Number(match[1]),
      longitude: Number(match[2]),
      name: googleName(text),
      src: "google",
    };
  }

  // 保留旧版非百度 location/center 解析兼容，参数顺序为经度,纬度。
  if (!/baidu\.com/i.test(text)) {
    match = text.match(/(?:^|[?&])(?:location|center)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
    if (match) {
      return {
        latitude: Number(match[2]),
        longitude: Number(match[1]),
        src: "text",
      };
    }
  }

  if (allowBare) {
    match = text.match(/(-?\d{1,3}\.\d{4,})\s*(?:,|%2C|\s)\s*(-?\d{1,3}\.\d{4,})/);
    if (match) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      if (Math.abs(first) <= 90 && Math.abs(second) > 90) {
        return { latitude: first, longitude: second, src: "text" };
      }
      if (Math.abs(second) <= 90 && Math.abs(first) > 90) {
        return { latitude: second, longitude: first, src: "text" };
      }
      return { latitude: first, longitude: second, src: "text" };
    }
  }

  return null;
}

/** 从链接或文本中提取坐标，但不进行坐标系换算。 */
export function extractFromString(value: string, options?: ExtractOptions): ParsedCoord | null {
  const result = extractRaw(value, options);
  return result && inRange(result.latitude, result.longitude) ? result : null;
}

function extractHttpUrl(value: string): string | null {
  return value.match(/https?:\/\/[^\s'"<>]+/i)?.[0] ?? null;
}

function isBaiduHost(value: string): boolean {
  return /https?:\/\/(?:[^/]+\.)?baidu\.com(?:[/:?#]|$)/i.test(value);
}

interface MapResponse {
  response: Response;
  redirectUrls: string[];
}

async function requestMapUrl(url: string): Promise<MapResponse> {
  const redirectUrls: string[] = [];
  const response = await fetch(url, {
    method: "GET",
    allowInsecureRequest: true,
    timeout: 8,
    headers: {
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile Safari/604.1",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh-Hans;q=0.9",
    },
    handleRedirect: async (newRequest) => {
      redirectUrls.push(newRequest.url);
      return redirectUrls.length <= 5 ? newRequest : null;
    },
  });
  return { response, redirectUrls };
}

async function readCappedBody(response: Response, byteLimit = 512 * 1024): Promise<string> {
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < byteLimit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = byteLimit - total;
      const chunk = value.length <= remaining ? value : value.slice(0, remaining);
      chunks.push(chunk);
      total += chunk.length;
      if (chunk.length < value.length) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8").decode(body);
}

/**
 * 异步解析：先走本地规则；必要时由设备直接展开短链并扫描最终 URL/页面正文。
 * 全程不调用 WLOC Worker。
 */
export async function parseCoordsAsync(raw: string): Promise<ParsedCoord> {
  const text = String(raw || "").trim();
  if (!text) throw new Error("空输入");

  const url = extractHttpUrl(text);
  const target = url ?? text;
  const direct = extractFromString(target);
  if (direct) return direct;

  let baiduLink = Boolean(url && isBaiduHost(url));
  if (url) {
    try {
      const { response, redirectUrls } = await requestMapUrl(url);
      const finalUrl = response.url || url;
      const resolvedUrls = [...redirectUrls, finalUrl];
      for (const resolvedUrl of resolvedUrls) {
        baiduLink ||= isBaiduHost(resolvedUrl);
        if (resolvedUrl !== target) {
          const fromResolvedUrl = extractFromString(resolvedUrl);
          if (fromResolvedUrl) return fromResolvedUrl;
        }
      }

      const body = await readCappedBody(response);
      const fromBody = extractFromString(body, { allowBare: false });
      if (fromBody) return fromBody;

      if (baiduLink) {
        const fromBaiduBody = extractBaiduFromBody(body);
        if (fromBaiduBody) return fromBaiduBody;
      }
    } catch {
      // 保持统一错误提示，由下面的分支说明失败原因。
    }
  }

  if (url && baiduLink) {
    throw new Error(
      "百度这条链接无法直接取得坐标。请先在浏览器打开链接，等地址栏变成 map.baidu.com/poi/名称/@数字,数字,19z 后，再复制完整地址解析。",
    );
  }
  throw new Error("未能从链接中解析出经纬度，请确认链接是否有效");
}

// 百度使用分段多项式把 BD09MC 米制坐标转换为 BD-09 经纬度。
const BAIDU_MC_BANDS = [12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0];
const BAIDU_MC_TO_LL = [
  [1.410526172116255e-8, 8.98305509648872e-6, -1.9939833816331, 200.9824383106796, -187.2403703815547, 91.6087516669843, -23.38765649603339, 2.57121317296198, -0.03801003308653, 1.73379812e7],
  [-7.435856389565537e-9, 8.983055097726239e-6, -0.78625201886289, 96.32687599759846, -1.85204757529826, -59.36935905485877, 47.40033549296737, -16.50741931063887, 2.28786674699375, 1.026014486e7],
  [-3.030883460898826e-8, 8.98305509983578e-6, 0.30071316287616, 59.74293618442277, 7.357984074871, -25.38371002664745, 13.45380521110908, -3.29883767235584, 0.32710905363475, 6.85681737e6],
  [-1.981981304930552e-8, 8.983055099779535e-6, 0.03278182852591, 40.31678527705744, 0.65659298677277, -4.44255534477492, 0.85341911805263, 0.12923347998204, -0.04625736007561, 4.48277706e6],
  [3.09191371068437e-9, 8.983055096812155e-6, 6.995724062e-5, 23.10934304144901, -0.00023663490511, -0.6321817810242, -0.00663494467273, 0.03430082397953, -0.00466043876332, 2.5551644e6],
  [2.890871144776878e-9, 8.983055095805407e-6, -3.068298e-8, 7.47137025468032, -3.53937994e-6, -0.02145144861037, -1.234426596e-5, 0.00010322952773, -3.23890364e-6, 8.260885e5],
];

/** 百度 BD09MC 米制坐标转 BD-09 经纬度。 */
export function bd09mcToBd09(x: number, y: number): Coordinate | null {
  const absoluteX = Math.abs(x);
  const absoluteY = Math.abs(y);
  let coefficients: number[] | null = null;
  for (let index = 0; index < BAIDU_MC_BANDS.length; index++) {
    if (absoluteY >= BAIDU_MC_BANDS[index]) {
      coefficients = BAIDU_MC_TO_LL[index];
      break;
    }
  }
  if (!coefficients) return null;

  const factor = absoluteY / coefficients[9];
  let longitude = coefficients[0] + coefficients[1] * absoluteX;
  let latitude =
    coefficients[2] +
    coefficients[3] * factor +
    coefficients[4] * factor ** 2 +
    coefficients[5] * factor ** 3 +
    coefficients[6] * factor ** 4 +
    coefficients[7] * factor ** 5 +
    coefficients[8] * factor ** 6;
  longitude *= x < 0 ? -1 : 1;
  latitude *= y < 0 ? -1 : 1;
  return inRange(latitude, longitude) ? { latitude, longitude } : null;
}

const BAIDU_X_PI = (Math.PI * 3000) / 180;

/** BD-09 转 GCJ-02。 */
export function bd09ToGcj02(latitude: number, longitude: number): Coordinate {
  const x = longitude - 0.0065;
  const y = latitude - 0.006;
  const radius = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * BAIDU_X_PI);
  const angle = Math.atan2(y, x) - 0.000003 * Math.cos(x * BAIDU_X_PI);
  return {
    latitude: radius * Math.sin(angle),
    longitude: radius * Math.cos(angle),
  };
}

/** 从百度页面正文的 x/y 字段提取 BD09MC 坐标。 */
export function extractBaiduFromBody(body: string): ParsedCoord | null {
  const text = String(body);
  const match = text.match(/"x"\s*:\s*"?(-?\d+(?:\.\d+)?)"?\s*,\s*"y"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!(Math.abs(x) > 1e5 && Math.abs(y) > 1e5)) return null;

  const coordinate = bd09mcToBd09(x, y);
  if (!coordinate) return null;
  const title = text.match(/<title>[^<]*?【([^】]{1,40})】/);
  return {
    ...coordinate,
    name: title ? title[1] : "",
    src: "baidu",
  };
}

// Apple/Google 在港澳台直接提供 WGS-84；高德/百度仍使用偏移坐标。
const HONG_KONG_POLYGON: Array<[number, number]> = [
  [113.8, 22.1],
  [113.8, 22.43],
  [113.9, 22.455],
  [113.98, 22.487],
  [114.05, 22.507],
  [114.11, 22.527],
  [114.17, 22.543],
  [114.24, 22.552],
  [114.32, 22.545],
  [114.5, 22.45],
  [114.5, 22.1],
];

function pointInPolygon(latitude: number, longitude: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [currentLongitude, currentLatitude] = polygon[index];
    const [previousLongitude, previousLatitude] = polygon[previous];
    if (
      currentLatitude > latitude !== previousLatitude > latitude &&
      longitude <
        ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
          (previousLatitude - currentLatitude) +
          currentLongitude
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function isInMacau(latitude: number, longitude: number): boolean {
  return latitude >= 22.1 && latitude <= 22.215 && longitude >= 113.525 && longitude <= 113.605;
}

function isInTaiwan(latitude: number, longitude: number): boolean {
  return latitude >= 21.85 && latitude <= 25.35 && longitude >= 119.3 && longitude <= 122.1;
}

/** Apple/Google 在给定位置是否直接使用 WGS-84。 */
export function usesWgs84Locally(latitude: number, longitude: number, source?: MapSource): boolean {
  if (source !== "apple" && source !== "google") return false;
  return (
    isInMacau(latitude, longitude) ||
    isInTaiwan(latitude, longitude) ||
    pointInPolygon(latitude, longitude, HONG_KONG_POLYGON)
  );
}

const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function gcjDeltaLat(x: number, y: number): number {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  result += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return result;
}

function gcjDeltaLon(x: number, y: number): number {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  result += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return result;
}

/** WGS-84 转 GCJ-02。 */
export function wgs84ToGcj02(latitude: number, longitude: number): Coordinate {
  if (!isInsideChina(longitude, latitude)) return { latitude, longitude };
  let latitudeDelta = gcjDeltaLat(longitude - 105, latitude - 35);
  let longitudeDelta = gcjDeltaLon(longitude - 105, latitude - 35);
  const radians = (latitude / 180) * Math.PI;
  let magic = Math.sin(radians);
  magic = 1 - GCJ_EE * magic * magic;
  const squareRoot = Math.sqrt(magic);
  latitudeDelta = (latitudeDelta * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * squareRoot)) * Math.PI);
  longitudeDelta = (longitudeDelta * 180) / ((GCJ_A / squareRoot) * Math.cos(radians) * Math.PI);
  return {
    latitude: latitude + latitudeDelta,
    longitude: longitude + longitudeDelta,
  };
}

/** GCJ-02 转 WGS-84，使用迭代反算降低残差。 */
export function gcj02ToWgs84(latitude: number, longitude: number): Coordinate {
  if (!isInsideChina(longitude, latitude)) return { latitude, longitude };
  let wgsLatitude = latitude;
  let wgsLongitude = longitude;
  for (let index = 0; index < 6; index++) {
    const converted = wgs84ToGcj02(wgsLatitude, wgsLongitude);
    const latitudeError = converted.latitude - latitude;
    const longitudeError = converted.longitude - longitude;
    if (Math.abs(latitudeError) < 1e-9 && Math.abs(longitudeError) < 1e-9) break;
    wgsLatitude -= latitudeError;
    wgsLongitude -= longitudeError;
  }
  return { latitude: wgsLatitude, longitude: wgsLongitude };
}

/** 根据地图来源和地区，把坐标统一转换为 WGS-84。 */
export function toWgs84(latitude: number, longitude: number, source?: MapSource): Coordinate {
  if (source === "baidu") {
    const gcj = bd09ToGcj02(latitude, longitude);
    return gcj02ToWgs84(gcj.latitude, gcj.longitude);
  }
  if (source === "amap" || source === "apple" || source === "google") {
    if (usesWgs84Locally(latitude, longitude, source)) return { latitude, longitude };
    return gcj02ToWgs84(latitude, longitude);
  }
  return { latitude, longitude };
}

/** 解析链接并按来源转换到 WGS-84。 */
export async function parseAndConvert(raw: string): Promise<ParsedCoord> {
  const result = await parseCoordsAsync(raw);
  const converted = toWgs84(result.latitude, result.longitude, result.src);
  return {
    ...result,
    latitude: round6(converted.latitude),
    longitude: round6(converted.longitude),
  };
}
