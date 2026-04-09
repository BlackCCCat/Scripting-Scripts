import { Path } from "scripting"

import type { Config, ImportedRecord, PickupInfo } from "./types"
import { extractPickupFromText, splitMessages } from "./parser"

declare const Storage: {
  get<T>(key: string): T | null
  set<T>(key: string, value: T): boolean
  remove(key: string): void
}

const CONFIG_KEY = "smsPickup_widget_config_v2"
const DATASTORE_MIGRATION_KEY = "smsPickup_business_db_migrated_v1"
const RECENTLY_PICKED_MS = 60 * 60 * 1000
const STALE_DELETED_MARK_MS = 90 * 24 * 60 * 60 * 1000
export const BUSINESS_DB_PATH = Path.join(FileManager.appGroupDocumentsDirectory, "sms_pickup_business.db")
const db = SQLite.open(BUSINESS_DB_PATH, {
  foreignKeysEnabled: true,
  readonly: false,
  journalMode: "wal",
  busyMode: 3,
  maximumReaderCount: 4,
  label: "sms-pickup-business",
})

type PickupRow = {
  code: string
  courier: string | null
  snippet: string
  date: string | null
  importedAt: string | null
  pickedAt: number | null
}

type RawConfig = Partial<Config> & {
  autoCleanupProcessed?: boolean
  cleanupAfterDays?: number
  deletedCodes?: string[]
}

let initPromise: Promise<void> | null = null

function normalizeLegacyRecords(raw: RawConfig): ImportedRecord[] {
  if (Array.isArray(raw.importedRecords)) {
    return raw.importedRecords.map((item) => ({
      text: String(item?.text || ""),
      importedAt: item?.importedAt ? String(item.importedAt) : null,
    })).filter((item) => item.text.trim())
  }

  if (!Array.isArray(raw.importedMessages)) {
    return []
  }

  return raw.importedMessages
    .map((text) => ({
      text: String(text || ""),
      importedAt: null,
    }))
    .filter((item) => item.text.trim())
}

function currentCleanupSettings() {
  const raw = (Storage.get<RawConfig>(CONFIG_KEY) || {}) as RawConfig
  const cleanupDays = [3, 7, 14, 30].includes(Number(raw.cleanupDays ?? raw.cleanupAfterDays))
    ? Number(raw.cleanupDays ?? raw.cleanupAfterDays)
    : 7

  return {
    autoCleanupPicked: raw.autoCleanupPicked === true || raw.autoCleanupProcessed === true,
    autoCleanupPreview: raw.autoCleanupPreview === true,
    cleanupDays,
  }
}

function placeholders(count: number) {
  return new Array(count).fill("?").join(", ")
}

function itemTimeValue(item: { date: string | null; importedAt?: string | null }) {
  const value = item.date || item.importedAt
  if (!value) return 0
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

async function ensureTables() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pickups (
      code TEXT PRIMARY KEY,
      courier TEXT,
      snippet TEXT NOT NULL,
      event_time TEXT,
      imported_at TEXT,
      raw_text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS picked_items (
      code TEXT PRIMARY KEY,
      picked_at INTEGER NOT NULL,
      FOREIGN KEY(code) REFERENCES pickups(code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deleted_items (
      scope TEXT NOT NULL,
      code TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      PRIMARY KEY(scope, code),
      FOREIGN KEY(code) REFERENCES pickups(code) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pickups_event_time ON pickups(event_time);
    CREATE INDEX IF NOT EXISTS idx_pickups_imported_at ON pickups(imported_at);
    CREATE INDEX IF NOT EXISTS idx_deleted_items_scope ON deleted_items(scope, deleted_at);
  `)
}

async function upsertPickup(rawText: string, item: PickupInfo, importedAt: string | null) {
  await db.execute(
    `
      INSERT INTO pickups (code, courier, snippet, event_time, imported_at, raw_text)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        courier = excluded.courier,
        snippet = excluded.snippet,
        event_time = excluded.event_time,
        imported_at = excluded.imported_at,
        raw_text = excluded.raw_text
    `,
    [
      item.code,
      item.courier,
      item.snippet,
      item.date,
      item.date || importedAt,
      rawText,
    ],
  )
}

async function hasPickup(code: string) {
  const rows = await db.fetchAll<{ code: string }>(
    "SELECT code FROM pickups WHERE code = ? LIMIT 1",
    [code],
  )
  return rows.length > 0
}

async function upsertDeleted(scope: "home" | "preview", code: string) {
  if (!(await hasPickup(code))) return
  await db.execute(
    `
      INSERT INTO deleted_items (scope, code, deleted_at)
      VALUES (?, ?, ?)
      ON CONFLICT(scope, code) DO UPDATE SET deleted_at = excluded.deleted_at
    `,
    [scope, code, Date.now()],
  )
}

async function removeDeletedScopes(codes: string[]) {
  if (codes.length === 0) return
  await db.execute(
    `DELETE FROM deleted_items WHERE code IN (${placeholders(codes.length)}) AND scope IN ('home', 'preview')`,
    codes,
  )
}

async function migrateLegacyData() {
  if (Storage.get<boolean>(DATASTORE_MIGRATION_KEY) === true) return

  const raw = (Storage.get<RawConfig>(CONFIG_KEY) || {}) as RawConfig
  const records = normalizeLegacyRecords(raw)

  for (const record of records) {
    const extracted = extractPickupFromText(record.text)
    for (const item of extracted) {
      await upsertPickup(record.text, item, record.importedAt)
    }
  }

  for (const item of Array.isArray(raw.pickedItems) ? raw.pickedItems : []) {
    if (!item?.code) continue
    if (!(await hasPickup(String(item.code)))) continue
    await db.execute(
      `
        INSERT INTO picked_items (code, picked_at)
        VALUES (?, ?)
        ON CONFLICT(code) DO UPDATE SET picked_at = excluded.picked_at
      `,
      [String(item.code), Number(item.timestamp) || Date.now()],
    )
  }

  const legacyHomeDeleted = Array.isArray(raw.homeDeletedCodes)
    ? raw.homeDeletedCodes
    : Array.isArray(raw.deletedCodes) ? raw.deletedCodes : []
  const legacyPreviewDeleted = Array.isArray(raw.previewDeletedCodes)
    ? raw.previewDeletedCodes
    : Array.isArray(raw.deletedCodes) ? raw.deletedCodes : []

  for (const code of legacyHomeDeleted) {
    if (!code) continue
    await upsertDeleted("home", String(code))
  }
  for (const code of legacyPreviewDeleted) {
    if (!code) continue
    await upsertDeleted("preview", String(code))
  }

  Storage.set(DATASTORE_MIGRATION_KEY, true)
}

async function pruneExpiredData() {
  const settings = currentCleanupSettings()

  if (settings.autoCleanupPicked) {
    const cutoff = Date.now() - settings.cleanupDays * 24 * 60 * 60 * 1000
    const expiredPicked = await db.fetchAll<{ code: string }>(
      "SELECT code FROM picked_items WHERE picked_at < ?",
      [cutoff],
    )

    for (const row of expiredPicked) {
      await upsertDeleted("home", row.code)
    }

    await db.execute("DELETE FROM picked_items WHERE picked_at < ?", [cutoff])
  }

  if (settings.autoCleanupPreview) {
    const cutoffIso = new Date(Date.now() - settings.cleanupDays * 24 * 60 * 60 * 1000).toISOString()
    const expiredPreview = await db.fetchAll<{ code: string }>(
      `
        SELECT code
        FROM pickups
        WHERE COALESCE(event_time, imported_at) IS NOT NULL
          AND COALESCE(event_time, imported_at) < ?
      `,
      [cutoffIso],
    )

    for (const row of expiredPreview) {
      await upsertDeleted("preview", row.code)
    }
  }
}

async function purgeFullyDeletedPickups() {
  const recentPickedCutoff = Date.now() - RECENTLY_PICKED_MS
  const rows = await db.fetchAll<{ code: string }>(
    `
      SELECT p.code AS code
      FROM pickups p
      LEFT JOIN picked_items pk ON pk.code = p.code
      WHERE (pk.picked_at IS NULL OR pk.picked_at < ?)
        AND EXISTS (
          SELECT 1 FROM deleted_items d1
          WHERE d1.code = p.code AND d1.scope = 'home'
        )
        AND EXISTS (
          SELECT 1 FROM deleted_items d2
          WHERE d2.code = p.code AND d2.scope = 'preview'
        )
    `,
    [recentPickedCutoff],
  )

  if (rows.length === 0) return

  await db.execute(
    `DELETE FROM pickups WHERE code IN (${placeholders(rows.length)})`,
    rows.map((row) => row.code),
  )
}

async function cleanupStaleDeletedItems() {
  await db.execute(`
    DELETE FROM deleted_items
    WHERE code NOT IN (SELECT code FROM pickups)
  `)

  const cutoff = Date.now() - STALE_DELETED_MARK_MS
  await db.execute(
    `
      DELETE FROM deleted_items
      WHERE deleted_at < ?
        AND code NOT IN (
          SELECT p.code
          FROM pickups p
          LEFT JOIN picked_items pk ON pk.code = p.code
          WHERE pk.code IS NOT NULL
             OR NOT EXISTS (
               SELECT 1 FROM deleted_items d1
               WHERE d1.code = p.code AND d1.scope = 'home'
             )
             OR NOT EXISTS (
               SELECT 1 FROM deleted_items d2
               WHERE d2.code = p.code AND d2.scope = 'preview'
             )
        )
    `,
    [cutoff],
  )
}

async function runMaintenance() {
  await pruneExpiredData()
  await purgeFullyDeletedPickups()
  await cleanupStaleDeletedItems()
}

async function ensureReady() {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureTables()
      await migrateLegacyData()
    })()
  }

  await initPromise
  await runMaintenance()
}

function mapRows(rows: PickupRow[]): PickupInfo[] {
  const now = Date.now()
  const items: PickupInfo[] = []

  for (const row of rows) {
    if (row.pickedAt != null) {
      if (now - row.pickedAt < RECENTLY_PICKED_MS) {
        items.push({
          courier: row.courier,
          code: row.code,
          snippet: row.snippet,
          date: row.date,
          importedAt: row.importedAt,
          picked: true,
        })
      }
      continue
    }

    items.push({
      courier: row.courier,
      code: row.code,
      snippet: row.snippet,
      date: row.date,
      importedAt: row.importedAt,
      picked: false,
    })
  }

  return items.sort((a, b) => itemTimeValue(b) - itemTimeValue(a))
}

async function fetchScopedPickups(scope: "home" | "preview"): Promise<PickupInfo[]> {
  await ensureReady()

  const rows = await db.fetchAll<PickupRow>(
    `
      SELECT
        p.code AS code,
        p.courier AS courier,
        p.snippet AS snippet,
        p.event_time AS date,
        p.imported_at AS importedAt,
        pk.picked_at AS pickedAt
      FROM pickups p
      LEFT JOIN picked_items pk ON pk.code = p.code
      LEFT JOIN deleted_items d ON d.code = p.code AND d.scope = ?
      WHERE d.code IS NULL
      ORDER BY COALESCE(p.event_time, p.imported_at) DESC
    `,
    [scope],
  )

  return mapRows(rows)
}

export async function getHomePickupsFromStore() {
  return fetchScopedPickups("home")
}

export async function getPreviewPickupsFromStore() {
  return fetchScopedPickups("preview")
}

export async function importAnyDataToStore(data: string) {
  await ensureReady()
  if (!data.trim()) return 0

  let changed = 0

  for (const part of splitMessages(data)) {
    const extracted = extractPickupFromText(part)
    if (extracted.length === 0) continue

    const codes = extracted.map((item) => item.code)
    const existingRows = await db.fetchAll<{ code: string }>(
      `SELECT code FROM pickups WHERE code IN (${placeholders(codes.length)})`,
      codes,
    )
    const deletedRows = await db.fetchAll<{ code: string }>(
      `SELECT DISTINCT code FROM deleted_items WHERE code IN (${placeholders(codes.length)})`,
      codes,
    )

    const existingCodes = new Set(existingRows.map((row) => row.code))
    const deletedCodes = new Set(deletedRows.map((row) => row.code))
    const hasNewCode = codes.some((code) => !existingCodes.has(code))
    const hasRestorableCode = codes.some((code) => deletedCodes.has(code))

    if (!hasNewCode && !hasRestorableCode) continue

    const now = new Date().toISOString()
    for (const item of extracted) {
      await upsertPickup(part, item, now)
    }
    await removeDeletedScopes(codes)
    changed++
  }

  await runMaintenance()
  return changed
}

export async function markPickedInStore(code: string) {
  await ensureReady()
  await db.execute(
    `
      INSERT INTO picked_items (code, picked_at)
      VALUES (?, ?)
      ON CONFLICT(code) DO UPDATE SET picked_at = excluded.picked_at
    `,
    [code, Date.now()],
  )
  await runMaintenance()
}

export async function unmarkPickedInStore(code: string) {
  await ensureReady()
  await db.execute("DELETE FROM picked_items WHERE code = ?", [code])
  await runMaintenance()
}

export async function clearPickedInStore() {
  await ensureReady()
  const pickedRows = await db.fetchAll<{ code: string }>("SELECT code FROM picked_items")
  for (const row of pickedRows) {
    await upsertDeleted("home", row.code)
  }
  await db.execute("DELETE FROM picked_items")
  await runMaintenance()
}

export async function deleteHomePickupInStore(code: string) {
  await ensureReady()
  await upsertDeleted("home", code)
  await db.execute("DELETE FROM picked_items WHERE code = ?", [code])
  await runMaintenance()
}

export async function deletePreviewPickupInStore(code: string) {
  await ensureReady()
  await upsertDeleted("preview", code)
  await runMaintenance()
}

export async function clearPreviewResultsInStore() {
  const items = await getPreviewPickupsFromStore()
  for (const item of items) {
    await upsertDeleted("preview", item.code)
  }
  await runMaintenance()
}

export async function resetBusinessDataStore() {
  await ensureTables()
  await db.execute(`
    DELETE FROM deleted_items;
    DELETE FROM picked_items;
    DELETE FROM pickups;
  `)
  Storage.remove(DATASTORE_MIGRATION_KEY)
  initPromise = null
}

export async function getPendingHomeCodesFromStore() {
  const items = await getHomePickupsFromStore()
  return items.filter((item) => !item.picked).map((item) => item.code)
}

export async function getBusinessDataStatsFromStore() {
  await ensureReady()

  const [
    pickupCount,
    pickedCount,
    deletedCount,
    homeDeletedCount,
    previewDeletedCount,
  ] = await Promise.all([
    db.fetchOne<{ count: number }>("SELECT COUNT(*) AS count FROM pickups"),
    db.fetchOne<{ count: number }>("SELECT COUNT(*) AS count FROM picked_items"),
    db.fetchOne<{ count: number }>("SELECT COUNT(*) AS count FROM deleted_items"),
    db.fetchOne<{ count: number }>("SELECT COUNT(*) AS count FROM deleted_items WHERE scope = 'home'"),
    db.fetchOne<{ count: number }>("SELECT COUNT(*) AS count FROM deleted_items WHERE scope = 'preview'"),
  ])

  return {
    path: BUSINESS_DB_PATH,
    pickups: pickupCount.count,
    pickedItems: pickedCount.count,
    deletedItems: deletedCount.count,
    homeDeletedItems: homeDeletedCount.count,
    previewDeletedItems: previewDeletedCount.count,
  }
}
