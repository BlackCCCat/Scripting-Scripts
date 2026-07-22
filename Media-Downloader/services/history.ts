import { Path } from "scripting"
import type { DownloadedFile, DownloadSuccess } from "./douyin"

export type HistoryRecord = {
  id: string
  source_url: string
  page_url: string
  canonical_url: string | null
  title: string
  description: string | null
  thumbnail_url: string | null
  file_path: string
  file_name: string
  final_url: string
  bytes_written: number
  created_at: string
  matched_candidate_label: string
  media_type: "video" | "image" | null
  files_json: string | null
}

const ROOT_DIR = Path.join(FileManager.documentsDirectory, "douyin-downloader")
const DB_PATH = Path.join(ROOT_DIR, "history.sqlite")
let db: SQLite.Database | null = null

async function ensureRootDir() {
  if (!(await FileManager.exists(ROOT_DIR))) {
    await FileManager.createDirectory(ROOT_DIR, true)
  }
}

async function getDatabase(): Promise<SQLite.Database> {
  await ensureRootDir()
  if (!db) {
    db = SQLite.open(DB_PATH)
  }
  return db
}

export async function initDatabase() {
  const database = await getDatabase()

  await database.execute(`
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      page_url TEXT NOT NULL,
      canonical_url TEXT,
      title TEXT NOT NULL,
      description TEXT,
      thumbnail_url TEXT,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      final_url TEXT NOT NULL,
      bytes_written INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      matched_candidate_label TEXT NOT NULL DEFAULT '',
      media_type TEXT,
      files_json TEXT
    )
  `)

  try {
    await database.execute(`ALTER TABLE downloads ADD COLUMN matched_candidate_label TEXT NOT NULL DEFAULT ''`)
  } catch {}

  try {
    await database.execute(`ALTER TABLE downloads ADD COLUMN thumbnail_url TEXT`)
  } catch {}

  try {
    await database.execute(`ALTER TABLE downloads ADD COLUMN media_type TEXT`)
  } catch {}

  try {
    await database.execute(`ALTER TABLE downloads ADD COLUMN files_json TEXT`)
  } catch {}
}

export async function listHistory(): Promise<HistoryRecord[]> {
  const database = await getDatabase()
  return database.fetchAll<HistoryRecord>(`
    SELECT
      id,
      source_url,
      page_url,
      canonical_url,
      title,
      description,
      thumbnail_url,
      file_path,
      file_name,
      final_url,
      bytes_written,
      created_at,
      matched_candidate_label,
      media_type,
      files_json
    FROM downloads
    ORDER BY datetime(created_at) DESC
  `)
}

async function listHistoryOldestFirst(): Promise<HistoryRecord[]> {
  const database = await getDatabase()
  return database.fetchAll<HistoryRecord>(`
    SELECT
      id,
      source_url,
      page_url,
      canonical_url,
      title,
      description,
      thumbnail_url,
      file_path,
      file_name,
      final_url,
      bytes_written,
      created_at,
      matched_candidate_label,
      media_type,
      files_json
    FROM downloads
    ORDER BY datetime(created_at) ASC
  `)
}

export function getHistoryFiles(record: HistoryRecord): DownloadedFile[] {
  const files: DownloadedFile[] = []
  const seen = new Set<string>()

  const addFile = (file: Partial<DownloadedFile> & Record<string, unknown>) => {
    const filePath = typeof file.filePath === "string" ? file.filePath : typeof file.file_path === "string" ? file.file_path : ""
    const fileName = typeof file.fileName === "string" ? file.fileName : typeof file.file_name === "string" ? file.file_name : Path.basename(filePath || record.file_path)
    if (!filePath || !fileName || seen.has(filePath)) return
    seen.add(filePath)
    files.push({
      filePath,
      fileName,
      finalURL: typeof file.finalURL === "string" ? file.finalURL : typeof file.final_url === "string" ? file.final_url : record.final_url,
      bytesWritten: typeof file.bytesWritten === "number" ? file.bytesWritten : typeof file.bytes_written === "number" ? file.bytes_written : 0,
      mediaType: file.mediaType === "image" || file.media_type === "image" ? "image" : "video",
    })
  }

  if (record.files_json) {
    try {
      const parsedFiles = JSON.parse(record.files_json)
      if (Array.isArray(parsedFiles)) {
        for (const file of parsedFiles) {
          if (file && typeof file === "object") addFile(file as Record<string, unknown>)
        }
      }
    } catch {}
  }

  addFile({
    filePath: record.file_path,
    fileName: record.file_name,
    finalURL: record.final_url,
    bytesWritten: record.bytes_written,
    mediaType: record.media_type === "image" ? "image" : "video",
  })

  return files
}

export async function removeHistoryRecordFiles(record: HistoryRecord): Promise<{ deletedCount: number; deletedBytes: number }> {
  const files = getHistoryFiles(record)
  const seen = new Set<string>()
  let deletedCount = 0
  let deletedBytes = 0

  for (const file of files) {
    if (!file.filePath || seen.has(file.filePath)) continue
    seen.add(file.filePath)
    try {
      if (!FileManager.existsSync(file.filePath)) continue
      const size = FileManager.statSync(file.filePath).size || 0
      FileManager.removeSync(file.filePath)
      deletedCount += 1
      deletedBytes += size
    } catch {}
  }

  const database = await getDatabase()
  await database.execute(`UPDATE downloads SET files_json = ? WHERE id = ?`, ["[]", record.id])
  return { deletedCount, deletedBytes }
}

async function historyRecordCachedBytes(record: HistoryRecord): Promise<number> {
  let total = 0
  const seen = new Set<string>()
  for (const file of getHistoryFiles(record)) {
    if (!file.filePath || seen.has(file.filePath)) continue
    seen.add(file.filePath)
    try {
      if (FileManager.existsSync(file.filePath)) {
        total += FileManager.statSync(file.filePath).size || 0
      }
    } catch {}
  }
  return total
}

export async function pruneHistoryStorage(options: {
  maxCacheBytes: number | null
  maxRecordCount: number | null
}): Promise<{ deletedFiles: number; deletedFileBytes: number; deletedRecords: number }> {
  let deletedFiles = 0
  let deletedFileBytes = 0
  let deletedRecords = 0

  if (options.maxRecordCount != null) {
    const records = await listHistoryOldestFirst()
    const overflow = records.length - options.maxRecordCount
    if (overflow > 0) {
      for (const record of records.slice(0, overflow)) {
        const deleted = await removeHistoryRecordFiles(record)
        deletedFiles += deleted.deletedCount
        deletedFileBytes += deleted.deletedBytes
        await deleteHistoryRecord(record.id)
        deletedRecords += 1
      }
    }
  }

  if (options.maxCacheBytes != null) {
    const records = await listHistoryOldestFirst()
    let totalBytes = 0
    const recordBytes = new Map<string, number>()
    for (const record of records) {
      const bytes = await historyRecordCachedBytes(record)
      recordBytes.set(record.id, bytes)
      totalBytes += bytes
    }

    for (const record of records) {
      if (totalBytes <= options.maxCacheBytes) break
      const bytes = recordBytes.get(record.id) || 0
      if (bytes <= 0) continue
      const deleted = await removeHistoryRecordFiles(record)
      deletedFiles += deleted.deletedCount
      deletedFileBytes += deleted.deletedBytes
      totalBytes -= bytes
    }
  }

  return { deletedFiles, deletedFileBytes, deletedRecords }
}

export async function insertHistory(record: DownloadSuccess, options?: { preserveFiles?: boolean }) {
  const database = await getDatabase()
  const preserveFiles = options?.preserveFiles === true
  await database.execute(
    `
      INSERT OR REPLACE INTO downloads (
        id, source_url, page_url, canonical_url, title, description,
        thumbnail_url, file_path, file_name, final_url, bytes_written, created_at,
        matched_candidate_label, media_type, files_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      record.id,
      record.sourceURL,
      record.extracted.pageURL,
      record.extracted.canonical,
      record.extracted.title,
      record.extracted.description,
      record.extracted.thumbnailURL,
      record.filePath,
      record.fileName,
      record.finalURL,
      record.bytesWritten,
      record.createdAt,
      record.matchedCandidateLabel,
      record.mediaType,
      JSON.stringify(preserveFiles ? (record.files || []) : []),
    ]
  )
}

export async function deleteHistoryRecord(id: string) {
  const database = await getDatabase()
  await database.execute(`DELETE FROM downloads WHERE id = ?`, [id])
}

export async function clearHistoryRecords() {
  const database = await getDatabase()
  await database.execute(`DELETE FROM downloads`)
}
