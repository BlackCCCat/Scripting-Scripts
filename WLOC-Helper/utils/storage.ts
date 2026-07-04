// 持久化存储层：基于 Scripting 的 Storage API（全局命名空间），
// 封装收藏位置、应用设置、当前生效坐标缓存三类数据。

import type { AppSettings, FavoriteLocation, ActiveLocation } from "../types";
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

// ── 当前生效坐标缓存 ─────────────────────────────────────────────────

// 读取本地缓存的设备生效坐标（上次成功 save/query 的结果）
export function loadActiveCache(): ActiveLocation | null {
  return Storage.get<ActiveLocation>(STORAGE_KEYS.activeCache);
}

// 写入生效坐标缓存
export function saveActiveCache(loc: ActiveLocation | null): void {
  if (loc == null) Storage.remove(STORAGE_KEYS.activeCache);
  else Storage.set(STORAGE_KEYS.activeCache, loc);
}
