export type SymbolSettings = {
  enabledSymbols: string[]
  customSymbols: string[]
}

export const PRESET_SYMBOLS = [
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "-",
  "_",
  "=",
  "+",
  "[",
  "]",
  "{",
  "}",
  ";",
  ":",
  ",",
  ".",
  "<",
  ">",
  "/",
  "?",
  "~",
] as const

const STORAGE_KEY = "password_generator_symbol_settings_v1"

function readStorage(key: string): string | null {
  const st: any = (globalThis as any).Storage
  if (!st) return null
  if (typeof st.get === "function") return st.get(key)
  if (typeof st.getString === "function") return st.getString(key)
  return null
}

function writeStorage(key: string, value: string) {
  const st: any = (globalThis as any).Storage
  if (!st) return
  if (typeof st.set === "function") st.set(key, value)
  else if (typeof st.setString === "function") st.setString(key, value)
}

function uniqueChars(values: string[]) {
  return Array.from(new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean)))
}

export function normalizeSymbolSettings(raw?: Partial<SymbolSettings> | null): SymbolSettings {
  const customSymbols = uniqueChars(Array.isArray(raw?.customSymbols) ? raw?.customSymbols : [])
  const available = new Set([...PRESET_SYMBOLS, ...customSymbols])
  let enabledSymbols = uniqueChars(Array.isArray(raw?.enabledSymbols) ? raw?.enabledSymbols : [...PRESET_SYMBOLS])
    .filter((item) => available.has(item))
  if (!enabledSymbols.length) enabledSymbols = [PRESET_SYMBOLS[0]]
  return {
    enabledSymbols,
    customSymbols,
  }
}

export function loadSymbolSettings(): SymbolSettings {
  const raw = readStorage(STORAGE_KEY)
  if (!raw) return normalizeSymbolSettings(null)
  try {
    return normalizeSymbolSettings(JSON.parse(raw))
  } catch {
    return normalizeSymbolSettings(null)
  }
}

export function saveSymbolSettings(settings: SymbolSettings) {
  writeStorage(STORAGE_KEY, JSON.stringify(normalizeSymbolSettings(settings)))
}

export function symbolPool(settings: SymbolSettings) {
  return normalizeSymbolSettings(settings).enabledSymbols.join("")
}
