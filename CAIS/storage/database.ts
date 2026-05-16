import type { ClipboardClearRange, ClipGroup, ClipItem, ClipListScope } from "../types"
import { databasePath, ensureAppDirectories } from "./paths"

type DB = {
  execute: (sql: string, params?: any[]) => Promise<any>
  fetchAll: (sql: string, params?: any[]) => Promise<any[]>
}

let cachedDb: DB | null = null
let initialized = false
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CLIP_ROW_SELECT = "id, kind, title, substr(content, 1, 2000) as content, content_hash, image_path, source_change_count, created_at, updated_at, last_copied_at, pinned, favorite, manual_favorite, deleted_at"

function rowToClip(row: any): ClipItem {
  return {
    id: String(row.id),
    kind: row.kind,
    title: String(row.title ?? ""),
    content: String(row.content ?? ""),
    contentHash: String(row.content_hash ?? ""),
    imagePath: row.image_path ? String(row.image_path) : undefined,
    sourceChangeCount: row.source_change_count == null ? undefined : Number(row.source_change_count),
    createdAt: Number(row.created_at ?? Date.now()),
    updatedAt: Number(row.updated_at ?? Date.now()),
    lastCopiedAt: row.last_copied_at == null ? undefined : Number(row.last_copied_at),
    pinned: Number(row.pinned ?? 0) === 1,
    favorite: Number(row.favorite ?? 0) === 1,
    manualFavorite: Number(row.manual_favorite ?? 0) === 1,
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  }
}

function clipParams(item: ClipItem): any[] {
  return [
    item.id,
    item.kind,
    item.title,
    item.content,
    item.contentHash,
    item.imagePath ?? null,
    item.sourceChangeCount ?? null,
    item.createdAt,
    item.updatedAt,
    item.lastCopiedAt ?? null,
    item.pinned ? 1 : 0,
    item.favorite ? 1 : 0,
    item.manualFavorite ? 1 : 0,
    item.deletedAt ?? null,
  ]
}

export async function openCaisDatabase(): Promise<DB> {
  if (cachedDb) return cachedDb
  await ensureAppDirectories()
  const sqlite = (globalThis as any).SQLite
  if (!sqlite?.open) throw new Error("SQLite.open 不可用")
  cachedDb = (await sqlite.open(databasePath())) as DB
  return cachedDb
}

async function ensureSchema(db: DB): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      image_path TEXT,
      source_change_count INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_copied_at INTEGER,
      pinned INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      manual_favorite INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER
    )
  `)
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN manual_favorite INTEGER NOT NULL DEFAULT 0")
  } catch {
  }
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_active ON clips(deleted_at, pinned, updated_at)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_active_order ON clips(deleted_at, pinned DESC, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_favorite_order ON clips(deleted_at, favorite, pinned DESC, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_clipboard_order ON clips(deleted_at, manual_favorite, pinned DESC, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_trim_order ON clips(deleted_at, pinned, favorite, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(content_hash)")
}

export async function initializeDatabase(): Promise<DB> {
  const db = await openCaisDatabase()
  if (initialized) return db
  await ensureSchema(db)
  initialized = true
  return db
}

export async function insertClip(item: ClipItem): Promise<void> {
  const db = await initializeDatabase()
  await db.execute(`
    INSERT OR REPLACE INTO clips (
      id, kind, title, content, content_hash, image_path, source_change_count,
      created_at, updated_at, last_copied_at, pinned, favorite, manual_favorite, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, clipParams(item))
}

export async function findClipByHash(contentHash: string, kind?: string): Promise<ClipItem | null> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    kind
      ? "SELECT * FROM clips WHERE content_hash = ? AND kind = ? AND deleted_at IS NULL LIMIT 1"
      : "SELECT * FROM clips WHERE content_hash = ? AND deleted_at IS NULL LIMIT 1",
    kind ? [contentHash, kind] : [contentHash]
  )
  return rows[0] ? rowToClip(rows[0]) : null
}

export async function findTextClipsByContent(content: string): Promise<ClipItem[]> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    "SELECT * FROM clips WHERE content = ? AND kind IN ('text', 'url') AND manual_favorite = 0 AND deleted_at IS NULL ORDER BY pinned DESC, favorite DESC, updated_at DESC",
    [content]
  )
  return rows.map(rowToClip)
}

async function fetchClipRows(db: DB, options: {
  scope?: ClipListScope
  search?: string
  limit?: number
}): Promise<any[]> {
  const params: any[] = []
  const clauses: string[] = ["deleted_at IS NULL"]
  if (options.scope) clauses.push(scopeClause(options.scope))
  const search = String(options.search ?? "").trim()
  if (search) {
    clauses.push("(title LIKE ? OR content LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(500, Number(options.limit ?? 100) || 100))
  params.push(limit)
  return db.fetchAll(
    `SELECT ${CLIP_ROW_SELECT} FROM clips ${where} ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
    params
  )
}

export async function listClips(options: {
  scope?: ClipListScope
  search?: string
  limit?: number
} = {}): Promise<ClipItem[]> {
  const db = await openCaisDatabase()
  let rows: any[]
  try {
    rows = await fetchClipRows(db, options)
  } catch (error) {
    if (initialized) throw error
    await ensureSchema(db)
    initialized = true
    rows = await fetchClipRows(db, options)
  }
  return rows.map(rowToClip)
}

type TimeGroup = {
  title: string
  clause: string
  params: number[]
}

function clipTimeGroups(now: number): TimeGroup[] {
  const oneDayAgo = now - ONE_DAY_MS
  const threeDaysAgo = now - ONE_DAY_MS * 3
  const sevenDaysAgo = now - ONE_DAY_MS * 7
  return [
    { title: "最近内容", clause: "updated_at >= ?", params: [oneDayAgo] },
    { title: "近三天", clause: "updated_at < ? AND updated_at >= ?", params: [oneDayAgo, threeDaysAgo] },
    { title: "近七天", clause: "updated_at < ? AND updated_at >= ?", params: [threeDaysAgo, sevenDaysAgo] },
    { title: "更久", clause: "updated_at < ?", params: [sevenDaysAgo] },
  ]
}

function clipboardRangeClause(range: ClipboardClearRange, now = Date.now()): { clause: string; params: number[] } {
  const oneDayAgo = now - ONE_DAY_MS
  const threeDaysAgo = now - ONE_DAY_MS * 3
  const sevenDaysAgo = now - ONE_DAY_MS * 7
  switch (range) {
    case "recent":
      return { clause: "updated_at >= ?", params: [oneDayAgo] }
    case "threeDays":
      return { clause: "updated_at < ? AND updated_at >= ?", params: [oneDayAgo, threeDaysAgo] }
    case "sevenDays":
      return { clause: "updated_at < ? AND updated_at >= ?", params: [threeDaysAgo, sevenDaysAgo] }
    case "older":
      return { clause: "updated_at < ?", params: [sevenDaysAgo] }
  }
}

function scopeClause(scope: ClipListScope): string {
  return scope === "favorites" ? "favorite = 1" : "manual_favorite = 0"
}

async function fetchClipGroupRows(db: DB, options: {
  scope: ClipListScope
  search?: string
  limit?: number
  offset?: number
  group: TimeGroup
}): Promise<any[]> {
  const params: any[] = []
  const clauses = ["deleted_at IS NULL", scopeClause(options.scope), options.group.clause]
  params.push(...options.group.params)
  const search = String(options.search ?? "").trim()
  if (search) {
    clauses.push("(title LIKE ? OR content LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }
  const limit = Math.max(1, Math.min(300, Number(options.limit ?? 120) || 120))
  const offset = Math.max(0, Number(options.offset ?? 0) || 0)
  params.push(limit, offset)
  return db.fetchAll(
    `SELECT ${CLIP_ROW_SELECT} FROM clips WHERE ${clauses.join(" AND ")} ORDER BY pinned DESC, updated_at DESC LIMIT ? OFFSET ?`,
    params
  )
}

async function fetchClipGroups(db: DB, options: {
  scope: ClipListScope
  search?: string
  limit?: number
  offset?: number
}): Promise<ClipGroup[]> {
  const groups: ClipGroup[] = []
  for (const group of clipTimeGroups(Date.now())) {
    const rows = await fetchClipGroupRows(db, { ...options, group })
    groups.push({ title: group.title, items: rows.map(rowToClip) })
  }
  return groups
}

export async function listClipGroups(options: {
  scope: ClipListScope
  search?: string
  limit?: number
  offset?: number
}): Promise<ClipGroup[]> {
  const db = await openCaisDatabase()
  try {
    return await fetchClipGroups(db, options)
  } catch (error) {
    if (initialized) throw error
    await ensureSchema(db)
    initialized = true
    return fetchClipGroups(db, options)
  }
}

export async function updateClipState(id: string, updates: Partial<Pick<ClipItem, "updatedAt" | "lastCopiedAt" | "pinned" | "favorite">>): Promise<void> {
  const db = await initializeDatabase()
  const sets: string[] = []
  const params: any[] = []
  if (updates.updatedAt != null) {
    sets.push("updated_at = ?")
    params.push(updates.updatedAt)
  }
  if (updates.lastCopiedAt != null) {
    sets.push("last_copied_at = ?")
    params.push(updates.lastCopiedAt)
  }
  if (updates.pinned != null) {
    sets.push("pinned = ?")
    params.push(updates.pinned ? 1 : 0)
  }
  if (updates.favorite != null) {
    sets.push("favorite = ?")
    params.push(updates.favorite ? 1 : 0)
  }
  if (!sets.length) return
  params.push(id)
  await db.execute(`UPDATE clips SET ${sets.join(", ")} WHERE id = ?`, params)
}

export async function deleteClip(id: string): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("DELETE FROM clips WHERE id = ?", [id])
}

export async function deleteClipboardClipsByRange(range: ClipboardClearRange): Promise<void> {
  const db = await initializeDatabase()
  const filter = clipboardRangeClause(range)
  await db.execute(
    `DELETE FROM clips WHERE manual_favorite = 0 AND ${filter.clause}`,
    filter.params
  )
}

export async function deleteFavoriteClips(): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("DELETE FROM clips WHERE favorite = 1")
}

export async function listImagePaths(options: { favoritesOnly?: boolean; clipboardRange?: ClipboardClearRange } = {}): Promise<string[]> {
  const db = await initializeDatabase()
  const clauses = ["image_path IS NOT NULL"]
  const params: any[] = []
  if (options.favoritesOnly) {
    clauses.push("favorite = 1")
  } else {
    clauses.push("manual_favorite = 0")
  }
  if (options.clipboardRange) {
    const filter = clipboardRangeClause(options.clipboardRange)
    clauses.push(filter.clause)
    params.push(...filter.params)
  }
  const rows = await db.fetchAll(`SELECT image_path FROM clips WHERE ${clauses.join(" AND ")}`, params)
  return rows.map((row) => String(row.image_path ?? "")).filter(Boolean)
}

export async function updateClipContent(row: Pick<ClipItem, "id" | "kind" | "title" | "content" | "contentHash" | "updatedAt">): Promise<void> {
  const db = await initializeDatabase()
  await db.execute(
    "UPDATE clips SET kind = ?, title = ?, content = ?, content_hash = ?, updated_at = ? WHERE id = ?",
    [row.kind, row.title, row.content, row.contentHash, row.updatedAt, row.id]
  )
}

export async function updateClipTitle(id: string, title: string): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("UPDATE clips SET title = ? WHERE id = ?", [title, id])
}

export async function trimActiveClips(maxItems: number): Promise<void> {
  const limit = Math.max(50, Number(maxItems) || 1000)
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    "SELECT id FROM clips WHERE deleted_at IS NULL AND pinned = 0 AND favorite = 0 ORDER BY updated_at DESC LIMIT -1 OFFSET ?",
    [limit]
  )
  if (!rows.length) return
  for (const row of rows) {
    await db.execute("DELETE FROM clips WHERE id = ?", [row.id])
  }
}

export async function getFullClipContent(id: string): Promise<string> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll("SELECT content FROM clips WHERE id = ?", [id])
  return rows[0] ? String(rows[0].content ?? "") : ""
}
