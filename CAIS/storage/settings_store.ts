import { DEFAULT_CAIS_SETTINGS, type CaisSettings, type KeyboardCustomAction, type KeyboardMenuBuiltinAction } from "../types"

const SETTINGS_KEY = "cais_settings_v1"
const SHARED_OPTIONS = { shared: true }

function getStorage(): any {
  return (globalThis as any).Storage
}

function sanitizeCustomActionMode(value: any): KeyboardCustomAction["mode"] {
  if (value === "regex" || value === "regexExtract") return "regexExtract"
  if (value === "regexRemove") return "regexRemove"
  if (value === "javascript") return "javascript"
  return "template"
}

function sanitizeSettings(raw: any): CaisSettings {
  const monitorIntervalMs = Number(raw?.monitorIntervalMs ?? DEFAULT_CAIS_SETTINGS.monitorIntervalMs)
  const maxItems = Number(raw?.maxItems ?? DEFAULT_CAIS_SETTINGS.maxItems)
  const appContentLineLimit = Number(raw?.appContentLineLimit ?? DEFAULT_CAIS_SETTINGS.appContentLineLimit)
  const keyboardMaxItems = Number(raw?.keyboardMaxItems ?? DEFAULT_CAIS_SETTINGS.keyboardMaxItems)
  const defaultBuiltins = DEFAULT_CAIS_SETTINGS.keyboardMenu.builtins
  const rawBuiltins = raw?.keyboardMenu?.builtins ?? {}
  const builtinKeys = Object.keys(defaultBuiltins) as KeyboardMenuBuiltinAction[]
  const builtins = builtinKeys.reduce((result, key) => {
    result[key] = Boolean(rawBuiltins[key] ?? defaultBuiltins[key])
    return result
  }, {} as Record<KeyboardMenuBuiltinAction, boolean>)
  const builtinOrder = Array.isArray(raw?.keyboardMenu?.builtinOrder)
    ? raw.keyboardMenu.builtinOrder
      .filter((key: any) => builtinKeys.includes(key))
      .map((key: any) => key as KeyboardMenuBuiltinAction)
    : undefined
  const customActions = Array.isArray(raw?.keyboardMenu?.customActions)
    ? raw.keyboardMenu.customActions
      .map((item: any): KeyboardCustomAction => ({
        id: String(item?.id ?? `custom_${Date.now()}`),
        title: String(item?.title ?? "").trim(),
        mode: sanitizeCustomActionMode(item?.mode),
        template: String(item?.template ?? ""),
        regex: String(item?.regex ?? ""),
        regexRemoveAll: Boolean(item?.regexRemoveAll ?? false),
        script: String(item?.script ?? ""),
        enabled: Boolean(item?.enabled ?? true),
      }))
      .filter((item: KeyboardCustomAction) => item.title && (
        item.mode === "template" ? item.template :
        item.mode === "javascript" ? item.script :
        item.regex
      ))
      .slice(0, 12)
    : []
  return {
    captureText: Boolean(raw?.captureText ?? DEFAULT_CAIS_SETTINGS.captureText),
    captureImages: Boolean(raw?.captureImages ?? DEFAULT_CAIS_SETTINGS.captureImages),
    monitorIntervalMs: Math.max(100, Math.min(10000, monitorIntervalMs || DEFAULT_CAIS_SETTINGS.monitorIntervalMs)),
    duplicatePolicy: raw?.duplicatePolicy === "skip" ? "skip" : "bump",
    maxItems: Math.max(50, Math.min(800, maxItems || DEFAULT_CAIS_SETTINGS.maxItems)),
    appContentLineLimit: Math.max(1, Math.min(12, appContentLineLimit || DEFAULT_CAIS_SETTINGS.appContentLineLimit)),
    keyboardShowTitle: Boolean(raw?.keyboardShowTitle ?? DEFAULT_CAIS_SETTINGS.keyboardShowTitle),
    keyboardMaxItems: [10, 20, 30, 40, 50].includes(keyboardMaxItems) ? keyboardMaxItems : DEFAULT_CAIS_SETTINGS.keyboardMaxItems,
    keyboardMenu: {
      builtins,
      builtinOrder,
      customActions,
    },
  }
}

export function loadSettings(): CaisSettings {
  const st = getStorage()
  try {
    const raw = st?.get?.(SETTINGS_KEY, SHARED_OPTIONS) ?? st?.getString?.(SETTINGS_KEY, SHARED_OPTIONS)
    if (raw != null) return sanitizeSettings(typeof raw === "string" ? JSON.parse(raw) : raw)
  } catch {
  }
  try {
    const raw = st?.get?.(SETTINGS_KEY) ?? st?.getString?.(SETTINGS_KEY)
    if (raw != null) return sanitizeSettings(typeof raw === "string" ? JSON.parse(raw) : raw)
  } catch {
  }
  return { ...DEFAULT_CAIS_SETTINGS }
}

export function saveSettings(settings: CaisSettings): CaisSettings {
  const fixed = sanitizeSettings(settings)
  const raw = JSON.stringify(fixed)
  const st = getStorage()
  try {
    if (typeof st?.set === "function") {
      st.set(SETTINGS_KEY, raw)
      st.set(SETTINGS_KEY, raw, SHARED_OPTIONS)
    } else if (typeof st?.setString === "function") {
      st.setString(SETTINGS_KEY, raw)
      st.setString(SETTINGS_KEY, raw, SHARED_OPTIONS)
    }
  } catch {
  }
  return fixed
}
