import type { TranslationProgressCallbacks, TranslationRequest, TranslatorEngineEntry } from "../types"
import { createAssistantTranslationEngine, isAssistantTranslationAvailable } from "./assistant_translation_engine"
import { isExternalEngineConfigured, translateWithExternalEngine } from "./external_translation_engines"
import { historyEngineResult, saveTranslationHistory } from "./translation_history"
import { createInstalledSystemTranslationEngine, createSystemTranslationEngine, isInstalledSystemTranslationAvailable, isSystemTranslationAvailable } from "./system_translation_engine"
import { createTranslationEngine, detectSourceLanguageCode, isLocalTranslationAvailable, SAME_LANGUAGE_MESSAGE } from "./translation_engine"

export const LIVE_PIP_SIZES = [
  { label: "极小", systemImage: "minus", width: 220, height: 64 },
  { label: "小", systemImage: "capsule", width: 280, height: 96 },
  { label: "中", systemImage: "rectangle", width: 340, height: 144 },
  { label: "大", systemImage: "rectangle.fill", width: 400, height: 208 },
  { label: "方形", systemImage: "square", width: 280, height: 280 },
  { label: "竖向", systemImage: "rectangle.portrait", width: 240, height: 360 },
  { label: "窄竖", systemImage: "rectangle.portrait.fill", width: 180, height: 360 },
] as const

export function isLiveEngineAvailable(engine: TranslatorEngineEntry) {
  if (!engine.enabled) return false
  if (engine.kind === "apple_intelligence") return isLocalTranslationAvailable()
  if (engine.kind === "assistant") return isAssistantTranslationAvailable()
  if (engine.kind === "system_translation") return isSystemTranslationAvailable()
  if (engine.kind === "system_translation_offline") return isInstalledSystemTranslationAvailable()
  return isExternalEngineConfigured(engine)
}

function resolveLiveTarget(source: string, target: string) {
  if (target !== "auto") return target
  return source === "zh-Hans" || source === "zh-Hant" ? "en" : "zh-Hans"
}

function isUntranslated(sourceText: string, translatedText: string) {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase()
  return sourceText.trim().length >= 3 && normalize(sourceText) === normalize(translatedText)
}

function isWrongLanguage(target: string, sourceText: string, translatedText: string) {
  if (!target.startsWith("zh") || !/[a-z]/i.test(sourceText)) return false
  return !/[\u4e00-\u9fff]/.test(translatedText) && /[a-z]{3}/i.test(translatedText)
}

async function translateLiveText(
  engine: TranslatorEngineEntry,
  request: TranslationRequest,
  localEngine: ReturnType<typeof createTranslationEngine>,
  systemEngine: ReturnType<typeof createSystemTranslationEngine>,
  installedSystemEngine: ReturnType<typeof createInstalledSystemTranslationEngine>,
  callbacks: TranslationProgressCallbacks
) {
  if (engine.kind === "apple_intelligence") return localEngine.translate(request, callbacks)
  if (engine.kind === "assistant") return createAssistantTranslationEngine(engine.config).translate(request, callbacks)
  if (engine.kind === "system_translation") return systemEngine.translate(request)
  if (engine.kind === "system_translation_offline") return installedSystemEngine.translate(request)
  return translateWithExternalEngine(engine, request, callbacks)
}

export async function translateLiveClipboardText(input: {
  engine: TranslatorEngineEntry
  sourceText: string
  sourceLanguageCode: string
  targetLanguageCode: string
  localEngine: ReturnType<typeof createTranslationEngine>
  systemEngine: ReturnType<typeof createSystemTranslationEngine>
  installedSystemEngine: ReturnType<typeof createInstalledSystemTranslationEngine>
  isCurrent: () => boolean
  onText: (text: string) => void
}) {
  const { engine, sourceText, isCurrent, onText } = input
  let source = input.sourceLanguageCode
  let target = input.targetLanguageCode
  let translatedText = ""
  let errorText = ""

  try {
    source = source === "auto" ? (await detectSourceLanguageCode(sourceText)) ?? "auto" : source
    const looksLikeLatinText = /[a-z]/i.test(sourceText) &&
      !/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(sourceText)
    if (input.sourceLanguageCode !== "auto" && source.startsWith("zh") && looksLikeLatinText) {
      throw new Error("源语言设为中文，但复制的内容不是中文。请选择自动检测或正确的源语言。")
    }
    if (
      input.sourceLanguageCode === "auto" &&
      (source === "zh-Hans" || source === "zh-Hant") &&
      looksLikeLatinText
    ) {
      source = "en"
    }
    target = resolveLiveTarget(source, target)
    if (!isCurrent()) return
    if (source === target) throw new Error(SAME_LANGUAGE_MESSAGE)
    console.log("[Translator] 实时翻译语言", { engine: engine.label, source, target, length: sourceText.length })

    let lastUpdateAt = 0
    async function runTranslation(sourceCode: string) {
      return translateLiveText(
        engine,
        { sourceText, sourceLanguageCode: sourceCode, targetLanguageCode: target },
        input.localEngine,
        input.systemEngine,
        input.installedSystemEngine,
        {
          onPartialText: (text) => {
            if (!isCurrent() || Date.now() - lastUpdateAt < 180) return
            if (target.startsWith("zh") && /[a-z]/i.test(sourceText) && !/[\u4e00-\u9fff]/.test(text)) return
            lastUpdateAt = Date.now()
            onText(text)
          },
        },
      )
    }
    let result = await runTranslation(source)
    const invalidResult = (text: string) =>
      isUntranslated(sourceText, text) || isWrongLanguage(target, sourceText, text)
    if (isCurrent() && source !== "auto" && invalidResult(result.translatedText)) {
      console.log("[Translator] 引擎未返回目标语言，改用自动源语言重试", { engine: engine.label, target })
      onText("正在重新翻译…")
      result = await runTranslation("auto")
    }
    if (invalidResult(result.translatedText)) {
      throw new Error("翻译引擎未返回目标语言的译文，请重试或更换引擎。")
    }
    translatedText = result.translatedText
    if (isCurrent()) onText(translatedText)
  } catch (error) {
    errorText = error instanceof Error ? error.message : String(error)
    if (isCurrent()) onText(errorText === SAME_LANGUAGE_MESSAGE ? errorText : `翻译失败：${errorText}`)
  }

  if (!isCurrent()) return
  void saveTranslationHistory({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
    origin: "live",
    sourceText,
    sourceLanguageCode: source,
    targetLanguageCode: target,
    results: [historyEngineResult(engine, {
      engineId: engine.id,
      engineName: engine.label,
      translatedText,
      errorText,
      isTranslating: false,
    })],
  }).catch((error) => console.error("[Translator] 保存实时翻译历史失败", error))
}
