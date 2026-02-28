// File: utils/config.ts
import { Runtime } from "./runtime"

export type ReleaseSource = "cnb" | "github"
export type SchemeEdition = "base" | "pro"
export type ProSchemeKey = "moqi" | "flypy" | "zrm" | "tiger" | "wubi" | "hanxin" | "shouyou"
export type InputMethod = "hamster" | "hamster3"

export const PRO_KEYS: ProSchemeKey[] = ["moqi", "flypy", "zrm", "tiger", "wubi", "hanxin", "shouyou"]

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
  const raw = JSON.stringify(cfg)
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
