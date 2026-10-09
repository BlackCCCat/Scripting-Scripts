import { Path } from "scripting"
import type {
  AiApiCompatibilityMode, EngineTranslationState,
  TranslationEngineKind, TranslatorEngineEntry,
} from "../types"

export type HistoryEngineResult = {
  engineId: string
  engineName: string
  kind: TranslationEngineKind
  mode?: AiApiCompatibilityMode
  translatedText: string
  errorText: string
}

export type TranslationHistoryRecord = {
  id: string
  createdAt: number
  sourceText: string
  sourceLanguageCode: string
  targetLanguageCode: string
  results: HistoryEngineResult[]
}

export function historyEngineResult(engine: TranslatorEngineEntry, result: EngineTranslationState): HistoryEngineResult {
  return {
    engineId: engine.id,
    engineName: engine.label,
    kind: engine.kind,
    mode: engine.config?.compatibilityMode,
    translatedText: result.translatedText,
    errorText: result.errorText,
  }
}

export function historyResults(
  engines: TranslatorEngineEntry[],
  settled: PromiseSettledResult<EngineTranslationState | null>[]
) {
  return engines.map((engine, index) => {
    const outcome = settled[index]
    const result = outcome?.status === "fulfilled" ? outcome.value : null
    return historyEngineResult(engine, result ?? {
      engineId: engine.id,
      engineName: engine.label,
      translatedText: "",
      errorText: "翻译未完成。",
      isTranslating: false,
    })
  })
}

type HistoryRow = {
  id: string
  created_at: number
  source_text: string
  source_language: string
  target_language: string
  results_json: string
}

const DIRECTORY = Path.join(FileManager.appGroupDocumentsDirectory, "Translator")
const DB_PATH = Path.join(DIRECTORY, "translation_history.sqlite")
const LIMIT_KEY = "translator:history:limit"
export const HISTORY_LIMITS = [20, 50, 100, 200]
let databasePromise: Promise<SQLite.Database> | null = null
let resultUpdateQueue: Promise<void> = Promise.resolve()

async function database() {
  if (!databasePromise) {
    databasePromise = (async () => {
      if (!(await FileManager.exists(DIRECTORY))) {
        await FileManager.createDirectory(DIRECTORY, true)
      }
      const db = SQLite.open(DB_PATH)
      await db.execute(`
        CREATE TABLE IF NOT EXISTS translation_history (
          id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          source_text TEXT NOT NULL,
          source_language TEXT NOT NULL,
          target_language TEXT NOT NULL,
          results_json TEXT NOT NULL
        )
      `)
      return db
    })().catch((error) => {
      databasePromise = null
      throw error
    })
  }
  return databasePromise
}

export function historyLimit(): number {
  const value = Number(Storage.get<number>(LIMIT_KEY))
  return HISTORY_LIMITS.includes(value) ? value : 50
}

export async function setHistoryLimit(limit: number) {
  if (!HISTORY_LIMITS.includes(limit)) return
  const db = await database()
  await db.execute(
    "DELETE FROM translation_history WHERE id NOT IN (SELECT id FROM translation_history ORDER BY created_at DESC, rowid DESC LIMIT ?)",
    [limit]
  )
  Storage.set(LIMIT_KEY, limit)
}

export async function saveTranslationHistory(record: TranslationHistoryRecord) {
  const db = await database()
  await db.transaction([
    {
      sql: "INSERT INTO translation_history (id, created_at, source_text, source_language, target_language, results_json) VALUES (?, ?, ?, ?, ?, ?)",
      args: [
        record.id, record.createdAt, record.sourceText, record.sourceLanguageCode,
        record.targetLanguageCode, JSON.stringify(record.results),
      ],
    },
    {
      sql: "DELETE FROM translation_history WHERE id NOT IN (SELECT id FROM translation_history ORDER BY created_at DESC, rowid DESC LIMIT ?)",
      args: [historyLimit()],
    },
  ])
}

export function updateHistoryResult(id: string, result: HistoryEngineResult) {
  const update = resultUpdateQueue.then(async () => {
    const db = await database()
    const rows = await db.fetchAll<{ results_json: string }>(
      "SELECT results_json FROM translation_history WHERE id = ?", [id]
    )
    if (!rows.length) return
    const results = JSON.parse(rows[0].results_json) as HistoryEngineResult[]
    const index = results.findIndex((item) => item.engineId === result.engineId)
    if (index < 0) return
    results[index] = result
    await db.execute(
      "UPDATE translation_history SET results_json = ? WHERE id = ?",
      [JSON.stringify(results), id]
    )
  })
  resultUpdateQueue = update.catch(() => {})
  return update
}

export async function listTranslationHistory(): Promise<TranslationHistoryRecord[]> {
  const db = await database()
  const rows = await db.fetchAll<HistoryRow>(
    "SELECT * FROM translation_history ORDER BY created_at DESC, rowid DESC"
  )
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    sourceText: row.source_text,
    sourceLanguageCode: row.source_language,
    targetLanguageCode: row.target_language,
    results: JSON.parse(row.results_json) as HistoryEngineResult[],
  }))
}

export async function deleteTranslationHistory(id: string) {
  const db = await database()
  await db.execute("DELETE FROM translation_history WHERE id = ?", [id])
}

export async function clearTranslationHistory() {
  const db = await database()
  await db.execute("DELETE FROM translation_history")
}
