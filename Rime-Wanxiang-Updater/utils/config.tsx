// File: utils/config.ts
import { Runtime } from "./runtime"

export type ReleaseSource = "cnb" | "github"
export type SchemeEdition = "base" | "pro" | "pure" | "lite"
export type ProSchemeKey = "moqi" | "flypy" | "zrm" | "tiger" | "wubi" | "hanxin" | "shouyou" | "shyplus" | "wx"
export type InputMethod = "hamster" | "hamster3" | "scripting"
export type HomeSectionKey = "local" | "remote" | "notes" | "status"

export const BUILTIN_SCRIPTING_BOOKMARK = "__builtin_scripting_rime__"
export const BUILTIN_SCRIPTING_LABEL = "Scripting Rime"

export const PRO_KEYS: ProSchemeKey[] = ["moqi", "flypy", "zrm", "tiger", "wubi", "hanxin", "shouyou", "shyplus", "wx"]
export const HOME_SECTION_KEYS: HomeSectionKey[] = ["local", "remote", "notes", "status"]
export const HOME_SECTION_LABELS: Record<HomeSectionKey, string> = {
  local: "本地信息",
  remote: "远程信息",
  notes: "更新说明",
  status: "状态",
}

export type AppConfig = {
  hamsterRootPath: string
  hamsterBookmarkName: string
  releaseSource: ReleaseSource
  usePrereleaseScheme: boolean
  githubToken: string
  cnbToken: string

  schemeEdition: SchemeEdition
  proSchemeKey: ProSchemeKey

  excludePatternsText: string // 按行
  autoDeployAfterDownload: boolean
  skipBuildCleanup: boolean
  downloadModel: boolean
  downloadModelByInputMethod: Partial<Record<InputMethod, boolean>>
  inputMethod: InputMethod
  useBuiltinScriptingPath: boolean
  visibleBookmarkNames: string[]
  syncUpdateToScriptingRime: boolean
  syncUpdateToScriptingRimeByBookmark: Record<string, boolean>
  autoCheckOnLaunch: boolean
  showVerboseLog: boolean
  homeSectionOrder: HomeSectionKey[]
}

const STORAGE_KEY = "wanxiang_updater_config"
const LEGACY_STORAGE_KEYS = ["wanxiang_updater_cfg_v2", "wanxiang_updater_cfg_v1"]

function readStorageValue(st: any, key: string): string {
  const raw = st?.get?.(key) ?? st?.getString?.(key)
  return typeof raw === "string" ? raw : ""
}

export const DEFAULT_CONFIG: AppConfig = {
  hamsterRootPath: "",
  hamsterBookmarkName: "",
  releaseSource: "cnb",
  usePrereleaseScheme: false,
  githubToken: "",
  cnbToken: "",
  schemeEdition: "base",
  proSchemeKey: "moqi",
  excludePatternsText: "",
  autoDeployAfterDownload: true,
  skipBuildCleanup: false,
  downloadModel: false,
  downloadModelByInputMethod: {},
  inputMethod: "hamster",
  useBuiltinScriptingPath: false,
  visibleBookmarkNames: [],
  syncUpdateToScriptingRime: false,
  syncUpdateToScriptingRimeByBookmark: {},
  autoCheckOnLaunch: false,
  showVerboseLog: true,
  homeSectionOrder: ["local", "status", "remote", "notes"],
}

export function normalizeHomeSectionOrder(input: unknown): HomeSectionKey[] {
  const list = Array.isArray(input) ? input : []
  const uniq = new Set<HomeSectionKey>()
  for (const item of list) {
    if ((HOME_SECTION_KEYS as string[]).includes(String(item))) {
      uniq.add(String(item) as HomeSectionKey)
    }
  }
  for (const key of HOME_SECTION_KEYS) uniq.add(key)
  return Array.from(uniq)
}

export function bookmarkConfigScopeKey(cfg: Pick<AppConfig, "hamsterBookmarkName" | "hamsterRootPath">): string {
  const bookmarkName = String(cfg.hamsterBookmarkName ?? "").trim()
  if (bookmarkName) return `bookmark:${bookmarkName}`
  const rootPath = String(cfg.hamsterRootPath ?? "").trim().replace(/\/+$/, "")
  return rootPath ? `path:${rootPath}` : ""
}

export function syncUpdateToScriptingRimeForConfig(cfg: AppConfig): boolean {
  const key = bookmarkConfigScopeKey(cfg)
  return key ? cfg.syncUpdateToScriptingRimeByBookmark[key] === true : false
}

export function withSyncUpdateToScriptingRime(cfg: AppConfig, enabled: boolean): AppConfig {
  const key = bookmarkConfigScopeKey(cfg)
  const byBookmark = { ...cfg.syncUpdateToScriptingRimeByBookmark }
  if (key) byBookmark[key] = enabled
  return {
    ...cfg,
    syncUpdateToScriptingRime: enabled,
    syncUpdateToScriptingRimeByBookmark: byBookmark,
  }
}

export function loadConfig(): AppConfig {
  const st: any = (globalThis as any).Storage ?? Runtime as any
  try {
    let raw = readStorageValue(st, STORAGE_KEY)
    if (!raw) {
      for (const key of LEGACY_STORAGE_KEYS) {
        raw = readStorageValue(st, key)
        if (raw) break
      }
    }
    if (!raw) return DEFAULT_CONFIG
    const obj = JSON.parse(raw)
    if (obj?.inputMethod === "cang") obj.inputMethod = "hamster"
    if (obj?.inputMethod === "yuanshu") obj.inputMethod = "hamster3"
    if (typeof obj?.hamsterBookmarkName !== "string") obj.hamsterBookmarkName = ""
    if (obj && typeof obj === "object") {
      delete obj.usePredictDb
      delete obj.deletePredictDbWhenUnused
    }
    if (!obj || typeof obj !== "object") return DEFAULT_CONFIG
    if (typeof obj.downloadModel !== "boolean") obj.downloadModel = DEFAULT_CONFIG.downloadModel
    if (!obj.downloadModelByInputMethod || typeof obj.downloadModelByInputMethod !== "object") {
      obj.downloadModelByInputMethod = {}
    }
    if (!Array.isArray(obj.visibleBookmarkNames)) {
      const currentBookmark = String(obj.hamsterBookmarkName ?? "").trim()
      obj.visibleBookmarkNames = currentBookmark && currentBookmark !== BUILTIN_SCRIPTING_BOOKMARK
        ? [currentBookmark]
        : []
    }
    if (!obj.syncUpdateToScriptingRimeByBookmark || typeof obj.syncUpdateToScriptingRimeByBookmark !== "object") {
      obj.syncUpdateToScriptingRimeByBookmark = {}
      const key = bookmarkConfigScopeKey(obj as AppConfig)
      if (key && obj.syncUpdateToScriptingRime === true) {
        obj.syncUpdateToScriptingRimeByBookmark[key] = true
      }
    }
    obj.syncUpdateToScriptingRime = syncUpdateToScriptingRimeForConfig({ ...DEFAULT_CONFIG, ...obj })
    obj.homeSectionOrder = normalizeHomeSectionOrder(obj?.homeSectionOrder)
    const cfg = { ...DEFAULT_CONFIG, ...obj }
    const currentRaw = readStorageValue(st, STORAGE_KEY)
    if (!currentRaw) saveConfig(cfg)
    return cfg
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(cfg: AppConfig) {
  const st: any = (globalThis as any).Storage ?? Runtime as any
  const scopeKey = bookmarkConfigScopeKey(cfg)
  const syncByBookmark = { ...cfg.syncUpdateToScriptingRimeByBookmark }
  if (scopeKey) syncByBookmark[scopeKey] = cfg.syncUpdateToScriptingRime === true
  const raw = JSON.stringify({
    ...cfg,
    syncUpdateToScriptingRimeByBookmark: syncByBookmark,
    homeSectionOrder: normalizeHomeSectionOrder(cfg.homeSectionOrder),
  })
  if (st?.set) st.set(STORAGE_KEY, raw)
  else if (st?.setString) st.setString(STORAGE_KEY, raw)
  else throw new Error("Storage API 不存在：请确认 Scripting 是否提供 Storage.set/get")
}

export function getExcludePatterns(cfg: AppConfig): string[] {
  return cfg.excludePatternsText
    .split(/\r?\n/g)
    .map(s => s.trim())
    .filter(Boolean)
}
