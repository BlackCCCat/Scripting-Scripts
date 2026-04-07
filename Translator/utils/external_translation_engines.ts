import { fetch, type Response } from "scripting"
import { AUTO_LANGUAGE, LANGUAGE_OPTIONS } from "../constants"
import type {
  AiApiCompatibilityMode,
  TranslationRequest,
  TranslationResult,
  TranslatorEngineEntry,
} from "../types"

const GOOGLE_WEB_ENDPOINT = "https://translate.googleapis.com/translate_a/single"
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com"
const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"
const SILICONFLOW_DEFAULT_BASE_URL = "https://api.siliconflow.cn"
const QWEN_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode"
const SUCCESSFUL_AI_ENDPOINT_CACHE = new Map<string, string>()

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

function normalizeAiMode(mode: unknown): AiApiCompatibilityMode {
  if (mode === "custom") return "custom"
  if (mode === "openai") return "openai"
  if (mode === "gemini") return "gemini"
  if (mode === "siliconflow") return "siliconflow"
  if (mode === "qwen") return "qwen"
  return "custom"
}

function resolveAiBaseUrl(mode: AiApiCompatibilityMode, configBaseUrl?: string) {
  const normalized = normalizeBaseUrl(String(configBaseUrl ?? ""))
  if (normalized) return normalized
  if (mode === "openai") return OPENAI_DEFAULT_BASE_URL
  if (mode === "gemini") return GEMINI_DEFAULT_BASE_URL
  if (mode === "siliconflow") return SILICONFLOW_DEFAULT_BASE_URL
  if (mode === "qwen") return QWEN_DEFAULT_BASE_URL
  return ""
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

  if (mode === "gemini") {
    return uniqueStrings([
      cached ?? "",
      joinBaseUrl(baseUrl, "/v1beta/openai/chat/completions"),
      joinBaseUrl(baseUrl, "/openai/chat/completions"),
      joinBaseUrl(baseUrl, "/chat/completions"),
    ])
  }

  if (mode === "siliconflow") {
    return uniqueStrings([
      cached ?? "",
      joinBaseUrl(baseUrl, "/v1/chat/completions"),
    ])
  }

  if (mode === "qwen") {
    return uniqueStrings([
      cached ?? "",
      joinBaseUrl(baseUrl, "/v1/chat/completions"),
    ])
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
    joinBaseUrl(baseUrl, "/v1/responses"),
    joinBaseUrl(baseUrl, "/v1/chat/completions"),
    joinBaseUrl(baseUrl, "/chat/completions"),
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
      stream: false,
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
      stream: false,
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

  return JSON.stringify({
    model,
    temperature: 0.1,
    stream: false,
    messages: [
      { role: "system", content: AI_TRANSLATION_SYSTEM_PROMPT },
      { role: "user", content: buildAiUserPrompt(request) },
    ],
  })
}

function buildResponsesBody(model: string, request: TranslationRequest) {
  return JSON.stringify({
    model,
    temperature: 0.1,
    stream: false,
    instructions: AI_TRANSLATION_SYSTEM_PROMPT,
    input: buildAiUserPrompt(request),
  })
}

function buildMessagesBody(model: string, request: TranslationRequest) {
  return JSON.stringify({
    model,
    temperature: 0.1,
    stream: false,
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

    try {
      const payload = JSON.parse(data)
      const piece = parseAiTranslatedText(payload)
      if (piece) {
        text += piece
      }
      continue
    } catch {}

    text += data
  }

  return normalizeAiTranslatedText(text)
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
    const sseText = parseAiSseResponse(trimmed)
    if (sseText) return sseText
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

async function translateWithAiApi(
  engine: TranslatorEngineEntry,
  request: TranslationRequest
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
        ? buildMessagesBody(model, request)
        : buildChatCompletionBody(mode, model, request)

    for (const headers of buildAiHeaders(mode, apiKey)) {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
        timeout: 25,
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
      const raw = await readResponseString(response)
      if (looksLikeHtmlDocument(raw)) {
        sawHtmlResponse = true
        continue
      }
      translatedText = parseAiResponseText(raw)
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
  request: TranslationRequest
): Promise<TranslationResult> {
  switch (engine.kind) {
    case "google_translate":
      return await translateWithGoogleWeb(request)
    case "ai_api":
      return await translateWithAiApi(engine, request)
    default:
      throw new Error("当前引擎不是受支持的外部翻译引擎。")
  }
}
