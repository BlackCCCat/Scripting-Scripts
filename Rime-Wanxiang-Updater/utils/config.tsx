// File: utils/config.ts
import { Runtime } from "./runtime"

export type ReleaseSource = "cnb" | "github"
export type SchemeEdition = "base" | "pro"
export type ProSchemeKey = "moqi" | "flypy" | "zrm" | "tiger" | "wubi" | "hanxin" | "shouyou"
export type OverwritePolicy = "overwrite" | "keepExisting"
export type InputMethod = "cang" | "yushu"

export type AppConfig = {
  hamsterRootPath: string
  releaseSource: ReleaseSource
  githubToken: string

  schemeEdition: SchemeEdition
  proSchemeKey: ProSchemeKey

  overwritePolicy: OverwritePolicy
  excludePatternsText: string // 按行
  autoDeployAfterDownload: boolean
  inputMethod: InputMethod
}

const KEY = "wanxiang_updater_cfg_v2"

export const DEFAULT_CONFIG: AppConfig = {
  hamsterRootPath: "",
  releaseSource: "cnb",
  githubToken: "",
  schemeEdition: "base",
  proSchemeKey: "moqi",
  overwritePolicy: "overwrite",
  excludePatternsText: "",
  autoDeployAfterDownload: true,
  inputMethod: "cang",
}

export function loadConfig(): AppConfig {
  const st: any = (globalThis as any).Storage ?? Runtime as any
  try {
    const raw = st?.get?.(KEY) ?? st?.getString?.(KEY)
    if (!raw) return DEFAULT_CONFIG
    const obj = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...obj }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(cfg: AppConfig) {
  const st: any = (globalThis as any).Storage ?? Runtime as any
  const raw = JSON.stringify(cfg)
  if (st?.set) st.set(KEY, raw)
  else if (st?.setString) st.setString(KEY, raw)
  else throw new Error("Storage API 不存在：请确认 Scripting 是否提供 Storage.set/get")
}

export function getExcludePatterns(cfg: AppConfig): string[] {
  return cfg.excludePatternsText
    .split(/\r?\n/g)
    .map(s => s.trim())
    .filter(Boolean)
}
