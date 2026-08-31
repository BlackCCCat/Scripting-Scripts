import type { ReadableStream } from "scripting"
import { AUTO_LANGUAGE, LANGUAGE_OPTIONS } from "../constants"
import type {
  TranslationProgressCallbacks,
  TranslationRequest,
  TranslationResult,
} from "../types"
import {
  splitTranslationText,
  translateChunkedText,
} from "./translation_chunking"

const SESSION_INSTRUCTIONS = [
  "You are a translation engine for an iOS translation panel.",
  "Always translate faithfully and naturally.",
  "Return translated text only.",
  "Do not answer the text, do not summarize, and do not add commentary.",
  "Preserve paragraph breaks, bullet structure, code blocks, URLs, emoji, and numbers.",
  "Do not omit, shorten, or paraphrase away any part of the input.",
  "Always output the full translation in the requested target language.",
  "Do not wrap the output in JSON or markdown fences.",
  "Do not use ellipsis unless the source text itself contains ellipsis.",
].join(" ")

function findLanguage(code: string) {
  return LANGUAGE_OPTIONS.find((item) => item.code === code) ?? LANGUAGE_OPTIONS[0]
}

function normalizeDetectedLanguageCode(raw: string) {
  const value = String(raw ?? "").trim()
  const known = new Set(LANGUAGE_OPTIONS.map((item) => item.code))

  if (known.has(value)) {
    return value
  }

  const normalized = value
    .replace(/^language\s*:\s*/i, "")
    .replace(/^code\s*:\s*/i, "")
    .trim()

  if (known.has(normalized)) {
    return normalized
  }

  if (normalized === "zh") return "zh-Hans"
  if (normalized === "jp") return "ja"

  return ""
}

function buildPrompt(request: TranslationRequest) {
  const sourceLanguageName = request.sourceLanguageCode === AUTO_LANGUAGE.code
    ? AUTO_LANGUAGE.promptName
    : findLanguage(request.sourceLanguageCode).promptName
  const targetLanguageName = findLanguage(request.targetLanguageCode).promptName

  return [
    `Source language: ${sourceLanguageName}`,
    `Target language: ${targetLanguageName}`,
    "Task:",
    "1. Detect the source language if needed.",
    "2. Translate the full text into the target language.",
    "3. Keep all formatting and content intact.",
    "4. Output translated text only.",
    "5. Do not include the <text> or </text> tags in the output.",
    "",
    "<text>",
    request.sourceText,
    "</text>",
  ].join("\n")
}

function responseTokenBudget(sourceText: string) {
  return Math.min(8000, Math.max(1400, Math.ceil(sourceText.length * 3.2)))
}

function normalizeStreamContent(content: string) {
  const normalized = content
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

function isSuspiciouslyShort(sourceText: string, translatedText: string) {
  if (sourceText.trim().length < 240) {
    return false
  }

  return translatedText.trim().length < Math.max(24, Math.floor(sourceText.trim().length * 0.16))
}

async function readStreamText(
  stream: ReadableStream<any>,
  callbacks?: TranslationProgressCallbacks
) {
  let fullText = ""
  let lastPartialText = ""

  for await (const chunk of stream as any) {
    const piece = String(chunk ?? "")
    if (!piece) continue

    if (piece.startsWith(fullText)) {
      fullText = piece
      continue
    }

    fullText += piece

    const partialText = normalizeStreamContent(fullText)
    if (partialText && partialText !== lastPartialText) {
      lastPartialText = partialText
      await callbacks?.onPartialText?.(partialText)
    }
  }

  return normalizeStreamContent(fullText)
}

function detectByScript(text: string) {
  if (/[\u3040-\u30ff]/.test(text)) return "ja"
  if (/[\uac00-\ud7af]/.test(text)) return "ko"
  if (/[\u0600-\u06ff]/.test(text)) return "ar"
  if (/[\u0400-\u04ff]/.test(text)) return "ru"
  if (/[\u0900-\u097f]/.test(text)) return "hi"
  if (/[\u0e00-\u0e7f]/.test(text)) return "th"
  if (/[\u4e00-\u9fff]/.test(text)) {
    if (/[萬與體學國語廣東臺灣龍門開關畫風]/.test(text)) {
      return "zh-Hant"
    }
    return "zh-Hans"
  }

  const latinText = text.toLowerCase()
  if (/[a-z]/.test(latinText)) {
    if (/\b(the|and|is|are|this|that|with|from|for|you|your|hello|created)\b/.test(latinText)) return "en"
    if (/\b(el|la|de|que|hola|gracias|para|una)\b/.test(latinText)) return "es"
    if (/\b(le|la|de|bonjour|merci|pour|une)\b/.test(latinText)) return "fr"
    if (/\b(der|die|das|und|ist|hallo|danke)\b/.test(latinText)) return "de"
    if (/\b(ciao|grazie|per|una|che)\b/.test(latinText)) return "it"
    if (/\b(olá|obrigado|para|uma|que)\b/.test(latinText)) return "pt"
    return "en"
  }

  return ""
}

function getRawLanguageModelAvailabilityValue() {
  if (typeof LanguageModelSession === "undefined") {
    return undefined
  }

  return (LanguageModelSession as any).isAvailable
}

function resolveLanguageModelAvailability() {
  const raw = getRawLanguageModelAvailabilityValue()
  if (typeof raw === "function") {
    return !!raw.call(LanguageModelSession)
  }
  return !!raw
}

export async function detectSourceLanguageCode(sourceText: string) {
  const text = sourceText.trim()
  if (!text) return undefined

  if (resolveLanguageModelAvailability()) {
    const session = new LanguageModelSession({
      instructions: "Identify the source language of the given text. Return only one language code from the allowed list.",
    })

    try {
      const allowedCodes = LANGUAGE_OPTIONS.map((item) => item.code).join(", ")
      const result = await session.respond(
        [
          `Allowed language codes: ${allowedCodes}`,
          "Return only the code, with no explanation.",
          "",
          "<text>",
          text.slice(0, 1200),
          "</text>",
        ].join("\n"),
        {
          temperature: 0,
          maxResponseTokens: 16,
        }
      )
      const normalized = normalizeDetectedLanguageCode(result.content)
      if (normalized) {
        return normalized
      }
    } catch {} finally {
      session.dispose()
    }
  }

  const fallback = detectByScript(text)
  return fallback || undefined
}

export function isLocalTranslationAvailable() {
  try {
    return resolveLanguageModelAvailability()
  } catch {
    return false
  }
}

export function createTranslationEngine() {
  let prewarmSession: LanguageModelSession | null = null

  async function translateSingle(
    request: TranslationRequest,
    callbacks?: TranslationProgressCallbacks,
    allowRecursiveSplit = true
  ): Promise<TranslationResult> {
    const prompt = buildPrompt(request)
    const session = new LanguageModelSession({
      instructions: SESSION_INSTRUCTIONS,
    })

    try {
      const stream = await session.streamResponse(prompt, {
        temperature: 0.1,
        maxResponseTokens: responseTokenBudget(request.sourceText),
      })
      const translatedText = await readStreamText(stream, callbacks)

      if (!translatedText) {
        throw new Error("模型没有返回可用译文。")
      }

      if (
        allowRecursiveSplit &&
        request.sourceText.length > 360 &&
        isSuspiciouslyShort(request.sourceText, translatedText)
      ) {
        const maxChunkLength = Math.max(260, Math.floor(request.sourceText.length / 2))
        if (splitTranslationText(request.sourceText, maxChunkLength).length > 1) {
          return await translateChunkedText(
            request,
            {
              maxChunkLength,
              concurrency: 1,
              translateChunk: async (chunkRequest, chunkCallbacks) => (
                await translateSingle(chunkRequest, chunkCallbacks, false)
              ),
            },
            callbacks
          )
        }
      }

      return {
        translatedText,
      }
    } finally {
      session.dispose()
    }
  }

  return {
    prewarm() {
      if (!resolveLanguageModelAvailability()) return
      if (!prewarmSession) {
        prewarmSession = new LanguageModelSession({
          instructions: SESSION_INSTRUCTIONS,
        })
      }
      prewarmSession.prewarm("Translate input text into the selected target language.")
    },

    async translate(
      request: TranslationRequest,
      callbacks?: TranslationProgressCallbacks
    ): Promise<TranslationResult> {
      return await translateChunkedText(
        request,
        {
          maxChunkLength: 700,
          concurrency: 1,
          translateChunk: async (chunkRequest, chunkCallbacks) => (
            await translateSingle(chunkRequest, chunkCallbacks)
          ),
        },
        callbacks
      )
    },

    dispose() {
      prewarmSession?.dispose()
      prewarmSession = null
    },
  }
}
