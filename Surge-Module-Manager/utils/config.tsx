export type AppConfig = {
  baseDir: string
  baseBookmarkName: string
  categories: string[]
  linkPatternsText: string
}

const KEY = "surge_modules_manager_cfg_v1"

const DEFAULT_CONFIG: AppConfig = {
  baseDir: "",
  baseBookmarkName: "",
  categories: [],
  linkPatternsText: "#!url=",
}

function normalizeCategories(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list ?? []) {
    const name = String(raw ?? "").trim()
    if (!name) continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function loadConfig(): AppConfig {
  const st: any = (globalThis as any).Storage
  try {
    const raw = st?.get?.(KEY) ?? st?.getString?.(KEY)
    if (!raw) return DEFAULT_CONFIG
    const obj = JSON.parse(raw)
    const categories = normalizeCategories(obj?.categories ?? [])
    const baseDir = String(obj?.baseDir ?? "").trim()
    const baseBookmarkName = String(obj?.baseBookmarkName ?? "").trim()
    const linkPatternsText = String(obj?.linkPatternsText ?? DEFAULT_CONFIG.linkPatternsText)
    return { ...DEFAULT_CONFIG, ...obj, categories, baseDir, baseBookmarkName, linkPatternsText }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(cfg: AppConfig): void {
  const st: any = (globalThis as any).Storage
  const fixed: AppConfig = {
    baseDir: String(cfg.baseDir ?? "").trim(),
    baseBookmarkName: String(cfg.baseBookmarkName ?? "").trim(),
    categories: normalizeCategories(cfg.categories ?? []),
    linkPatternsText: String(cfg.linkPatternsText ?? DEFAULT_CONFIG.linkPatternsText),
  }
  const raw = JSON.stringify(fixed)
  if (st?.set) st.set(KEY, raw)
  else if (st?.setString) st.setString(KEY, raw)
  else throw new Error("Storage API 不存在：请确认 Scripting 是否提供 Storage.set/get")
}

export function addCategory(cfg: AppConfig, name: string): AppConfig {
  const categories = normalizeCategories([...(cfg.categories ?? []), name])
  return { ...cfg, categories }
}

export function removeCategory(cfg: AppConfig, name: string): AppConfig {
  const categories = normalizeCategories((cfg.categories ?? []).filter((c) => c !== name))
  return { ...cfg, categories }
}
