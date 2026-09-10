// 书签管理器 - 使用 Storage API 持久化
import { Path } from "scripting";
import { pathToDisplayName } from "./utils";

export interface Bookmark {
  name: string;
  path: string;
  /** 持久书签 ID（由 pickDirectoryBookmark 创建） */
  bookmarkId: string;
}

const BOOKMARKS_KEY = "FileStore_Bookmarks";
const BOOKMARK_ALIASES_KEY = "FileStore_BookmarkAliases";
const SHARED_OPTIONS = { shared: true };

// 书签变更订阅：所有增删改最终都经 saveBookmarks 落库，统一在此发通知，
// 让双栏分屏、单栏、挂载目录页等所有 UI 实时同步（无需重启/重新挂载）。
type BookmarkListener = () => void;
const _bookmarkListeners = new Set<BookmarkListener>();

/** 订阅书签变更，返回取消订阅函数 */
export function onBookmarksChanged(listener: BookmarkListener): () => void {
  _bookmarkListeners.add(listener);
  return () => {
    _bookmarkListeners.delete(listener);
  };
}

function notifyBookmarksChanged(): void {
  for (const fn of _bookmarkListeners) {
    try {
      fn();
    } catch {}
  }
}

/** FileStore 显示别名；不修改系统书签，取消挂载后仍保留。 */
export function getBookmarkAliases(): Record<string, string> {
  return Storage.get<Record<string, string>>(BOOKMARK_ALIASES_KEY, SHARED_OPTIONS) ?? {};
}

export function setBookmarkAlias(bookmarkId: string, newName: string): boolean {
  const name = newName.trim();
  if (!bookmarkId || !name) return false;
  const ok = Storage.set(BOOKMARK_ALIASES_KEY, { ...getBookmarkAliases(), [bookmarkId]: name }, SHARED_OPTIONS);
  if (ok) notifyBookmarksChanged();
  return ok;
}

/** 显式删除系统书签时一并清理本地别名；访问失败不可调用。 */
export function removeSystemBookmark(bookmarkId: string): boolean {
  if (!FileManager.removeFileBookmark(bookmarkId)) return false;
  const aliases = getBookmarkAliases();
  delete aliases[bookmarkId];
  Storage.set(BOOKMARK_ALIASES_KEY, aliases, SHARED_OPTIONS);
  notifyBookmarksChanged();
  return true;
}

function getStorage(): any {
  return (globalThis as any).Storage;
}

/** 解析 Storage 值（兼容对象 / JSON 字符串） */
function parseStoredBookmarks(raw: unknown): Bookmark[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw as Bookmark[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Bookmark[];
    } catch {}
  }
  return null;
}

/** 读取书签列表（优先 shared 域，兼容旧 JSON 字符串） */
function readBookmarks(): Bookmark[] {
  try {
    const st = getStorage();
    if (!st) return [];

    let raw: unknown = null;
    try {
      raw = st.get?.(BOOKMARKS_KEY, SHARED_OPTIONS);
    } catch {}
    if (raw == null) {
      try {
        raw = st.get?.(BOOKMARKS_KEY);
      } catch {}
    }
    // 兼容旧 setString API
    if (raw == null) {
      try {
        raw = st.getString?.(BOOKMARKS_KEY, SHARED_OPTIONS) ?? st.getString?.(BOOKMARKS_KEY);
      } catch {}
    }

    const parsed = parseStoredBookmarks(raw);
    if (parsed) {
      const aliases = getBookmarkAliases();
      return parsed.map((bookmark) => {
        const alias = aliases[bookmark.bookmarkId];
        return typeof alias === "string" ? { ...bookmark, name: alias } : bookmark;
      });
    }
  } catch (e) {
    console.log("读取书签失败:", e);
  }
  return [];
}

/** 保存书签列表（直接存 JSON 对象，符合 Storage 支持的类型） */
function saveBookmarks(bookmarks: Bookmark[]): void {
  const st = getStorage();
  try {
    st?.set?.(BOOKMARKS_KEY, bookmarks, SHARED_OPTIONS);
  } catch {}
  try {
    st?.set?.(BOOKMARKS_KEY, bookmarks);
  } catch {}
  // 落库成功后通知所有订阅者刷新 UI
  notifyBookmarksChanged();
}

/** 获取所有书签 */
export function getAllBookmarks(): Bookmark[] {
  return readBookmarks();
}

/** 通过持久书签 ID 重新获取可访问的路径 */
export function resolveBookmarkPath(bookmarkId: string): string | null {
  try {
    return FileManager.bookmarkedPath(bookmarkId);
  } catch (e) {
    console.log("解析书签路径失败:", e);
    return null;
  }
}

/** 手动添加书签（路径 + 显示名称，不使用系统持久书签） */
export function addBookmarkManually(path: string, displayName: string): Bookmark | null {
  try {
    const trimmedPath = path.trim();
    const trimmedName = displayName.trim();
    if (!trimmedPath || !trimmedName) return null;

    const bookmarks = readBookmarks();

    // 检查是否已挂载相同路径
    if (bookmarks.some((b) => b.path === trimmedPath)) {
      return bookmarks.find((b) => b.path === trimmedPath) ?? null;
    }

    // 检查名称重复
    let finalName = trimmedName;
    let counter = 2;
    while (bookmarks.some((b) => b.name === finalName)) {
      finalName = `${trimmedName} (${counter})`;
      counter++;
    }

    const bookmark: Bookmark = { name: finalName, path: trimmedPath, bookmarkId: "" };
    bookmarks.push(bookmark);
    saveBookmarks(bookmarks);
    return bookmark;
  } catch (e) {
    console.log("添加书签失败:", e);
    return null;
  }
}

/** 将已有的系统目录书签加入 FileStore 挂载列表 */
export function mountExistingBookmark(path: string, bookmarkId: string, displayName?: string): Bookmark | null {
  try {
    const resolvedPath = bookmarkId ? resolveBookmarkPath(bookmarkId) : path;
    if (bookmarkId && !resolvedPath) {
      return null;
    }
    const finalPath = resolvedPath || path;

    const bookmarks = readBookmarks();
    const existingIndex = bookmarks.findIndex((item) =>
      bookmarkId ? item.bookmarkId === bookmarkId : item.path === finalPath,
    );

    const alias = bookmarkId ? getBookmarkAliases()[bookmarkId] : undefined;
    const baseName = displayName || alias || pathToDisplayName(finalPath) || Path.basename(finalPath) || bookmarkId;

    if (existingIndex >= 0) {
      const existing = bookmarks[existingIndex];
      const updated: Bookmark = {
        ...existing,
        path: finalPath,
        name: displayName || alias || existing.name,
      };
      bookmarks[existingIndex] = updated;
      saveBookmarks(bookmarks);
      return updated;
    }

    let finalName = baseName;
    let counter = 2;
    while (bookmarks.some((item) => item.name === finalName)) {
      finalName = `${baseName} (${counter})`;
      counter++;
    }

    const bookmark: Bookmark = { name: finalName, path: finalPath, bookmarkId };
    bookmarks.push(bookmark);
    saveBookmarks(bookmarks);
    return bookmark;
  } catch (e) {
    console.log("挂载已有书签失败:", e);
    return null;
  }
}

/** 取消挂载：从 FileStore 书签列表中移除，但不删除系统持久书签文件。 */
export function unmountBookmark(bookmarkId?: string, path?: string): boolean {
  try {
    const bookmarks = readBookmarks();
    const filtered = bookmarks.filter((bookmark) =>
      bookmarkId ? bookmark.bookmarkId !== bookmarkId : bookmark.path !== path,
    );
    if (filtered.length === bookmarks.length) return false;
    saveBookmarks(filtered);
    return true;
  } catch (e) {
    console.log("取消挂载失败:", e);
    return false;
  }
}

/** 添加目录书签（使用持久安全域书签） */
export async function addDirectoryBookmark(): Promise<Bookmark | null> {
  try {
    // 使用唯一的 preferredName，避免系统弹出"已存在同名书签"提示
    const uniqueName = `FSKEY_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const result = await DocumentPicker.pickDirectoryBookmark({ preferredName: uniqueName });
    if (result) {
      const { path: pickedPath, bookmarkName } = result;
      const bookmarks = readBookmarks();

      // 检查是否已挂载相同路径
      const existingIndex = bookmarks.findIndex((b) => b.path === pickedPath);
      if (existingIndex >= 0) {
        return bookmarks[existingIndex];
      }

      // 生成显示名称，处理重复名称
      let displayName = pathToDisplayName(pickedPath);
      let counter = 2;
      while (bookmarks.some((b) => b.name === displayName)) {
        displayName = `${pathToDisplayName(pickedPath)} (${counter})`;
        counter++;
      }

      const bookmark: Bookmark = { name: displayName, path: pickedPath, bookmarkId: bookmarkName };
      bookmarks.push(bookmark);
      saveBookmarks(bookmarks);
      return bookmark;
    }
    return null;
  } catch (e) {
    console.log("添加目录书签失败:", e);
    return null;
  }
}

/** 通过显示名称删除书签，并同步移除对应的系统书签。 */
export function removeBookmark(name: string): boolean {
  try {
    const bookmarks = readBookmarks();
    const removed = bookmarks.find((bookmark) => bookmark.name === name);
    const filtered = bookmarks.filter((bookmark) => bookmark.name !== name);
    if (filtered.length === bookmarks.length) return false;

    saveBookmarks(filtered);
    if (removed?.bookmarkId) {
      try {
        removeSystemBookmark(removed.bookmarkId);
      } catch {}
    }
    return true;
  } catch (error) {
    console.log("删除书签失败:", error);
    return false;
  }
}

/** 通过 bookmarkId 删除书签（更可靠）。
 *  手动书签的 bookmarkId 为空字符串，直接用它过滤会匹配并删除所有手动书签。
 *  因此当 bookmarkId 为空时，改用唯一路径定位要删除的书签。 */
export function removeBookmarkById(bookmarkId: string, path?: string): boolean {
  try {
    const bookmarks = readBookmarks();
    const removed = bookmarkId
      ? bookmarks.find((b) => b.bookmarkId === bookmarkId)
      : path
        ? bookmarks.find((b) => b.path === path)
        : undefined;
    // bookmarkId 非空：按 id 删除（目录书签）；为空：按 path 删除（手动书签）。
    const filtered = bookmarkId
      ? bookmarks.filter((b) => b.bookmarkId !== bookmarkId)
      : path
        ? bookmarks.filter((b) => b.path !== path)
        : bookmarks;
    if (filtered.length < bookmarks.length) {
      saveBookmarks(filtered);
      if (removed?.bookmarkId) {
        try {
          removeSystemBookmark(removed.bookmarkId);
        } catch {}
      }
      return true;
    }
    return false;
  } catch (e) {
    console.log("通过 ID 删除书签失败:", e);
    return false;
  }
}

/** 重命名书签：如果具备 bookmarkId 则更新显示别名；否则更新存储名称。 */
export function renameBookmark(oldName: string, newName: string): boolean {
  try {
    const bookmarks = readBookmarks();
    const idx = bookmarks.findIndex((b) => b.name === oldName);
    if (idx >= 0) {
      const bookmark = bookmarks[idx];
      const trimmedName = newName.trim();
      if (!trimmedName) return false;
      if (bookmarks.some((item, index) => index !== idx && item.name === trimmedName)) return false;
      if (bookmark.bookmarkId) {
        return setBookmarkAlias(bookmark.bookmarkId, trimmedName);
      }
      bookmarks[idx] = { ...bookmark, name: trimmedName };
      saveBookmarks(bookmarks);
      return true;
    }
    return false;
  } catch (e) {
    console.log("重命名书签失败:", e);
    return false;
  }
}

/** 获取书签路径（优先用持久书签解析，兼容 Bookmark 对象或名称字符串） */
export function getBookmarkPath(target: Bookmark | string): string | null {
  if (typeof target === "string") {
    const bookmarks = readBookmarks();
    const bookmark = bookmarks.find((b) => b.name === target);
    if (!bookmark) return null;
    return bookmark.bookmarkId ? resolveBookmarkPath(bookmark.bookmarkId) : bookmark.path || null;
  }
  return target.bookmarkId ? resolveBookmarkPath(target.bookmarkId) : target.path || null;
}

/** 获取内置目录列表（对齐 Scripting FileManager 官方路径 API） */
export interface BuiltinDirectory {
  name: string;
  path: string;
  icon: string;
  description: string;
}

function pushBuiltin(dirs: BuiltinDirectory[], name: string, getPath: () => string, icon: string, description: string, available: () => boolean = () => true) {
  try {
    if (!available()) return;
    const path = getPath();
    if (!path) return;
    dirs.push({ name, path, icon, description });
  } catch {}
}

export function getBuiltinDirectories(): BuiltinDirectory[] {
  const dirs: BuiltinDirectory[] = [];
  pushBuiltin(dirs, "File Store", () => Path.join(FileManager.documentsDirectory, "File Store"), "folder.fill", "默认文件仓库");
  pushBuiltin(dirs, "脚本", () => FileManager.scriptsDirectory, "chevron.left.forwardslash.chevron.right", "脚本存储位置");
  pushBuiltin(
    dirs,
    "iCloud 文档",
    () => FileManager.iCloudDocumentsDirectory,
    "icloud.fill",
    "iCloud Drive Documents",
    () => !!FileManager.isiCloudEnabled,
  );
  pushBuiltin(dirs, "App Group", () => FileManager.appGroupDocumentsDirectory, "square.grid.2x2.fill", "小组件可访问");
  pushBuiltin(dirs, "临时", () => FileManager.temporaryDirectory, "clock.fill", "系统临时目录，可被清理");
  pushBuiltin(dirs, "Safari 扩展", () => FileManager.safariBrowserDirectory, "safari", "Safari 用户脚本数据根目录");
  pushBuiltin(dirs, "Safari 下载", () => FileManager.safariBrowserDownloadsDirectory, "arrow.down.circle.fill", "GM.download 下载目录");
  pushBuiltin(dirs, "Safari 脚本", () => FileManager.safariBrowserUserscriptsDirectory, "doc.badge.gearshape", "已安装的 userscripts");
  pushBuiltin(dirs, "Safari 存储", () => FileManager.safariBrowserStorageDirectory, "internaldrive", "GM 值 JSON 存储");

  return dirs;
}

/** 重新排序书签（传入新的顺序数组） */
export function reorderBookmarks(reordered: Bookmark[]): boolean {
  try {
    saveBookmarks(reordered);
    return true;
  } catch (e) {
    console.log("重新排序书签失败:", e);
    return false;
  }
}
