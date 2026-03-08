// File: utils/config.ts
import { Runtime } from "./runtime"

export type ReleaseSource = "cnb" | "github"
export type SchemeEdition = "base" | "pro"
export type ProSchemeKey = "moqi" | "flypy" | "zrm" | "tiger" | "wubi" | "hanxin" | "shouyou"
export type InputMethod = "hamster" | "hamster3"
export type HomeSectionKey = "local" | "remote" | "notes" | "actions" | "status"

export const PRO_KEYS: ProSchemeKey[] = ["moqi", "flypy", "zrm", "tiger", "wubi", "hanxin", "shouyou"]
export const HOME_SECTION_KEYS: HomeSectionKey[] = ["local", "remote", "notes", "actions", "status"]
export const HOME_SECTION_LABELS: Record<HomeSectionKey, string> = {
  local: "本地信息",
  remote: "远程信息",
  notes: "更新说明",
  actions: "操作",
  status: "状态",
}

export type AppConfig = {
  hamsterRootPath: string
  hamsterBookmarkName: string
  releaseSource: ReleaseSource
  githubToken: string

  schemeEdition: SchemeEdition
  proSchemeKey: ProSchemeKey

  excludePatternsText: string // 按行
  autoDeployAfterDownload: boolean
  inputMethod: InputMethod
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
  githubToken: "",
  schemeEdition: "base",
  proSchemeKey: "moqi",
  excludePatternsText: "",
  autoDeployAfterDownload: true,
  inputMethod: "hamster",
  autoCheckOnLaunch: false,
  showVerboseLog: true,
  homeSectionOrder: HOME_SECTION_KEYS.slice(),
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
    if (obj?.inputMethod === "yushu" || obj?.inputMethod === "yuanshu") obj.inputMethod = "hamster3"
    if (typeof obj?.hamsterBookmarkName !== "string") obj.hamsterBookmarkName = ""
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
  const raw = JSON.stringify({
    ...cfg,
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
