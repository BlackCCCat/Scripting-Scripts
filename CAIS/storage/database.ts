import type {
  ClipboardClearRange,
  ClipGroup,
  ClipItem,
  ClipKind,
  ClipKindCountsByScope,
  ClipListScope,
  FavoriteGroup,
} from "../types"
import { databasePath, ensureAppDirectories } from "./paths"

type DB = {
  execute: (sql: string, params?: any[]) => Promise<any>
  fetchAll: (sql: string, params?: any[]) => Promise<any[]>
  transaction: (
    steps: Array<{ sql: string; args?: any[] }>,
    options?: { kind?: "deferred" | "immediate" | "exclusive" },
  ) => Promise<void>
}

let cachedDb: DB | null = null
let initialized = false
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CLIP_ROW_SELECT = "id, kind, title, substr(content, 1, 2000) as content, content_hash, image_path, source_change_count, created_at, updated_at, last_copied_at, pinned, favorite, manual_favorite, favorite_format, field_delimiter, field_delimiter_override, favorite_group_id, favorite_group_manual, favorite_order, favorite_updated_at, deleted_at"
const UNIQUE_ACTIVE_TEXT_INDEX = "idx_clips_unique_active_text"

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
    favoriteFormat: row.favorite_format === "fields" ? "fields" : "plain",
    fieldDelimiter: row.field_delimiter ? String(row.field_delimiter) : undefined,
    fieldDelimiterOverride: Number(row.field_delimiter_override ?? 0) === 1,
    favoriteGroupId: row.favorite_group_id ? String(row.favorite_group_id) : undefined,
    favoriteGroupManual: Number(row.favorite_group_manual ?? 0) === 1,
    favoriteOrder: row.favorite_order == null ? undefined : Number(row.favorite_order),
    favoriteUpdatedAt: row.favorite_updated_at == null ? undefined : Number(row.favorite_updated_at),
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
    item.favoriteFormat === "fields" ? "fields" : "plain",
    item.fieldDelimiter ?? null,
    item.fieldDelimiterOverride ? 1 : 0,
    item.favoriteGroupId ?? null,
    item.favoriteGroupManual ? 1 : 0,
    item.favoriteOrder ?? null,
    item.favoriteUpdatedAt ?? null,
    item.deletedAt ?? null,
  ]
}

function rowToFavoriteGroup(row: any): FavoriteGroup {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    ruleType: row.rule_type === "regex" ? "regex" : "keyword",
    pattern: String(row.pattern ?? ""),
    ignoreCase: Number(row.ignore_case ?? 1) === 1,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: Number(row.created_at ?? Date.now()),
    updatedAt: Number(row.updated_at ?? Date.now()),
  }
}

async function ensureUniqueActiveTextIndex(db: DB): Promise<void> {
  const indexes = await db.fetchAll("PRAGMA index_list('clips')")
  if (indexes.some((row) => String(row.name ?? "") === UNIQUE_ACTIVE_TEXT_INDEX)) return

  const rows = await db.fetchAll(`
    SELECT id, content_hash, content, pinned, favorite, updated_at, last_copied_at
    FROM clips
    WHERE deleted_at IS NULL AND manual_favorite = 0 AND kind IN ('text', 'url')
    ORDER BY pinned DESC, favorite DESC, updated_at DESC, rowid DESC
  `)
  const seen = new Map<string, Map<string, any>>()
  for (const row of rows) {
    const hash = String(row.content_hash ?? "")
    const content = String(row.content ?? "")
    let contents = seen.get(hash)
    if (!contents) {
      contents = new Map<string, any>()
      seen.set(hash, contents)
    }
    const keeper = contents.get(content)
    if (!keeper) {
      contents.set(content, row)
      continue
    }
    keeper.pinned = Math.max(Number(keeper.pinned ?? 0), Number(row.pinned ?? 0))
    keeper.favorite = Math.max(Number(keeper.favorite ?? 0), Number(row.favorite ?? 0))
    keeper.updated_at = Math.max(Number(keeper.updated_at ?? 0), Number(row.updated_at ?? 0))
    keeper.last_copied_at = Math.max(Number(keeper.last_copied_at ?? 0), Number(row.last_copied_at ?? 0)) || null
    await db.execute(
      "UPDATE clips SET pinned = ?, favorite = ?, updated_at = ?, last_copied_at = ? WHERE id = ?",
      [keeper.pinned, keeper.favorite, keeper.updated_at, keeper.last_copied_at, keeper.id]
    )
    await db.execute("DELETE FROM clips WHERE id = ?", [row.id])
  }

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_ACTIVE_TEXT_INDEX}
    ON clips(content_hash, content)
    WHERE deleted_at IS NULL AND manual_favorite = 0 AND kind IN ('text', 'url')
  `)
}

export async function openCaisDatabase(): Promise<DB> {
  if (cachedDb) return cachedDb
  await ensureAppDirectories()
  const sqlite = (globalThis as any).SQLite
  if (!sqlite?.open) throw new Error("SQLite.open 不可用")
  cachedDb = (await sqlite.open(databasePath())) as DB
  return cachedDb
}

export function resetDatabaseConnection() {
  cachedDb = null
  initialized = false
}

export async function readDatabaseDataVersion(): Promise<number> {
  const db = await openCaisDatabase()
  const rows = await db.fetchAll("PRAGMA data_version")
  const row = rows[0] ?? {}
  return Number(row.data_version ?? Object.values(row)[0] ?? 0) || 0
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
      favorite_format TEXT NOT NULL DEFAULT 'plain',
      field_delimiter TEXT,
      field_delimiter_override INTEGER NOT NULL DEFAULT 0,
      favorite_group_id TEXT,
      favorite_group_manual INTEGER NOT NULL DEFAULT 0,
      favorite_order INTEGER,
      favorite_updated_at INTEGER,
      deleted_at INTEGER
    )
  `)
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN manual_favorite INTEGER NOT NULL DEFAULT 0")
  } catch {
  }
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN favorite_format TEXT NOT NULL DEFAULT 'plain'")
  } catch {
  }
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN field_delimiter TEXT")
  } catch {
  }
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN field_delimiter_override INTEGER NOT NULL DEFAULT 0")
  } catch {
  }
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN favorite_group_id TEXT")
  } catch {
  }
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN favorite_group_manual INTEGER NOT NULL DEFAULT 0")
    await db.execute("UPDATE clips SET favorite_group_manual = 1 WHERE favorite_group_id IS NOT NULL")
  } catch {
  }
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN favorite_order INTEGER")
  } catch {
  }
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN favorite_updated_at INTEGER")
  } catch {
  }
  await db.execute(`
    CREATE TABLE IF NOT EXISTS favorite_groups (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL UNIQUE COLLATE NOCASE,
      rule_type TEXT NOT NULL DEFAULT 'keyword',
      pattern TEXT NOT NULL,
      ignore_case INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  try {
    await db.execute("ALTER TABLE favorite_groups ADD COLUMN ignore_case INTEGER NOT NULL DEFAULT 1")
  } catch {
  }
  await db.execute("UPDATE clips SET favorite_order = -updated_at WHERE favorite = 1 AND favorite_order IS NULL")
  await db.execute("UPDATE clips SET favorite_updated_at = updated_at WHERE favorite = 1 AND favorite_updated_at IS NULL")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_active ON clips(deleted_at, pinned, updated_at)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_active_order ON clips(deleted_at, pinned DESC, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_favorite_order ON clips(deleted_at, favorite, pinned DESC, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_clipboard_order ON clips(deleted_at, manual_favorite, pinned DESC, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_trim_order ON clips(deleted_at, pinned, favorite, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(content_hash)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_favorite_group_order ON clips(deleted_at, favorite, favorite_group_id, favorite_order)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_favorite_groups_order ON favorite_groups(sort_order, created_at)")
  await ensureUniqueActiveTextIndex(db)
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
    INSERT INTO clips (
      id, kind, title, content, content_hash, image_path, source_change_count,
      created_at, updated_at, last_copied_at, pinned, favorite, manual_favorite,
      favorite_format, field_delimiter, field_delimiter_override, favorite_group_id,
      favorite_group_manual, favorite_order, favorite_updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

export async function findClipById(id: string): Promise<ClipItem | null> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    "SELECT * FROM clips WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [id]
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
  kind?: ClipKind
  limit?: number
  offset?: number
  group: TimeGroup
}): Promise<any[]> {
  const params: any[] = []
  const clauses = ["deleted_at IS NULL", scopeClause(options.scope), options.group.clause]
  params.push(...options.group.params)
  if (options.kind) {
    clauses.push("kind = ?")
    params.push(options.kind)
  }
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

async function fetchFavoriteClipGroups(db: DB, options: {
  search?: string
  kind?: ClipKind
  limit?: number
  offset?: number
}): Promise<ClipGroup[]> {
  const definitions = await db.fetchAll(
    "SELECT * FROM favorite_groups ORDER BY sort_order ASC, created_at ASC",
  )
  const groups: ClipGroup[] = [
    { id: "favorite:plain", title: "普通收藏", items: [] },
    { id: "favorite:fields", title: "字段收藏", items: [] },
    ...definitions.map((row) => {
      const definition = rowToFavoriteGroup(row)
      return { id: `favorite-group:${definition.id}`, title: definition.title, items: [] }
    }),
  ]
  const params: any[] = []
  const clauses = ["deleted_at IS NULL", "favorite = 1"]
  if (options.kind) {
    clauses.push("kind = ?")
    params.push(options.kind)
  }
  const search = String(options.search ?? "").trim()
  if (search) {
    clauses.push("(title LIKE ? OR content LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }
  const limit = Math.max(1, Math.min(300, Number(options.limit ?? 120) || 120))
  const offset = Math.max(0, Number(options.offset ?? 0) || 0)
  params.push(offset, offset + limit)
  const rows = await db.fetchAll(`
    WITH ranked_favorites AS (
      SELECT
        ${CLIP_ROW_SELECT},
        CASE
          WHEN favorite_group_id IS NOT NULL THEN 'favorite-group:' || favorite_group_id
          WHEN favorite_format = 'fields' THEN 'favorite:fields'
          ELSE 'favorite:plain'
        END AS section_id,
        ROW_NUMBER() OVER (
          PARTITION BY CASE
            WHEN favorite_group_id IS NOT NULL THEN 'favorite-group:' || favorite_group_id
            WHEN favorite_format = 'fields' THEN 'favorite:fields'
            ELSE 'favorite:plain'
          END
          ORDER BY COALESCE(favorite_order, -favorite_updated_at, -updated_at) ASC, favorite_updated_at DESC
        ) AS section_rank
      FROM clips
      WHERE ${clauses.join(" AND ")}
    )
    SELECT * FROM ranked_favorites
    WHERE section_rank > ? AND section_rank <= ?
    ORDER BY section_id, section_rank
  `, params)
  const groupById = new Map(groups.map((group) => [group.id, group]))
  for (const row of rows) {
    const sectionId = String(row.section_id ?? "")
    const fallbackId = row.favorite_format === "fields" ? "favorite:fields" : "favorite:plain"
    const group = groupById.get(sectionId) ?? groupById.get(fallbackId)
    group?.items.push(rowToClip(row))
  }
  return groups
}

async function fetchClipGroups(db: DB, options: {
  scope: ClipListScope
  search?: string
  kind?: ClipKind
  limit?: number
  offset?: number
}): Promise<ClipGroup[]> {
  if (options.scope === "favorites") {
    return fetchFavoriteClipGroups(db, options)
  }
  const groups: ClipGroup[] = []
  for (const group of clipTimeGroups(Date.now())) {
    const rows = await fetchClipGroupRows(db, { ...options, group })
    groups.push({ id: `time:${group.title}`, title: group.title, items: rows.map(rowToClip) })
  }
  return groups
}

export async function listClipGroups(options: {
  scope: ClipListScope
  search?: string
  kind?: ClipKind
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

async function fetchClipKindCounts(db: DB): Promise<ClipKindCountsByScope> {
  const rows = await db.fetchAll(`
    SELECT
      COUNT(CASE WHEN manual_favorite = 0 THEN 1 END) AS clipboard_count,
      COUNT(CASE WHEN manual_favorite = 0 AND kind = 'text' THEN 1 END) AS clipboard_text_count,
      COUNT(CASE WHEN manual_favorite = 0 AND kind = 'url' THEN 1 END) AS clipboard_url_count,
      COUNT(CASE WHEN manual_favorite = 0 AND kind = 'image' THEN 1 END) AS clipboard_image_count,
      COUNT(CASE WHEN favorite = 1 THEN 1 END) AS favorite_count,
      COUNT(CASE WHEN favorite = 1 AND kind = 'text' THEN 1 END) AS favorite_text_count,
      COUNT(CASE WHEN favorite = 1 AND kind = 'url' THEN 1 END) AS favorite_url_count,
      COUNT(CASE WHEN favorite = 1 AND kind = 'image' THEN 1 END) AS favorite_image_count
    FROM clips
    WHERE deleted_at IS NULL
  `)
  const row = rows[0] ?? {}
  return {
    clipboard: {
      total: Number(row.clipboard_count ?? 0),
      text: Number(row.clipboard_text_count ?? 0),
      url: Number(row.clipboard_url_count ?? 0),
      image: Number(row.clipboard_image_count ?? 0),
    },
    favorites: {
      total: Number(row.favorite_count ?? 0),
      text: Number(row.favorite_text_count ?? 0),
      url: Number(row.favorite_url_count ?? 0),
      image: Number(row.favorite_image_count ?? 0),
    },
  }
}

export async function countClipKindsByScope(): Promise<ClipKindCountsByScope> {
  const db = await openCaisDatabase()
  try {
    return await fetchClipKindCounts(db)
  } catch (error) {
    if (initialized) throw error
    await ensureSchema(db)
    initialized = true
    return fetchClipKindCounts(db)
  }
}

export async function countClipsByScope(): Promise<Record<ClipListScope, number>> {
  const counts = await countClipKindsByScope()
  return {
    clipboard: counts.clipboard.total,
    favorites: counts.favorites.total,
  }
}

export async function updateClipState(
  id: string,
  updates: Partial<Pick<ClipItem, "updatedAt" | "lastCopiedAt" | "pinned" | "favorite">> & {
    favoriteGroupId?: string | null
    favoriteGroupManual?: boolean
    favoriteOrder?: number | null
    favoriteUpdatedAt?: number | null
  },
): Promise<void> {
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
  if (updates.favoriteGroupId !== undefined) {
    sets.push("favorite_group_id = ?")
    params.push(updates.favoriteGroupId)
  }
  if (updates.favoriteGroupManual !== undefined) {
    sets.push("favorite_group_manual = ?")
    params.push(updates.favoriteGroupManual ? 1 : 0)
  }
  if (updates.favoriteOrder !== undefined) {
    sets.push("favorite_order = ?")
    params.push(updates.favoriteOrder)
  }
  if (updates.favoriteUpdatedAt !== undefined) {
    sets.push("favorite_updated_at = ?")
    params.push(updates.favoriteUpdatedAt)
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

export async function updateClipContent(row: Pick<ClipItem, "id" | "kind" | "title" | "content" | "contentHash" | "updatedAt" | "favoriteFormat" | "fieldDelimiter" | "fieldDelimiterOverride" | "favoriteGroupId" | "favoriteGroupManual" | "favoriteOrder" | "favoriteUpdatedAt">): Promise<void> {
  const db = await initializeDatabase()
  await db.execute(
    "UPDATE clips SET kind = ?, title = ?, content = ?, content_hash = ?, updated_at = ?, favorite_format = ?, field_delimiter = ?, field_delimiter_override = ?, favorite_group_id = ?, favorite_group_manual = ?, favorite_order = ?, favorite_updated_at = ? WHERE id = ?",
    [
      row.kind,
      row.title,
      row.content,
      row.contentHash,
      row.updatedAt,
      row.favoriteFormat === "fields" ? "fields" : "plain",
      row.fieldDelimiter ?? null,
      row.fieldDelimiterOverride ? 1 : 0,
      row.favoriteGroupId ?? null,
      row.favoriteGroupManual ? 1 : 0,
      row.favoriteOrder ?? null,
      row.favoriteUpdatedAt ?? null,
      row.id,
    ]
  )
}

export async function updateClipTitle(id: string, title: string, updatedAt: number, favoriteUpdatedAt?: number): Promise<void> {
  const db = await initializeDatabase()
  await db.execute(
    "UPDATE clips SET title = ?, updated_at = ?, favorite_updated_at = COALESCE(?, favorite_updated_at) WHERE id = ?",
    [title, updatedAt, favoriteUpdatedAt ?? null, id],
  )
}

export async function listFavoriteGroupDefinitions(): Promise<FavoriteGroup[]> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    "SELECT * FROM favorite_groups ORDER BY sort_order ASC, created_at ASC",
  )
  return rows.map(rowToFavoriteGroup)
}

export async function favoriteGroupTitleExists(title: string, excludingId?: string): Promise<boolean> {
  const db = await initializeDatabase()
  const rows = excludingId
    ? await db.fetchAll(
        "SELECT 1 FROM favorite_groups WHERE title = ? COLLATE NOCASE AND id <> ? LIMIT 1",
        [title, excludingId],
      )
    : await db.fetchAll(
        "SELECT 1 FROM favorite_groups WHERE title = ? COLLATE NOCASE LIMIT 1",
        [title],
      )
  return rows.length > 0
}

export async function insertFavoriteGroup(group: FavoriteGroup): Promise<void> {
  const db = await initializeDatabase()
  await db.execute(
    `INSERT INTO favorite_groups (id, title, rule_type, pattern, ignore_case, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [group.id, group.title, group.ruleType, group.pattern, group.ignoreCase ? 1 : 0, group.sortOrder, group.createdAt, group.updatedAt],
  )
}

export async function updateFavoriteGroup(group: FavoriteGroup): Promise<void> {
  const db = await initializeDatabase()
  await db.execute(
    "UPDATE favorite_groups SET title = ?, rule_type = ?, pattern = ?, ignore_case = ?, updated_at = ? WHERE id = ?",
    [group.title, group.ruleType, group.pattern, group.ignoreCase ? 1 : 0, group.updatedAt, group.id],
  )
}

export async function deleteFavoriteGroup(id: string): Promise<void> {
  const db = await initializeDatabase()
  await db.transaction([
    {
      sql: "UPDATE clips SET favorite_group_id = NULL, favorite_group_manual = 0 WHERE favorite_group_id = ?",
      args: [id],
    },
    { sql: "DELETE FROM favorite_groups WHERE id = ?", args: [id] },
  ])
}

export async function nextFavoriteGroupSortOrder(): Promise<number> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM favorite_groups")
  return Number(rows[0]?.next_order ?? 0)
}

export async function reorderFavoriteGroups(ids: string[]): Promise<void> {
  if (!ids.length) return
  const db = await initializeDatabase()
  await db.transaction(
    ids.map((id, index) => ({
      sql: "UPDATE favorite_groups SET sort_order = ? WHERE id = ?",
      args: [index, id],
    })),
  )
}

export async function nextFavoriteItemOrder(favoriteGroupId?: string): Promise<number> {
  const db = await initializeDatabase()
  const rows = favoriteGroupId
    ? await db.fetchAll(
        "SELECT MIN(COALESCE(favorite_order, -favorite_updated_at, -updated_at)) AS first_order FROM clips WHERE deleted_at IS NULL AND favorite = 1 AND favorite_group_id = ?",
        [favoriteGroupId],
      )
    : await db.fetchAll(
        "SELECT MIN(COALESCE(favorite_order, -favorite_updated_at, -updated_at)) AS first_order FROM clips WHERE deleted_at IS NULL AND favorite = 1 AND favorite_group_id IS NULL",
      )
  const first = rows[0]?.first_order
  return first == null ? 0 : Number(first) - 1
}

export async function listAutomaticFavoriteItems(): Promise<ClipItem[]> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    "SELECT * FROM clips WHERE deleted_at IS NULL AND favorite = 1 AND favorite_group_manual = 0 ORDER BY COALESCE(favorite_order, -favorite_updated_at, -updated_at) ASC",
  )
  return rows.map(rowToClip)
}

export async function replaceAutomaticFavoriteGroupAssignments(
  assignments: Array<{ id: string; favoriteGroupId?: string; favoriteOrder: number }>,
): Promise<void> {
  if (!assignments.length) return
  const db = await initializeDatabase()
  await db.transaction(
    assignments.map((assignment) => ({
      sql: "UPDATE clips SET favorite_group_id = ?, favorite_group_manual = 0, favorite_order = ? WHERE id = ?",
      args: [assignment.favoriteGroupId ?? null, assignment.favoriteOrder, assignment.id],
    })),
  )
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
