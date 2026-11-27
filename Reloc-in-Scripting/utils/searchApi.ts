import { DEFAULT_GLOBAL_SEARCH_ENDPOINT } from "../constants";
import type { AppLanguage, Coordinate } from "../types";
import { deviceWgs84ToMapCoord } from "./coords";
import { formatText, getStrings, isChineseLanguage } from "./i18n";

export interface PlaceSearchResult {
  name: string;
  address: string;
  coordinate: Coordinate;
}

interface GlobalSearchResponse {
  results?: { name?: string; detail?: string; lat?: number; lon?: number }[];
}

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/**
 * 国内 POI/地址搜索（系统 MapKit，返回地图坐标系）。
 */
export async function searchDomesticPlaces(query: string): Promise<PlaceSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const items = await MapSearch.locate({
    query: trimmed,
    resultTypes: ["pointOfInterest", "address"],
  });

  return items.map((item) => ({
    name: item.name ?? trimmed,
    address: item.formattedAddress ?? "",
    coordinate: {
      latitude: item.coordinate.latitude,
      longitude: item.coordinate.longitude,
    },
  }));
}

async function translateChineseQueryForOSM(query: string): Promise<{ text: string; translated: boolean }> {
  if (!containsChinese(query)) return { text: query, translated: false };
  try {
    const text = await Translation.shared.translateInstalled({
      text: query,
      source: "zh-Hans",
      target: "en",
    });
    const trimmed = text.trim();
    if (!trimmed) return { text: query, translated: false };
    return { text: trimmed, translated: trimmed !== query };
  } catch {
    return { text: query, translated: false };
  }
}

function reverseEndpointFrom(searchEndpoint: string): string {
  const trimmed = searchEndpoint.trim().replace(/\/+$/, "");
  return /\/search$/.test(trimmed) ? trimmed.replace(/\/search$/, "/reverse") : `${trimmed}/reverse`;
}

/**
 * 全球搜索（Nominatim 中转接口，返回 WGS-84 并按需映射为地图显示坐标）。
 */
export async function searchGlobalPlaces(
  query: string,
  customEndpoint?: string,
  gcj02CorrectionEnabled = true,
  language: AppLanguage = "system",
): Promise<{ results: PlaceSearchResult[]; translatedQuery?: string }> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { results: [] };

  const s = getStrings(language);
  const endpoint = (customEndpoint || "").trim() || DEFAULT_GLOBAL_SEARCH_ENDPOINT;
  if (!endpoint.startsWith("http")) throw new Error(s.search.invalidGlobalEndpoint);

  const { text, translated } = await translateChineseQueryForOSM(trimmed);
  const langParam = isChineseLanguage(language) ? "zh-Hans" : "en";
  const response = await fetch(`${endpoint}?q=${encodeURIComponent(text)}&lang=${langParam}`, {
    method: "GET",
    timeout: 12,
  } as RequestInit);

  if (!response.ok) throw new Error(formatText(s.search.globalHttpError, response.status));

  const body = (await response.json()) as GlobalSearchResponse;
  const results: PlaceSearchResult[] = [];
  for (const item of body.results ?? []) {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;
    const mapped = deviceWgs84ToMapCoord(
      item.lat as number,
      item.lon as number,
      gcj02CorrectionEnabled,
    );
    results.push({
      name: (item.name ?? "").trim() || trimmed,
      address: (item.detail ?? "").trim(),
      coordinate: mapped,
    });
  }

  return {
    results,
    translatedQuery: translated ? text : undefined,
  };
}

/**
 * 反向地理编码：先试系统 MapKit/CLGeocoder（随应用语言切换 locale），境外空白时回退到全球反查端点。
 */
export async function reverseGeocodePlace(
  mapLatitude: number,
  mapLongitude: number,
  options?: { customEndpoint?: string; wgs84Coordinate?: Coordinate; language?: AppLanguage },
): Promise<{ name: string; address: string }> {
  const chinese = isChineseLanguage(options?.language);
  const localeTag = chinese ? "zh-Hans" : "en";
  try {
    const placemarks = await Location.reverseGeocode({
      latitude: mapLatitude,
      longitude: mapLongitude,
      locale: localeTag,
    });
    const first = placemarks?.[0];
    if (first) {
      const name =
        first.name?.trim() ||
        [first.thoroughfare, first.subThoroughfare].filter(Boolean).join("") ||
        first.locality?.trim() ||
        "";
      const address = [first.administrativeArea, first.locality, first.subLocality, first.thoroughfare]
        .filter((part, idx, arr) => Boolean(part) && arr.indexOf(part) === idx)
        .join(" · ");
      if (name) {
        return { name, address };
      }
    }
  } catch {
    // 大陆设备在境外常失败，继续尝试全球反查
  }

  const endpoint = (options?.customEndpoint || "").trim() || DEFAULT_GLOBAL_SEARCH_ENDPOINT;
  if (!endpoint.startsWith("http")) return { name: "", address: "" };

  const target = options?.wgs84Coordinate ?? { latitude: mapLatitude, longitude: mapLongitude };
  try {
    const url =
      `${reverseEndpointFrom(endpoint)}?lat=${encodeURIComponent(target.latitude)}` +
      `&lon=${encodeURIComponent(target.longitude)}` +
      `&lang=${localeTag}`;
    const response = await fetch(url, { method: "GET", timeout: 8 } as RequestInit);
    if (!response.ok) return { name: "", address: "" };
    const body = (await response.json()) as { name?: string; detail?: string };
    const name = (body.name ?? "").trim() || (body.detail ?? "").split(",")[0].trim();
    const address = (body.detail ?? "").trim();
    return { name, address };
  } catch {
    return { name: "", address: "" };
  }
}
