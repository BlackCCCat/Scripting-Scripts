// 地点搜索：基于 MapKit 的 MapSearch.locate（设备端本地搜索，无需权限）。
// 返回坐标列表供地图跳转。

export interface SearchResult {
  name: string;
  address: string;
  coordinate: { latitude: number; longitude: number };
}

/**
 * 搜索地点关键词，返回匹配结果列表。不传 region，支持全球地址搜索。
 * @param query 搜索关键词
 */
export async function searchPlaces(
  query: string,
): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const options: Parameters<typeof MapSearch.locate>[0] = {
    query,
    resultTypes: ["pointOfInterest", "address"],
  };
  // 不传 region 参数，让 MapKit 基于设备位置自动决定搜索范围，支持全球地址搜索
  const items = await MapSearch.locate(options);
  return items.map((it) => ({
    name: it.name ?? "",
    address: it.formattedAddress ?? "",
    coordinate: { latitude: it.coordinate.latitude, longitude: it.coordinate.longitude },
  }));
}
