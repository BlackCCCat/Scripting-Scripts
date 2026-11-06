import type { TranslationProgressCallbacks, TranslationRequest, TranslationResult, TranslatorEngineEntry } from "../types"
import { createAssistantTranslationEngine } from "./assistant_translation_engine"
import { translateWithExternalEngine } from "./external_translation_engines"
import { createInstalledSystemTranslationEngine, createSystemTranslationEngine } from "./system_translation_engine"
import { createTranslationEngine, detectSourceLanguageCode, SAME_LANGUAGE_MESSAGE } from "./translation_engine"
import { historyEngineResult, saveTranslationHistory } from "./translation_history"
import { photoContext } from "./photo_translation_context"

export type PhotoTextBlock = {
  text: string
  translatedText: string
  box: { x: number; y: number; width: number; height: number }
}

export type PhotoTranslation = {
  sourceText: string
  translatedText: string
  sourceLanguageCode: string
  targetLanguageCode: string
  blocks: PhotoTextBlock[]
}

export async function translatePhoto(input: {
  engine: TranslatorEngineEntry
  sourceLanguageCode: string
  targetLanguageCode: string
  translationHost: Translation
  recognized: Pick<PhotoTranslation, "blocks">
  onProgress: (message: string) => void
  onBlock?: (index: number, translatedText: string) => void
  isCurrent: () => boolean
}): Promise<PhotoTranslation> {
  if (!input.isCurrent()) throw new Error("已取消翻译。")
  const blocks = input.recognized.blocks.map((block) => ({ ...block, translatedText: "" }))
  const sourceText = blocks.map((block) => block.text).join("\n")
  if (!sourceText) throw new Error("没有识别到可翻译的文字。")
  if (!blocks.length) throw new Error("识别到了文字，但无法定位文字区域，无法覆盖到图片上。")
  const source = input.sourceLanguageCode === "auto"
    ? (await detectSourceLanguageCode(sourceText)) ?? "auto"
    : input.sourceLanguageCode
  const target = input.targetLanguageCode === "auto"
    ? source.startsWith("zh") ? "en" : "zh-Hans"
    : input.targetLanguageCode
  if (source === target) throw new Error(SAME_LANGUAGE_MESSAGE)
  if (!input.isCurrent()) throw new Error("已取消翻译。")

  const appleEngine = createTranslationEngine()
  const systemEngine = createSystemTranslationEngine(input.translationHost)
  const installedEngine = createInstalledSystemTranslationEngine()
  function recordHistory(translatedText: string, errorText: string) {
    if (!input.isCurrent()) return
    void saveTranslationHistory({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(), sourceText, sourceLanguageCode: source, targetLanguageCode: target,
      results: [historyEngineResult(input.engine, {
        engineId: input.engine.id, engineName: input.engine.label,
        translatedText, errorText, isTranslating: false,
      })],
    }).catch((error) => console.error("[Translator] 保存拍照翻译历史失败", error))
  }
  function translate(index: number, callbacks: TranslationProgressCallbacks): Promise<TranslationResult> {
    const engine = input.engine
    const request: TranslationRequest = {
      sourceText: blocks[index].text, sourceLanguageCode: source, targetLanguageCode: target,
      ...(["apple_intelligence", "assistant", "ai_api"].includes(engine.kind)
        ? { photoContext: photoContext(blocks, index) } : {}),
    }
    if (engine.kind === "apple_intelligence") return appleEngine.translate(request, callbacks)
    if (engine.kind === "assistant") return createAssistantTranslationEngine(engine.config).translate(request, callbacks)
    if (engine.kind === "system_translation") return systemEngine.translate(request)
    if (engine.kind === "system_translation_offline") return installedEngine.translate(request)
    return translateWithExternalEngine(engine, request, callbacks)
  }

  try {
    let next = 0
    const errors: unknown[] = []
    const concurrency = input.engine.kind === "apple_intelligence" ||
      input.engine.kind === "system_translation" || input.engine.kind === "system_translation_offline" ? 1 : 2
    await Promise.all(Array.from({ length: Math.min(concurrency, blocks.length) }, async () => {
      while (next < blocks.length && input.isCurrent()) {
        const index = next++
        input.onProgress(`正在翻译 ${index + 1}/${blocks.length}…`)
        let lastPartialAt = 0
        try {
          const translatedText = (await translate(index, {
            onPartialText: (partialText) => {
              if (!input.isCurrent() || Date.now() - lastPartialAt < 150) return
              lastPartialAt = Date.now()
              input.onBlock?.(index, partialText)
            },
          })).translatedText.trim()
          if (!input.isCurrent()) return
          blocks[index].translatedText = translatedText
          input.onBlock?.(index, translatedText)
        } catch (error) {
          errors.push(error)
          console.warn("[Translator] 拍照翻译块失败", {
            engine: input.engine.label,
            block: index + 1,
            total: blocks.length,
            reason: error instanceof Error ? error.message : String(error),
          })
          if (input.isCurrent()) input.onBlock?.(index, "")
        }
      }
    }))
    if (!input.isCurrent()) throw new Error("已取消翻译。")
    if (errors.length) {
      const detail = errors[0] instanceof Error ? errors[0].message : String(errors[0])
      throw new Error(`${errors.length}/${blocks.length} 处文字翻译失败：${detail}`)
    }
    const translatedText = blocks.map((block) => block.translatedText).join("\n")
    if (!translatedText) throw new Error("翻译引擎没有返回译文。")
    const result = { sourceText, translatedText, sourceLanguageCode: source, targetLanguageCode: target, blocks }
    recordHistory(translatedText, "")
    return result
  } catch (error) {
    recordHistory("", error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    appleEngine.dispose()
  }
}
