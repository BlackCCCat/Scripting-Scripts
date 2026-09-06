import type { TranslationRequest, TranslationResult } from "../types"
import { detectSourceLanguageCode } from "./translation_engine"
import { translateChunkedText } from "./translation_chunking"

const SYSTEM_TRANSLATION_CHUNK_LENGTH = 1000

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
      const source = resolveSystemLanguageCode(detectedSourceCode ?? request.sourceLanguageCode)
      const target = resolveSystemLanguageCode(request.targetLanguageCode)

      return await translateChunkedText(
        request,
        {
          maxChunkLength: SYSTEM_TRANSLATION_CHUNK_LENGTH,
          concurrency: 1,
          maxRetries: 1,
          translateChunk: async (chunkRequest) => {
            const translatedText = await translationHost.translate({
              text: chunkRequest.sourceText,
              source,
              target,
            })

            if (!translatedText.trim()) {
              throw new Error("系统翻译没有返回可用译文。")
            }

            return { translatedText: translatedText.trim() }
          },
        }
      )
    },
  }
}
