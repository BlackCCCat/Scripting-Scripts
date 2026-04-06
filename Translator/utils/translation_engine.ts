import type { ReadableStream } from "scripting"
import { AUTO_LANGUAGE, LANGUAGE_OPTIONS } from "../constants"
import type { TranslationRequest, TranslationResult } from "../types"

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

function findChunkBoundary(text: string, maxLength: number) {
  const candidates = [
    text.lastIndexOf("\n\n", maxLength),
    text.lastIndexOf("\n", maxLength),
    text.lastIndexOf("。", maxLength),
    text.lastIndexOf("！", maxLength),
    text.lastIndexOf("？", maxLength),
    text.lastIndexOf(". ", maxLength),
    text.lastIndexOf("! ", maxLength),
    text.lastIndexOf("? ", maxLength),
    text.lastIndexOf("；", maxLength),
    text.lastIndexOf(";", maxLength),
    text.lastIndexOf("，", maxLength),
    text.lastIndexOf(", ", maxLength),
    text.lastIndexOf(" ", maxLength),
  ]

  const boundary = candidates.find((index) => index >= Math.floor(maxLength * 0.55))
  if (boundary == null || boundary < 1) {
    return maxLength
  }

  if (text.startsWith("\n\n", boundary)) {
    return boundary + 2
  }

  if (
    text.startsWith(". ", boundary) ||
    text.startsWith("! ", boundary) ||
    text.startsWith("? ", boundary) ||
    text.startsWith(", ", boundary)
  ) {
    return boundary + 1
  }

  return boundary + 1
}

function splitIntoChunks(text: string, maxLength = 700) {
  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxLength) {
    const boundary = findChunkBoundary(remaining, maxLength)
    chunks.push(remaining.slice(0, boundary))
    remaining = remaining.slice(boundary)
  }

  if (remaining.length > 0) {
    chunks.push(remaining)
  }

  return chunks.filter((chunk) => chunk.length > 0)
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

async function readStreamText(stream: ReadableStream<any>) {
  let fullText = ""

  // 这里兼容增量片段和“整段覆写”两种流式返回，避免把内容重复拼进去。
  for await (const chunk of stream as any) {
    const piece = String(chunk ?? "")
    if (!piece) continue

    if (piece.startsWith(fullText)) {
      fullText = piece
      continue
    }

    fullText += piece
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
      const translatedText = await readStreamText(stream)

      if (!translatedText) {
        throw new Error("模型没有返回可用译文。")
      }

      if (
        allowRecursiveSplit &&
        request.sourceText.length > 360 &&
        isSuspiciouslyShort(request.sourceText, translatedText)
      ) {
        // 这里遇到疑似截断时再细分一次，优先保住完整性，不去动面板层逻辑。
        const subChunks = splitIntoChunks(request.sourceText, Math.max(260, Math.floor(request.sourceText.length / 2)))

        if (subChunks.length > 1) {
          const translatedChunks: string[] = []
          for (const chunk of subChunks) {
            const result = await translateSingle(
              { ...request, sourceText: chunk },
              false
            )
            translatedChunks.push(result.translatedText)
          }

          return {
            translatedText: translatedChunks.join(""),
          }
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

    async translate(request: TranslationRequest): Promise<TranslationResult> {
      const chunks = splitIntoChunks(request.sourceText)

      if (chunks.length === 1) {
        return await translateSingle(request)
      }

      const translatedChunks: string[] = []

      for (const chunk of chunks) {
        const result = await translateSingle({
          ...request,
          sourceText: chunk,
        })
        translatedChunks.push(result.translatedText)
      }

      const translatedText = translatedChunks.join("")
      if (!translatedText.trim()) {
        throw new Error("模型没有返回可用译文。")
      }

      return {
        translatedText,
      }
    },

    dispose() {
      prewarmSession?.dispose()
      prewarmSession = null
    },
  }
}
