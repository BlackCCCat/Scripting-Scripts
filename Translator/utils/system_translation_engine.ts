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

type InstalledTranslation = Translation & {
  translateInstalled(options: { text: string; source: string; target?: string }): Promise<string>
}

function installedTranslation(): InstalledTranslation | null {
  try {
    if (!(Number.parseInt(Device.systemVersion, 10) >= 26) || typeof Translation === "undefined") return null
    const shared = Translation.shared as Partial<InstalledTranslation>
    return typeof shared?.translateInstalled === "function" ? shared as InstalledTranslation : null
  } catch {
    return null
  }
}

export function isInstalledSystemTranslationAvailable() {
  return installedTranslation() !== null
}

export function createInstalledSystemTranslationEngine() {
  return {
    async translate(request: TranslationRequest): Promise<TranslationResult> {
      const translation = installedTranslation()
      if (!translation) throw new Error("当前系统或 Scripting 版本不支持离线系统翻译。")

      const source = request.sourceLanguageCode === "auto"
        ? await detectSourceLanguageCode(request.sourceText)
        : request.sourceLanguageCode
      if (!source || source === "auto") {
        throw new Error("无法识别源语言，请手动选择源语言后重试。")
      }
      if (source === request.targetLanguageCode) {
        throw new Error("源语言和目标语言不能相同。")
      }

      try {
        return await translateChunkedText(request, {
          maxChunkLength: SYSTEM_TRANSLATION_CHUNK_LENGTH,
          concurrency: 1,
          maxRetries: 0,
          translateChunk: async ({ sourceText }) => {
            const translatedText = await translation.translateInstalled({
              text: sourceText,
              source,
              target: request.targetLanguageCode,
            })
            if (!translatedText.trim()) throw new Error("离线系统翻译没有返回可用译文。")
            return { translatedText: translatedText.trim() }
          },
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`离线系统翻译失败：${reason}。如果尚未安装语言包，请先使用 System Translate 按系统提示下载源语言和目标语言。`)
      }
    },
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
