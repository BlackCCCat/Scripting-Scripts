import type { ClipItem } from "../types"
import { databasePath, ensureAppDirectories } from "./paths"

type DB = {
  execute: (sql: string, params?: any[]) => Promise<any>
  fetchAll: (sql: string, params?: any[]) => Promise<any[]>
  close?: () => Promise<void> | void
}

let cachedDb: DB | null = null
let initialized = false

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

export async function initializeDatabase(): Promise<DB> {
  const db = await openCaisDatabase()
  if (initialized) return db
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
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(content_hash)")
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

export async function listClips(options: {
  search?: string
  includeDeleted?: boolean
  deletedOnly?: boolean
  limit?: number
} = {}): Promise<ClipItem[]> {
  const db = await initializeDatabase()
  const params: any[] = []
  const clauses: string[] = []
  if (options.deletedOnly) clauses.push("deleted_at IS NOT NULL")
  else if (!options.includeDeleted) clauses.push("deleted_at IS NULL")
  const search = String(options.search ?? "").trim()
  if (search) {
    clauses.push("(title LIKE ? OR content LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(500, Number(options.limit ?? 100) || 100))
  params.push(limit)
  const rows = await db.fetchAll(
    `SELECT id, kind, title, substr(content, 1, 2000) as content, content_hash, image_path, source_change_count, created_at, updated_at, last_copied_at, pinned, favorite, manual_favorite, deleted_at FROM clips ${where} ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
    params
  )
  return rows.map(rowToClip)
}

export async function updateClipState(id: string, updates: Partial<Pick<ClipItem, "updatedAt" | "lastCopiedAt" | "pinned" | "favorite" | "deletedAt">>): Promise<void> {
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
  if ("deletedAt" in updates) {
    sets.push("deleted_at = ?")
    params.push(updates.deletedAt ?? null)
  }
  if (!sets.length) return
  params.push(id)
  await db.execute(`UPDATE clips SET ${sets.join(", ")} WHERE id = ?`, params)
}

export async function deleteClip(id: string): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("DELETE FROM clips WHERE id = ?", [id])
}

export async function deleteAllClips(): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("DELETE FROM clips WHERE manual_favorite = 0")
}

export async function deleteFavoriteClips(): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("DELETE FROM clips WHERE favorite = 1")
}

export async function listImagePaths(options: { favoritesOnly?: boolean } = {}): Promise<string[]> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    options.favoritesOnly
      ? "SELECT image_path FROM clips WHERE image_path IS NOT NULL AND favorite = 1"
      : "SELECT image_path FROM clips WHERE image_path IS NOT NULL AND manual_favorite = 0"
  )
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

export async function purgeOldDeleted(beforeTimestamp: number): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("DELETE FROM clips WHERE deleted_at IS NOT NULL AND deleted_at < ?", [beforeTimestamp])
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
