import { TRANSLATION_ENGINE_OPTIONS } from "../constants"
import type {
  BuiltInTranslationEngineKind,
  KnownTranslationEngineKind,
  TranslationEngineConfig,
  TranslatorEngineEntry,
  TranslatorSettings,
} from "../types"
import { isLocalTranslationAvailable } from "./translation_engine"

const STORAGE_KEY = "translator_settings_v2"

function builtInEntry(kind: KnownTranslationEngineKind): TranslatorEngineEntry {
  const option = TRANSLATION_ENGINE_OPTIONS.find((item) => item.id === kind)!
  const defaultEnabled = option.isDefault ?? false
  return {
    id: kind,
    kind,
    label: option.label,
    systemImage: option.systemImage,
    enabled: kind === "apple_intelligence"
      ? defaultEnabled && isLocalTranslationAvailable()
      : defaultEnabled,
    isBuiltIn: kind === "apple_intelligence" || kind === "system_translation",
  }
}

const DEFAULT_SETTINGS: TranslatorSettings = {
  engines: [
    builtInEntry("apple_intelligence"),
    builtInEntry("system_translation"),
    builtInEntry("google_translate"),
  ],
}

const REQUIRED_BUILT_INS: BuiltInTranslationEngineKind[] = [
  "apple_intelligence",
  "system_translation",
]

function storage() {
  return (globalThis as any).Storage
}

function defaultBuiltInMap() {
  return new Map(REQUIRED_BUILT_INS.map((kind) => [kind, builtInEntry(kind)]))
}

function isKnownEngineKind(kind: unknown): kind is KnownTranslationEngineKind {
  return TRANSLATION_ENGINE_OPTIONS.some((item) => item.id === kind)
}

function normalizeEngineEntry(raw: Partial<TranslatorEngineEntry> | null | undefined): TranslatorEngineEntry | null {
  if (!raw) return null

  if (isKnownEngineKind(raw.kind)) {
    const base = builtInEntry(raw.kind)
    return {
      ...base,
      enabled: raw.enabled ?? base.enabled,
      config: raw.config,
    }
  }

  if (raw.kind === "ai_api") {
    const label = String(raw.label ?? "").trim() || "AI 接口"
    const id = String(raw.id ?? "").trim() || `ai_api_${Date.now().toString(36)}`

    return {
      id,
      kind: "ai_api",
      label,
      systemImage: (() => {
        const value = String(raw.systemImage ?? "sparkles").trim()
        if (!value || value === "network") return "sparkles"
        return value
      })(),
      enabled: raw.enabled ?? false,
      isBuiltIn: false,
      config: raw.config,
    }
  }

  return null
}

function applyAvailabilityRules(entry: TranslatorEngineEntry): TranslatorEngineEntry {
  if (entry.kind === "apple_intelligence" && !isLocalTranslationAvailable()) {
    return {
      ...entry,
      enabled: false,
    }
  }

  return entry
}

function migrateLegacySettings(raw: any): TranslatorSettings | null {
  if (!raw || typeof raw !== "object") return null
  if (!Array.isArray(raw.engineOrder) || typeof raw.engineEnabled !== "object") return null

  const engines: TranslatorEngineEntry[] = []
  const order = raw.engineOrder as string[]
  const enabled = raw.engineEnabled as Record<string, boolean>

  for (const kind of order) {
    if (kind !== "apple_intelligence" && kind !== "system_translation") continue
    const entry = builtInEntry(kind)
    entry.enabled = enabled[kind] ?? entry.enabled
    engines.push(entry)
  }

  for (const option of TRANSLATION_ENGINE_OPTIONS) {
    if (!engines.find((item) => item.kind === option.id)) {
      const entry = builtInEntry(option.id)
      entry.enabled = enabled[option.id] ?? entry.enabled
      engines.push(entry)
    }
  }

  return { engines }
}

export function normalizeTranslatorSettings(raw?: Partial<TranslatorSettings> | null): TranslatorSettings {
  const legacy = migrateLegacySettings(raw)
  if (legacy) {
    return legacy
  }

  const defaults = defaultBuiltInMap()
  const normalized: TranslatorEngineEntry[] = []

  // 这里只兜底补回必须保留的内置引擎，像 Google 这类可删项不再偷偷加回来。
  for (const item of Array.isArray(raw?.engines) ? raw.engines : []) {
    const entry = normalizeEngineEntry(item)
    if (!entry) continue

    if (entry.isBuiltIn) {
      defaults.delete(entry.kind as BuiltInTranslationEngineKind)
    }

    if (!normalized.find((existing) => existing.id === entry.id)) {
      normalized.push(applyAvailabilityRules(entry))
    }
  }

  for (const entry of defaults.values()) {
    normalized.push(applyAvailabilityRules(entry))
  }

  return {
    engines: normalized,
  }
}

export function loadTranslatorSettings(): TranslatorSettings {
  const st = storage()
  if (!st?.get) {
    return DEFAULT_SETTINGS
  }

  const raw = st.get(STORAGE_KEY, { shared: true }) as TranslatorSettings | null | undefined
  if (raw == null) {
    return DEFAULT_SETTINGS
  }
  return normalizeTranslatorSettings(raw)
}

export function saveTranslatorSettings(settings: TranslatorSettings) {
  const st = storage()
  if (!st?.set) return
  st.set(STORAGE_KEY, normalizeTranslatorSettings(settings), { shared: true })
}

export function updateEngineEnabled(
  settings: TranslatorSettings,
  engineId: string,
  enabled: boolean
): TranslatorSettings {
  return normalizeTranslatorSettings({
    engines: settings.engines.map((item) => (
      item.id === engineId
        ? { ...item, enabled }
        : item
    )),
  })
}

export function updateEngineConfig(
  settings: TranslatorSettings,
  engineId: string,
  config: TranslationEngineConfig
): TranslatorSettings {
  return normalizeTranslatorSettings({
    engines: settings.engines.map((item) => (
      item.id === engineId
        ? { ...item, config: { ...config } }
        : item
    )),
  })
}

export function reorderEngines(
  settings: TranslatorSettings,
  indices: number[],
  newOffset: number
): TranslatorSettings {
  const movingItems = indices.map((index) => settings.engines[index]).filter(Boolean)
  const next = settings.engines.filter((_, index) => !indices.includes(index))
  next.splice(newOffset, 0, ...movingItems)

  return normalizeTranslatorSettings({
    engines: next,
  })
}

export function addKnownEngine(
  settings: TranslatorSettings,
  kind: KnownTranslationEngineKind
): TranslatorSettings {
  if (settings.engines.some((item) => item.kind === kind)) {
    return normalizeTranslatorSettings(settings)
  }

  return normalizeTranslatorSettings({
    engines: [...settings.engines, builtInEntry(kind)],
  })
}

export function getExecutableEngines(settings: TranslatorSettings) {
  return settings.engines
}

export function addAiApiEngine(settings: TranslatorSettings): TranslatorSettings {
  return normalizeTranslatorSettings({
    engines: [
      ...settings.engines,
      {
        id: `ai_api_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        kind: "ai_api",
        label: "AI 接口",
        systemImage: "sparkles",
        enabled: false,
        isBuiltIn: false,
        config: {
          compatibilityMode: "newapi",
          baseUrl: "",
          apiKey: "",
          model: "",
        },
      },
    ],
  })
}

export function removeEngine(
  settings: TranslatorSettings,
  engineId: string
): TranslatorSettings {
  return normalizeTranslatorSettings({
    engines: settings.engines.filter((item) => item.id !== engineId),
  })
}
