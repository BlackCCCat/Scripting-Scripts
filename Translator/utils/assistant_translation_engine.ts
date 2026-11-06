import type {
  TranslationEngineConfig,
  TranslationProgressCallbacks,
  TranslationRequest,
  TranslationResult,
} from "../types"
import { translateChunkedText } from "./translation_chunking"
import { isLikelyUntranslated } from "./translation_validation"
import { photoContextInstructions } from "./translation_context"

const ASSISTANT_TRANSLATION_SYSTEM_PROMPT = [
  "You are a translation engine for an iOS translation panel.",
  "Always translate faithfully and naturally.",
  "Return translated text only.",
  "Do not answer the text, do not summarize, and do not add commentary.",
  "Preserve paragraph breaks, bullet structure, code blocks, URLs, emoji, and numbers.",
  "Do not omit, shorten, or paraphrase away any part of the input.",
  "Always output the full translation in the requested target language.",
  "Do not include the <text> or </text> tags in the output.",
].join(" ")

function getRawAssistantAvailabilityValue() {
  if (typeof Assistant === "undefined") {
    return undefined
  }

  return (Assistant as any).isAvailable
}

export function isAssistantTranslationAvailable() {
  try {
    const raw = getRawAssistantAvailabilityValue()
    return typeof raw === "function" ? !!raw.call(Assistant) : !!raw
  } catch {
    return false
  }
}

function normalizeAssistantTranslation(content: string) {
  const normalized = String(content ?? "")
    .replace(/^```[\w-]*\n?/, "")
    .replace(/\n?```$/, "")
    .replace(/^(?:\s*<text>\s*)+/i, "")
    .replace(/(?:\s*<\/text>\s*)+$/i, "")
    .trim()

  const lines = normalized.split("\n")
  while (lines.length && lines[0].trim().toLowerCase() === "<text>") {
    lines.shift()
  }
  while (lines.length && lines[lines.length - 1].trim().toLowerCase() === "</text>") {
    lines.pop()
  }

  return lines.join("\n").trim()
}

export function createAssistantTranslationEngine(config?: TranslationEngineConfig) {
  const providerId = config?.assistantProviderId ?? "openai"
  const customProvider = String(config?.assistantCustomProvider ?? "").trim()
  const modelId = String(config?.assistantModelId ?? "").trim()
  const provider = providerId === "custom"
    ? (customProvider ? { custom: customProvider } : undefined)
    : providerId

  async function translateSingle(
    request: TranslationRequest,
    callbacks?: TranslationProgressCallbacks
  ): Promise<TranslationResult> {
    let translatedText = ""
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const stream = await Assistant.requestStreaming({
        systemPrompt: ASSISTANT_TRANSLATION_SYSTEM_PROMPT,
        provider,
        modelId: modelId || undefined,
        messages: {
          role: "user",
          content: [
            `Source language: ${request.sourceLanguageCode}`,
            `Target language: ${request.targetLanguageCode}`,
            "Translate the following text:",
            ...(attempt > 0 ? [
              "The previous response repeated the source. Return a translation in the target language.",
            ] : []),
            ...photoContextInstructions(request),
            "",
            "<text>",
            request.sourceText,
            "</text>",
          ].join("\n"),
        },
      })

      translatedText = ""
      let lastPartialText = ""
      for await (const chunk of stream as any) {
        if (chunk?.type !== "text") continue
        translatedText += String(chunk.content ?? "")

        const partialText = normalizeAssistantTranslation(translatedText)
        if (partialText && partialText !== lastPartialText) {
          lastPartialText = partialText
          await callbacks?.onPartialText?.(partialText)
        }
      }

      translatedText = normalizeAssistantTranslation(translatedText)
      if (!isLikelyUntranslated(request, translatedText)) break
    }

    if (!translatedText) {
      throw new Error("Assistant 没有返回可用译文。")
    }
    if (isLikelyUntranslated(request, translatedText)) {
      throw new Error("Assistant 未执行翻译，请重试或更换引擎。")
    }

    return { translatedText }
  }

  return {
    translateSingle,

    async translate(
      request: TranslationRequest,
      callbacks?: TranslationProgressCallbacks,
      chunkConcurrency = 2
    ): Promise<TranslationResult> {
      return await translateChunkedText(
        request,
        {
          maxChunkLength: 1400,
          concurrency: chunkConcurrency,
          translateChunk: async (chunkRequest, chunkCallbacks) => (
            await translateSingle(chunkRequest, chunkCallbacks)
          ),
        },
        callbacks
      )
    },
  }
}
