import type { ApiCheckResult, ApiEntry, ManagerState } from "../types"
import { normalizeBaseUrl, normalizeCompatibilityMode, normalizeWidgetRefreshHours } from "./common"

const STORAGE_KEY = "api_manager_state_v1"
const STORAGE_DIRECTORY_NAME = "API Manager"
const STORAGE_FILE_NAME = "manager_state.json"
const SHARED_STORAGE_OPTIONS = { shared: true }

export function makeEmptyCheckResult(): ApiCheckResult {
  return {
    status: "unknown",
    baseAvailable: false,
    modelsAvailable: false,
    modelIds: [],
    checkedAt: null,
    message: "尚未检测",
  }
}

function defaultState(): ManagerState {
  return {
    settings: {
      autoCheckOnLaunch: false,
      autoCheckOnAdd: true,
      widgetRefreshHours: 3,
    },
    entries: [],
  }
}

function getStorage(): any {
  return (globalThis as any).Storage
}

function getFileManager(): any {
  return (globalThis as any).FileManager
}

function joinPath(base: string, name: string): string {
  if (!base) return ""
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`
}

function storageRootDirectory(): string {
  const fileManager = getFileManager()
  const base =
    fileManager?.appGroupDocumentsDirectory ||
    fileManager?.documentsDirectory ||
    fileManager?.scriptsDirectory ||
    ""
  return joinPath(base, STORAGE_DIRECTORY_NAME)
}

function storageFilePath(): string {
  const dir = storageRootDirectory()
  return dir ? joinPath(dir, STORAGE_FILE_NAME) : ""
}

function ensureStorageDirectory(): void {
  const fileManager = getFileManager()
  const dir = storageRootDirectory()
  if (!fileManager || !dir) return
  if (!fileManager.existsSync(dir)) {
    fileManager.createDirectorySync(dir, true)
  }
}

function sanitizeEntry(raw: any): ApiEntry | null {
  const id = String(raw?.id ?? "").trim()
  const name = String(raw?.name ?? "").trim()
  const baseUrl = normalizeBaseUrl(String(raw?.baseUrl ?? ""))
  const apiKey = String(raw?.apiKey ?? "").trim()
  if (!id || !name || !baseUrl || !apiKey) return null

  const rawCheck = raw?.check ?? {}
  return {
    id,
    name,
    compatibilityMode: normalizeCompatibilityMode(raw?.compatibilityMode),
    baseUrl,
    apiKey,
    updatedAt: Number(raw?.updatedAt ?? Date.now()) || Date.now(),
    check: {
      status: rawCheck?.status ?? "unknown",
      baseAvailable: Boolean(rawCheck?.baseAvailable ?? false),
      modelsAvailable: Boolean(rawCheck?.modelsAvailable ?? false),
      modelIds: Array.isArray(rawCheck?.modelIds)
        ? rawCheck.modelIds.map((item: any) => String(item ?? "").trim()).filter(Boolean)
        : [],
      checkedAt: rawCheck?.checkedAt == null ? null : Number(rawCheck.checkedAt) || null,
      message: String(rawCheck?.message ?? "尚未检测"),
    },
  }
}

export function loadManagerState(): ManagerState {
  const st = getStorage()
  try {
    const raw = readStorageValue(st, true)
    if (raw != null) {
      const state = parseState(raw)
      persistStateToFile(state)
      return state
    }
  } catch {
  }

  try {
    const fileManager = getFileManager()
    const filePath = storageFilePath()
    if (fileManager && filePath && fileManager.existsSync(filePath)) {
      const raw = fileManager.readAsStringSync(filePath)
      return parseState(raw)
    }
  } catch {
  }

  try {
    const raw = readStorageValue(st, false)
    if (raw == null) return defaultState()
    const state = parseState(raw)
    persistStateToFile(state)
    return state
  } catch {
    return defaultState()
  }
}

export function saveManagerState(state: ManagerState): void {
  const fixed: ManagerState = {
    settings: {
      autoCheckOnLaunch: Boolean(state.settings?.autoCheckOnLaunch ?? false),
      autoCheckOnAdd: Boolean(state.settings?.autoCheckOnAdd ?? true),
      widgetRefreshHours: normalizeWidgetRefreshHours(state.settings?.widgetRefreshHours),
    },
    entries: (state.entries ?? [])
      .map((item) => sanitizeEntry(item))
      .filter(Boolean) as ApiEntry[],
  }
  const raw = JSON.stringify(fixed)
  persistStateToStorage(raw)
  persistStateToFile(fixed)
}

function parseState(raw: unknown): ManagerState {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
  const entries = Array.isArray(parsed?.entries)
    ? parsed.entries.map((item: any) => sanitizeEntry(item)).filter(Boolean) as ApiEntry[]
    : []
  return {
    settings: {
      autoCheckOnLaunch: Boolean(parsed?.settings?.autoCheckOnLaunch ?? false),
      autoCheckOnAdd: Boolean(parsed?.settings?.autoCheckOnAdd ?? true),
      widgetRefreshHours: normalizeWidgetRefreshHours(parsed?.settings?.widgetRefreshHours),
    },
    entries,
  }
}

function readStorageValue(st: any, shared: boolean): unknown {
  const options = shared ? SHARED_STORAGE_OPTIONS : undefined
  const raw = st?.get?.(STORAGE_KEY, options) ?? st?.getString?.(STORAGE_KEY, options)
  return raw == null ? null : raw
}

function persistStateToStorage(raw: string): void {
  const st = getStorage()
  if (!st) return

  try {
    if (typeof st.set === "function") {
      st.set(STORAGE_KEY, raw)
      st.set(STORAGE_KEY, raw, SHARED_STORAGE_OPTIONS)
      return
    }
    if (typeof st.setString === "function") {
      st.setString(STORAGE_KEY, raw)
      st.setString(STORAGE_KEY, raw, SHARED_STORAGE_OPTIONS)
    }
  } catch {
  }
}

function persistStateToFile(state: ManagerState): void {
  try {
    const fileManager = getFileManager()
    const filePath = storageFilePath()
    if (!fileManager || !filePath) return
    ensureStorageDirectory()
    fileManager.writeAsStringSync(filePath, JSON.stringify(state))
  } catch {
  }
}
