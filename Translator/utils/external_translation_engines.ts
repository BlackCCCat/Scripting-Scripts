import { fetch, type Response } from "scripting"
import { AUTO_LANGUAGE, LANGUAGE_OPTIONS } from "../constants"
import type {
  AiApiCompatibilityMode,
  TranslationProgressCallbacks,
  TranslationRequest,
  TranslationResult,
  TranslatorEngineEntry,
} from "../types"
import { translateChunkedText } from "./translation_chunking"
import { AI_PROVIDERS, aiProvider } from "./ai_providers"

const GOOGLE_WEB_ENDPOINT = "https://translate.googleapis.com/translate_a/single"
const DEEPLX_DEFAULT_ENDPOINT = "http://localhost:1188/translate"
const SUCCESSFUL_AI_ENDPOINT_CACHE = new Map<string, string>()
const AI_TRANSLATION_TIMEOUT_SECONDS = 60

const AI_TRANSLATION_SYSTEM_PROMPT = [
  "You are a translation engine for an iOS translation panel.",
  "Always translate faithfully and naturally.",
  "Return translated text only.",
  "Do not answer the text, do not summarize, and do not add commentary.",
  "Preserve paragraph breaks, bullet structure, code blocks, URLs, emoji, and numbers.",
  "Do not omit, shorten, or paraphrase away any part of the input.",
  "Always output the full translation in the requested target language.",
  "If the source language and target language differ, never return the source text unchanged.",
].join(" ")

function ensureConfigured(value: string | undefined, message: string) {
  const normalized = String(value ?? "").trim()
  if (!normalized) {
    throw new Error(message)
  }
  return normalized
}

function normalizeBaseUrl(value: string) {
  return String(value ?? "").trim().replace(/\/+$/, "")
}

function joinBaseUrl(baseUrl: string, suffix: string) {
  const base = normalizeBaseUrl(baseUrl)
  const path = suffix.startsWith("/") ? suffix : `/${suffix}`
  return `${base}${path}`
}

function normalizeErrorMessage(response: Response, fallback: string) {
  return `${fallback}（HTTP ${response.status}）`
}

function truncateErrorDetail(value: string, maxLength = 180) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function readStringFromData(data: Data, encodings: ("utf-8" | "utf8" | "gb18030" | "gbk")[]) {
  for (const encoding of encodings) {
    try {
      const raw = data.toRawString(encoding)
      if (raw) return raw
    } catch {}
  }

  try {
    return data.toDecodedString("utf8")
  } catch {
    return ""
  }
}

async function readResponseString(
  response: Response,
  encodings: ("utf-8" | "utf8" | "gb18030" | "gbk")[] = ["utf-8", "utf8"]
) {
  let data: Data | null = null

  try {
    const bytes = await response.bytes()
    if (bytes?.length) {
      data = Data.fromIntArray(Array.from(bytes))
    }
  } catch {}

  if (!data) {
    try {
      data = await response.data()
    } catch {}
  }

  if (!data) {
    try {
      return await response.text()
    } catch {
      throw new Error("无法读取响应内容。")
    }
  }

  const candidates = [data]
  const contentEncoding = String(response.headers.get("content-encoding") ?? "").toLowerCase()

  if (contentEncoding.includes("deflate") || contentEncoding.includes("gzip")) {
    try {
      candidates.unshift(data.decompressed(CompressionAlgorithm.zlib))
    } catch {}
  }

  for (const item of candidates) {
    const raw = readStringFromData(item, encodings)
    if (!raw.trim()) continue
    return raw
  }

  throw new Error("Failed to decode data to utf-string")
}

async function readJsonWithFallback(response: Response, encodings: ("utf-8" | "utf8" | "gb18030" | "gbk")[] = ["utf-8", "utf8"]) {
  const raw = await readResponseString(response, encodings)
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error("响应内容不是有效的 JSON。")
  }
}

async function extractResponseErrorDetail(response: Response) {
  try {
    const payload = await readJsonWithFallback(response)
    const detail = payload?.error?.message
      ?? payload?.message
      ?? payload?.detail
      ?? payload?.msg
    return truncateErrorDetail(String(detail ?? ""))
  } catch {}

  try {
    return truncateErrorDetail(await readResponseString(response))
  } catch {
    return ""
  }
}

function mapGoogleLanguage(code: string, isSource = false) {
  if (code === "auto") return isSource ? "auto" : code
  if (code === "zh-Hans") return "zh-CN"
  if (code === "zh-Hant") return "zh-TW"
  return code
}

function mapDeepLXLanguage(code: string, isSource = false) {
  if (code === "auto") return isSource ? "auto" : code
  if (code === "zh-Hans") return "zh"
  if (code === "zh-Hant") return "zh"
  if (code === "en") return "en"
  if (code === "ja") return "ja"
  if (code === "ko") return "ko"
  if (code === "cs") return "cs"
  if (code === "da") return "da"
  if (code === "fr") return "fr"
  if (code === "de") return "de"
  if (code === "el") return "el"
  if (code === "es") return "es"
  if (code === "fi") return "fi"
  if (code === "he") return "he"
  if (code === "hu") return "hu"
  if (code === "it") return "it"
  if (code === "no") return "nb"
  if (code === "pt") return "pt"
  if (code === "ro") return "ro"
  if (code === "ru") return "ru"
  if (code === "sv") return "sv"
  if (code === "ar") return "ar"
  if (code === "nl") return "nl"
  if (code === "pl") return "pl"
  if (code === "tr") return "tr"
  if (code === "uk") return "uk"
  if (code === "vi") return "vi"
  if (code === "th") return "th"
  if (code === "id") return "id"
  if (code === "ms") return "ms"
  if (code === "hi") return "hi"
  return code
}

function normalizeAiMode(mode: unknown): AiApiCompatibilityMode {
  return AI_PROVIDERS.some((item) => item.mode === mode) ? mode as AiApiCompatibilityMode : "custom"
}

function resolveAiBaseUrl(mode: AiApiCompatibilityMode, configBaseUrl?: string) {
  const normalized = normalizeBaseUrl(String(configBaseUrl ?? ""))
  if (normalized) return normalized
  return aiProvider(mode).baseUrl
}

function stripKnownEndpointSuffix(baseUrl: string) {
  return normalizeBaseUrl(baseUrl).replace(
    /\/(?:v1\/models|models|v1\/chat\/completions|chat\/completions|v1\/responses|responses|v1\/messages|messages)\/?$/i,
    ""
  )
}

function buildCustomRootCandidates(baseUrl: string) {
  const stripped = stripKnownEndpointSuffix(baseUrl)
  if (!stripped) return []

  if (/\/v1$/i.test(stripped)) {
    return uniqueStrings([stripped, stripped.replace(/\/v1$/i, "")])
  }

  return uniqueStrings([stripped, `${stripped}/v1`])
}

function buildAiUserPrompt(request: TranslationRequest) {
  return [
    `Translate the following text into ${promptNameForLanguage(request.targetLanguageCode)}.`,
    `Source language: ${promptNameForLanguage(request.sourceLanguageCode)}.`,
    `Target language: ${promptNameForLanguage(request.targetLanguageCode)}.`,
    "Only return the translated text.",
    "",
    request.sourceText,
  ].join("\n")
}

function promptNameForLanguage(code: string) {
  if (code === AUTO_LANGUAGE.code) return "auto"
  return LANGUAGE_OPTIONS.find((item) => item.code === code)?.promptName ?? code
}

function qwenLanguageName(code: string) {
  if (code === AUTO_LANGUAGE.code) return "auto"
  if (code === "zh-Hans") return "Chinese"
  if (code === "zh-Hant") return "Traditional Chinese"
  return promptNameForLanguage(code)
}

function normalizeAiTranslatedText(value: string) {
  const normalized = String(value ?? "")
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

  const cleaned = lines.join("\n").trim()
  if (!cleaned) return ""
  if (looksLikeHtmlDocument(cleaned)) return ""
  if (/^\s*<(?:html|head|body|script|style|meta|link)\b/i.test(cleaned)) return ""
  return cleaned
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function normalizeComparableText(value: string) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function isLikelyUntranslated(request: TranslationRequest, translatedText: string) {
  const source = normalizeComparableText(request.sourceText)
  const translated = normalizeComparableText(translatedText)
  if (!source || !translated) return false
  if (source !== translated) return false
  if (request.sourceLanguageCode !== AUTO_LANGUAGE.code && request.sourceLanguageCode === request.targetLanguageCode) {
    return false
  }

  return source.length >= 12 || /\s/.test(source)
}

function aiEndpointCacheKey(mode: AiApiCompatibilityMode, baseUrl: string) {
  return `${mode}::${normalizeBaseUrl(baseUrl)}`
}

function buildAiEndpointCandidates(mode: AiApiCompatibilityMode, baseUrl: string) {
  const cacheKey = aiEndpointCacheKey(mode, baseUrl)
  const cached = SUCCESSFUL_AI_ENDPOINT_CACHE.get(cacheKey)
  const root = stripKnownEndpointSuffix(baseUrl).replace(/\/v1$/i, "")

  if (mode === "anthropic") {
    return uniqueStrings([cached ?? "", joinBaseUrl(root, "/v1/messages")])
  }

  if (mode === "gemini") {
    return uniqueStrings([
      cached ?? "",
      joinBaseUrl(root, "/v1beta/openai/chat/completions"),
    ])
  }

  if (mode === "siliconflow") {
    return uniqueStrings([
      cached ?? "",
      joinBaseUrl(root, "/v1/chat/completions"),
    ])
  }

  if (mode === "qwen") {
    return uniqueStrings([
      cached ?? "",
      joinBaseUrl(root, "/v1/chat/completions"),
    ])
  }

  if (mode === "deepseek") {
    return uniqueStrings([cached ?? "", joinBaseUrl(root, "/chat/completions"), joinBaseUrl(root, "/v1/chat/completions")])
  }

  if (mode === "minimax" || mode === "openrouter") {
    return uniqueStrings([cached ?? "", joinBaseUrl(root, "/v1/chat/completions")])
  }

  if (mode === "custom" || mode === "newapi") {
    return uniqueStrings([
      cached ?? "",
      ...buildCustomRootCandidates(baseUrl).flatMap((root) => (
        /\/v1$/i.test(root)
          ? [
              joinBaseUrl(root, "/responses"),
              joinBaseUrl(root, "/chat/completions"),
              joinBaseUrl(root, "/messages"),
            ]
          : [
              joinBaseUrl(root, "/v1/responses"),
              joinBaseUrl(root, "/responses"),
              joinBaseUrl(root, "/v1/chat/completions"),
              joinBaseUrl(root, "/chat/completions"),
              joinBaseUrl(root, "/v1/messages"),
              joinBaseUrl(root, "/messages"),
            ]
      )),
    ])
  }

  return uniqueStrings([
    cached ?? "",
    joinBaseUrl(root, "/v1/responses"),
    joinBaseUrl(root, "/v1/chat/completions"),
  ])
}

function buildAiHeaders(mode: AiApiCompatibilityMode, apiKey: string) {
  const common = {
    "Content-Type": "application/json",
    Accept: "application/json",
  }

  if (mode === "custom" || mode === "newapi") {
    return [
      {
        ...common,
        Authorization: `Bearer ${apiKey}`,
        "x-api-key": apiKey,
        "api-key": apiKey,
      },
      {
        ...common,
        Authorization: `Bearer ${apiKey}`,
      },
    ]
  }

  if (mode === "anthropic") {
    return [{ ...common, "x-api-key": apiKey, "anthropic-version": "2023-06-01" }]
  }

  return [
    {
      ...common,
      Authorization: `Bearer ${apiKey}`,
    },
  ]
}

function buildChatCompletionBody(
  mode: AiApiCompatibilityMode,
  model: string,
  request: TranslationRequest
) {
  if (mode === "qwen") {
    return JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: "user", content: request.sourceText },
      ],
      translation_options: {
        source_lang: qwenLanguageName(request.sourceLanguageCode),
        target_lang: qwenLanguageName(request.targetLanguageCode),
      },
    })
  }

  if (mode === "siliconflow") {
    return JSON.stringify({
      model,
      temperature: 0.1,
      stream: true,
      enable_thinking: false,
      response_format: {
        type: "text",
      },
      messages: [
        { role: "system", content: AI_TRANSLATION_SYSTEM_PROMPT },
        { role: "user", content: buildAiUserPrompt(request) },
      ],
    })
  }

  const thinking = mode === "deepseek" || mode === "minimax"
    ? { thinking: { type: "disabled" } }
    : mode === "openrouter"
      ? { reasoning: { enabled: false } }
      : mode === "gemini" && /^gemini-2\.5-flash/i.test(model)
        ? { reasoning_effort: "none" }
        : {}

  return JSON.stringify({
    model,
    temperature: 0.1,
    stream: true,
    ...thinking,
    messages: [
      { role: "system", content: AI_TRANSLATION_SYSTEM_PROMPT },
      { role: "user", content: buildAiUserPrompt(request) },
    ],
  })
}

function buildResponsesBody(model: string, request: TranslationRequest) {
  return JSON.stringify({
    model,
    stream: true,
    ...(/^(?:gpt-5\.(?:[1-9]|\d{2,})|deepseek-)/i.test(model) ? { reasoning: { effort: "none" } } : {}),
    instructions: AI_TRANSLATION_SYSTEM_PROMPT,
    input: buildAiUserPrompt(request),
  })
}

function buildMessagesBody(mode: AiApiCompatibilityMode, model: string, request: TranslationRequest) {
  if (mode === "anthropic") {
    return JSON.stringify({
      model,
      max_tokens: 8192,
      stream: true,
      thinking: { type: "disabled" },
      system: AI_TRANSLATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildAiUserPrompt(request) }],
    })
  }
  return JSON.stringify({
    model,
    temperature: 0.1,
    stream: true,
    messages: [
      { role: "system", content: AI_TRANSLATION_SYSTEM_PROMPT },
      { role: "user", content: buildAiUserPrompt(request) },
    ],
  })
}

function parseAiTranslatedText(payload: any) {
  const direct = normalizeAiTranslatedText(String(
    payload?.output_text
    ?? payload?.choices?.[0]?.message?.content
    ?? payload?.choices?.[0]?.text
    ?? payload?.content?.[0]?.text
    ?? ""
  ))
  if (direct) return direct

  const topLevelContents = Array.isArray(payload?.content) ? payload.content : []
  for (const content of topLevelContents) {
    const value = normalizeAiTranslatedText(String(
      content?.text
      ?? content?.content
      ?? ""
    ))
    if (value) return value
  }

  const outputItems = Array.isArray(payload?.output) ? payload.output : []
  for (const item of outputItems) {
    const contents = Array.isArray(item?.content) ? item.content : []
    for (const content of contents) {
      const value = normalizeAiTranslatedText(String(
        content?.text
        ?? content?.content?.[0]?.text
        ?? content?.content
        ?? ""
      ))
      if (value) return value
    }
  }

  return ""
}

function parseAiSseResponse(raw: string) {
  const lines = raw.split(/\r?\n/)
  let text = ""

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) continue

    const data = trimmed.slice(5).trim()
    if (!data || data === "[DONE]") continue

    let payload: any
    try {
      payload = JSON.parse(data)
    } catch {
      text += data
      continue
    }

    const update = parseAiStreamPayload(payload)
    if (update.mode === "error") {
      throw new Error(update.message)
    }
    if (update.mode === "append") {
      text += update.text
    } else if (update.mode === "replace") {
      text = update.text
    }
  }

  return normalizeAiTranslatedText(text)
}

type StreamTextUpdate =
  | { mode: "append"; text: string }
  | { mode: "replace"; text: string }
  | { mode: "done" }
  | { mode: "ignore" }
  | { mode: "error"; message: string }

function parseAiStreamPayload(payload: any): StreamTextUpdate {
  const eventType = String(payload?.type ?? "")
  if (eventType === "error") {
    const detail = truncateErrorDetail(String(
      payload?.message
      ?? payload?.error?.message
      ?? ""
    ))
    return {
      mode: "error",
      message: detail || "AI 接口流式响应出错。",
    }
  }

  if (eventType === "response.output_text.delta") {
    const delta = String(payload?.delta ?? "")
    return delta ? { mode: "append", text: delta } : { mode: "ignore" }
  }

  if (eventType === "response.output_text.done") {
    const text = normalizeAiTranslatedText(String(payload?.text ?? ""))
    return text ? { mode: "replace", text } : { mode: "done" }
  }

  if (eventType === "content_block_start" && payload?.content_block?.type === "text") {
    const text = String(payload?.content_block?.text ?? "")
    return text ? { mode: "append", text } : { mode: "ignore" }
  }

  if (eventType === "content_block_delta" && payload?.delta?.type === "text_delta") {
    const delta = String(payload?.delta?.text ?? "")
    return delta ? { mode: "append", text: delta } : { mode: "ignore" }
  }

  if (eventType === "message_stop") {
    return { mode: "done" }
  }

  const delta = String(
    payload?.choices?.[0]?.delta?.content
    ?? ""
  )
  if (delta) {
    return { mode: "append", text: delta }
  }

  const snapshot = parseAiTranslatedText(payload)
  if (snapshot) {
    return { mode: "replace", text: snapshot }
  }

  return { mode: "ignore" }
}

function parseAiSseBlock(block: string): StreamTextUpdate {
  const dataLines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())

  if (!dataLines.length) return { mode: "ignore" }

  const data = dataLines.join("\n").trim()
  if (!data || data === "[DONE]") {
    return { mode: "done" }
  }

  try {
    return parseAiStreamPayload(JSON.parse(data))
  } catch {
    const text = data
    return text ? { mode: "append", text } : { mode: "ignore" }
  }
}

function nextSseSeparatorIndex(buffer: string) {
  const match = buffer.match(/\r?\n\r?\n/)
  return match?.index ?? -1
}

function nextSseSeparatorLength(buffer: string) {
  const match = buffer.match(/\r?\n\r?\n/)
  return match?.[0]?.length ?? 0
}

async function readAiStreamResponse(
  response: Response,
  callbacks?: TranslationProgressCallbacks
) {
  let buffer = ""
  let rawText = ""
  let translatedText = ""
  let lastPartialText = ""
  let sawSse = false

  for await (const chunk of response.dataStream as any) {
    const piece = readStringFromData(chunk, ["utf-8", "utf8", "gb18030", "gbk"])
    if (!piece) continue

    rawText += piece
    buffer += piece

    while (true) {
      const separatorIndex = nextSseSeparatorIndex(buffer)
      if (separatorIndex < 0) break

      const separatorLength = nextSseSeparatorLength(buffer)
      const block = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + separatorLength)

      const update = parseAiSseBlock(block)
      if (update.mode === "ignore" || update.mode === "done") {
        continue
      }
      if (update.mode === "error") {
        throw new Error(update.message)
      }

      sawSse = true
      translatedText = update.mode === "replace"
        ? update.text
        : `${translatedText}${update.text}`

      const partialText = normalizeAiTranslatedText(translatedText)
      if (partialText && partialText !== lastPartialText) {
        lastPartialText = partialText
        await callbacks?.onPartialText?.(partialText)
      }
    }
  }

  if (buffer.trim()) {
    const update = parseAiSseBlock(buffer)
    if (update.mode === "error") {
      throw new Error(update.message)
    }
    if (update.mode === "append") {
      translatedText += update.text
      sawSse = true
    } else if (update.mode === "replace") {
      translatedText = update.text
      sawSse = true
    }
  }

  if (!sawSse) {
    return parseAiResponseText(rawText)
  }

  return normalizeAiTranslatedText(translatedText)
}

function looksLikeHtmlDocument(raw: string) {
  const trimmed = String(raw ?? "").trim().toLowerCase()
  if (!trimmed.startsWith("<")) return false

  return (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    trimmed.includes("<head") ||
    trimmed.includes("<body") ||
    trimmed.includes("<meta") ||
    trimmed.includes("<title")
  )
}

function isHtmlResponse(response: Response) {
  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase()
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml")
}

function parseAiResponseText(raw: string) {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return ""

  if (looksLikeHtmlDocument(trimmed)) {
    return ""
  }

  try {
    const payload = JSON.parse(trimmed)
    return parseAiTranslatedText(payload)
  } catch {}

  if (trimmed.includes("\ndata:") || trimmed.startsWith("data:")) {
    return parseAiSseResponse(trimmed)
  }

  if (looksLikeHtmlDocument(trimmed) || (/^\s*</.test(trimmed) && /<\/?[a-z][^>]*>/i.test(trimmed))) {
    return ""
  }

  return normalizeAiTranslatedText(trimmed)
}

async function translateWithGoogleWeb(request: TranslationRequest): Promise<TranslationResult> {
  const params = [
    "client=gtx",
    `sl=${encodeURIComponent(mapGoogleLanguage(request.sourceLanguageCode, true))}`,
    `tl=${encodeURIComponent(mapGoogleLanguage(request.targetLanguageCode))}`,
    "dt=t",
    `q=${encodeURIComponent(request.sourceText)}`,
  ].join("&")

  const response = await fetch(`${GOOGLE_WEB_ENDPOINT}?${params}`, {
    method: "GET",
    headers: {
      "Accept-Encoding": "identity",
    },
  })

  if (!response.ok) {
    throw new Error(normalizeErrorMessage(response, "Google 网页翻译请求失败"))
  }

  const payload = await readJsonWithFallback(response)
  const translatedText = Array.isArray(payload?.[0])
    ? payload[0].map((item: any) => String(item?.[0] ?? "")).join("").trim()
    : ""

  if (!translatedText) {
    throw new Error("Google 网页翻译没有返回可用译文。")
  }

  return {
    translatedText,
  }
}

async function translateWithDeepLX(
  engine: TranslatorEngineEntry,
  request: TranslationRequest
): Promise<TranslationResult> {
  const endpoint = normalizeBaseUrl(engine.config?.baseUrl ?? "") || DEEPLX_DEFAULT_ENDPOINT
  const sourceLang = mapDeepLXLanguage(request.sourceLanguageCode, true)
  const targetLang = mapDeepLXLanguage(request.targetLanguageCode)

  const body = JSON.stringify({
    text: request.sourceText,
    source_lang: sourceLang.toUpperCase(),
    target_lang: targetLang.toUpperCase(),
  })

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
    timeout: 25,
  })

  if (!response.ok) {
    const detail = await extractResponseErrorDetail(response)
    throw new Error(detail
      ? `${normalizeErrorMessage(response, "DeepLX 翻译请求失败")}：${detail}`
      : normalizeErrorMessage(response, "DeepLX 翻译请求失败"))
  }

  const payload = await readJsonWithFallback(response)
  const translatedText = String(payload?.data ?? payload?.translations?.[0]?.text ?? "").trim()

  if (!translatedText) {
    throw new Error("DeepLX 没有返回可用译文。")
  }

  return {
    translatedText,
  }
}

async function translateWithDeepL(
  engine: TranslatorEngineEntry,
  request: TranslationRequest
): Promise<TranslationResult> {
  const endpoint = ensureConfigured(engine.config?.baseUrl, "请先配置 DeepL 请求地址。")
  const apiKey = ensureConfigured(engine.config?.apiKey, "请先配置 DeepL API Key。")
  const language = (code: string) => code === "no" ? "nb" : code
  const body = JSON.stringify({
    text: [request.sourceText],
    target_lang: language(request.targetLanguageCode),
    ...(request.sourceLanguageCode === "auto" ? {} : { source_lang: language(request.sourceLanguageCode) }),
  })
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
    timeout: 30,
  })

  if (!response.ok) {
    const detail = await extractResponseErrorDetail(response)
    throw new Error(`${normalizeErrorMessage(response, "DeepL 翻译请求失败")}${detail ? `：${detail}` : ""}`)
  }

  const payload = await readJsonWithFallback(response)
  const translatedText = String(payload?.translations?.[0]?.text ?? "").trim()
  if (!translatedText) throw new Error("DeepL 没有返回可用译文。")
  return { translatedText }
}

async function translateWithAiApiSingle(
  engine: TranslatorEngineEntry,
  request: TranslationRequest,
  callbacks?: TranslationProgressCallbacks
): Promise<TranslationResult> {
  const mode = normalizeAiMode(engine.config?.compatibilityMode)
  const baseUrl = ensureConfigured(resolveAiBaseUrl(mode, engine.config?.baseUrl), "请先配置 AI 接口地址。")
  const apiKey = ensureConfigured(engine.config?.apiKey, "请先配置 AI 接口 API Key。")
  const model = ensureConfigured(engine.config?.model, "请先配置 AI 接口模型名称。")
  const endpoints = buildAiEndpointCandidates(mode, baseUrl)
  const cacheKey = aiEndpointCacheKey(mode, baseUrl)

  let response: Response | null = null
  let translatedText = ""
  let sawSuccessfulResponse = false
  let sawHtmlResponse = false
  let sawUntranslatedResponse = false

  endpointLoop:
  for (const endpoint of endpoints) {
    const body = endpoint.endsWith("/responses")
      ? buildResponsesBody(model, request)
      : endpoint.endsWith("/messages")
        ? buildMessagesBody(mode, model, request)
        : buildChatCompletionBody(mode, model, request)

    for (const headers of buildAiHeaders(mode, apiKey)) {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
        timeout: AI_TRANSLATION_TIMEOUT_SECONDS,
      })

      if (!response.ok) {
        if ([401, 403, 404, 405].includes(response.status)) {
          continue
        }
        break
      }

      sawSuccessfulResponse = true
      if (isHtmlResponse(response)) {
        sawHtmlResponse = true
        continue
      }
      translatedText = await readAiStreamResponse(response, callbacks)
      if (translatedText && isLikelyUntranslated(request, translatedText)) {
        translatedText = ""
        sawUntranslatedResponse = true
        continue
      }
      if (translatedText) {
        SUCCESSFUL_AI_ENDPOINT_CACHE.set(cacheKey, endpoint)
        break endpointLoop
      }
    }
  }

  if (!response) {
    throw new Error("AI 接口翻译请求没有返回响应。")
  }

  if (sawSuccessfulResponse && !translatedText) {
    if (sawHtmlResponse) {
      throw new Error("AI 接口返回了网页内容，请检查链接是否指向实际的 API 根地址，而不是站点前端页面。")
    }
    if (sawUntranslatedResponse) {
      throw new Error("AI 接口返回了与原文相同的内容，没有执行实际翻译。")
    }
    throw new Error("AI 接口没有返回可用译文。")
  }

  if (!response.ok) {
    const detail = await extractResponseErrorDetail(response)
    throw new Error(detail
      ? `${normalizeErrorMessage(response, "AI 接口翻译请求失败")}：${detail}`
      : normalizeErrorMessage(response, "AI 接口翻译请求失败"))
  }

  if (!translatedText) {
    throw new Error("AI 接口没有返回可用译文。")
  }

  return {
    translatedText,
  }
}

export function isExternalEngineConfigured(engine: TranslatorEngineEntry) {
  if (engine.kind === "deeplx") {
    return !!String(engine.config?.baseUrl ?? "").trim()
  }

  if (engine.kind === "deepl") {
    return !!String(engine.config?.baseUrl ?? "").trim() && !!String(engine.config?.apiKey ?? "").trim()
  }

  if (engine.kind === "ai_api") {
    const mode = normalizeAiMode(engine.config?.compatibilityMode)
    return (
      (mode !== "custom" || !!String(engine.config?.baseUrl ?? "").trim()) &&
      !!String(engine.config?.apiKey ?? "").trim() &&
      !!String(engine.config?.model ?? "").trim()
    )
  }

  return true
}

export async function translateWithExternalEngine(
  engine: TranslatorEngineEntry,
  request: TranslationRequest,
  callbacks?: TranslationProgressCallbacks
): Promise<TranslationResult> {
  switch (engine.kind) {
    case "google_translate":
      return await translateWithGoogleWeb(request)
    case "deeplx":
      return await translateWithDeepLX(engine, request)
    case "deepl":
      return await translateChunkedText(request, {
        maxChunkLength: 5000,
        concurrency: 2,
        translateChunk: async (chunkRequest) => await translateWithDeepL(engine, chunkRequest),
      }, callbacks)
    case "ai_api":
      return await translateChunkedText(
        request,
        {
          maxChunkLength: 1400,
          concurrency: 2,
          translateChunk: async (chunkRequest, chunkCallbacks) => (
            await translateWithAiApiSingle(engine, chunkRequest, chunkCallbacks)
          ),
        },
        callbacks
      )
    default:
      throw new Error("当前引擎不是受支持的外部翻译引擎。")
  }
}
