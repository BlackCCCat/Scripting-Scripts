import type { TranslationRequest, TranslationResult } from "../types"
import { detectSourceLanguageCode } from "./translation_engine"

function resolveSystemLanguageCode(code: string) {
  if (code === "auto") return undefined
  if (code === "zh-Hans") return "zh"
  if (code === "zh-Hant") return "zh-Hant"
  return code
}

export function isSystemTranslationAvailable() {
  try {
    return typeof Translation !== "undefined" && !!Translation.shared
  } catch {
    return false
  }
}

export function createSystemTranslationEngine(translationHost: Translation) {
  return {
    async translate(request: TranslationRequest): Promise<TranslationResult> {
      const detectedSourceCode = request.sourceLanguageCode === "auto"
        ? await detectSourceLanguageCode(request.sourceText)
        : undefined

      const translatedText = await translationHost.translate({
        text: request.sourceText,
        source: resolveSystemLanguageCode(detectedSourceCode ?? request.sourceLanguageCode),
        target: resolveSystemLanguageCode(request.targetLanguageCode),
      })

      if (!translatedText.trim()) {
        throw new Error("系统翻译没有返回可用译文。")
      }

      return {
        translatedText: translatedText.trim(),
      }
    },
  }
}
