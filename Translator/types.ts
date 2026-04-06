export type LanguageOption = {
  code: string
  label: string
  promptName: string
}

export type BuiltInTranslationEngineKind =
  | "apple_intelligence"
  | "assistant"
  | "system_translation"

export type ExternalTranslationEngineKind =
  | "google_translate"

export type KnownTranslationEngineKind =
  | BuiltInTranslationEngineKind
  | ExternalTranslationEngineKind

export type AiApiCompatibilityMode = "newapi" | "openai" | "gemini"

export type TranslationEngineKind =
  | KnownTranslationEngineKind
  | "ai_api"

export type TranslationEngineOption = {
  id: KnownTranslationEngineKind
  label: string
  systemImage: string
  isDefault?: boolean
}

export type TranslationEngineConfig = {
  apiKey?: string
  compatibilityMode?: AiApiCompatibilityMode
  baseUrl?: string
  model?: string
}

export type TranslatorEngineEntry = {
  id: string
  kind: TranslationEngineKind
  label: string
  systemImage: string
  enabled: boolean
  isBuiltIn: boolean
  config?: TranslationEngineConfig
}

export type TranslatorSettings = {
  engines: TranslatorEngineEntry[]
}

export type TranslationRequest = {
  sourceText: string
  sourceLanguageCode: string
  targetLanguageCode: string
}

export type TranslationResult = {
  translatedText: string
}

export type EngineTranslationState = {
  engineId: string
  engineName: string
  systemImage: string
  translatedText: string
  errorText: string
  isTranslating: boolean
}
