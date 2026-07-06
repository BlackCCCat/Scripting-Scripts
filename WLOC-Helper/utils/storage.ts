// 持久化存储层：基于 Scripting 的 Storage API（全局命名空间），
// 封装收藏位置和应用设置，并清理旧版生效坐标缓存。

import type { AppSettings, FavoriteLocation } from "../types";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../constants";

// ── 收藏位置 ───────────────────────────────────────────────────────

// 读取全部收藏位置
export function loadFavorites(): FavoriteLocation[] {
  return Storage.get<FavoriteLocation[]>(STORAGE_KEYS.favorites) ?? [];
}

// 写入收藏列表（整体替换）
export function saveFavorites(favorites: FavoriteLocation[]): boolean {
  return Storage.set(STORAGE_KEYS.favorites, favorites);
}

// 追加一条收藏，返回新列表
export function addFavorite(name: string, latitude: number, longitude: number): FavoriteLocation[] {
  const list = loadFavorites();
  list.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    latitude,
    longitude,
    createdAt: new Date().toISOString(),
  });
  saveFavorites(list);
  return list;
}

// 按 id 删除一条收藏，返回新列表
export function removeFavorite(id: string): FavoriteLocation[] {
  const list = loadFavorites().filter((f) => f.id !== id);
  saveFavorites(list);
  return list;
}

// 清空全部收藏
export function clearFavorites(): void {
  saveFavorites([]);
}

// ── 应用设置 ───────────────────────────────────────────────────────

// 读取应用设置，缺失字段以默认值补全
export function loadSettings(): AppSettings {
  const saved = Storage.get<Partial<AppSettings>>(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
}

// 写入应用设置（整体替换）
export function saveSettings(settings: AppSettings): boolean {
  return Storage.set(STORAGE_KEYS.settings, settings);
}

// ── 旧版当前生效坐标缓存清理 ───────────────────────────────────────────

// 当前生效坐标必须来自 WLOC 模块查询结果，不能使用脚本本地缓存兜底。
export function clearActiveCache(): void {
  Storage.remove(STORAGE_KEYS.activeCache);
}
