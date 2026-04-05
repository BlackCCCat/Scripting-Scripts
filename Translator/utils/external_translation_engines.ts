import { fetch, type Response } from "scripting"
import type {
  AiApiCompatibilityMode,
  TranslationRequest,
  TranslationResult,
  TranslatorEngineEntry,
} from "../types"

const GOOGLE_WEB_ENDPOINT = "https://translate.googleapis.com/translate_a/single"
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com"
const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"

const AI_TRANSLATION_SYSTEM_PROMPT = [
  "You are a translation engine for an iOS translation panel.",
  "Always translate faithfully and naturally.",
  "Return translated text only.",
  "Do not answer the text, do not summarize, and do not add commentary.",
  "Preserve paragraph breaks, bullet structure, code blocks, URLs, emoji, and numbers.",
  "Do not omit, shorten, or paraphrase away any part of the input.",
  "Always output the full translation in the requested target language.",
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
  if (mode === "openai") return "openai"
  if (mode === "gemini") return "gemini"
  return "newapi"
}

function resolveAiBaseUrl(mode: AiApiCompatibilityMode, configBaseUrl?: string) {
  const normalized = normalizeBaseUrl(String(configBaseUrl ?? ""))
  if (normalized) return normalized
  if (mode === "openai") return OPENAI_DEFAULT_BASE_URL
  if (mode === "gemini") return GEMINI_DEFAULT_BASE_URL
  return ""
}

function buildAiUserPrompt(request: TranslationRequest) {
  return [
    `Source language: ${request.sourceLanguageCode}`,
    `Target language: ${request.targetLanguageCode}`,
    "Translate the following text:",
    "",
    request.sourceText,
  ].join("\n")
}

function buildAiHeaders(mode: AiApiCompatibilityMode, apiKey: string) {
  const common = {
    "Content-Type": "application/json",
    Accept: "application/json",
  }

  if (mode === "newapi") {
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
  const endpoint = mode === "gemini"
    ? joinBaseUrl(baseUrl, "/v1beta/openai/chat/completions")
    : joinBaseUrl(baseUrl, "/v1/chat/completions")
  const body = JSON.stringify({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: AI_TRANSLATION_SYSTEM_PROMPT },
      { role: "user", content: buildAiUserPrompt(request) },
    ],
  })

  let response: Response | null = null
  for (const headers of buildAiHeaders(mode, apiKey)) {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
    })

    if (response.ok) break
    if (response.status !== 401 && response.status !== 403) break
  }

  if (!response) {
    throw new Error("AI 接口翻译请求没有返回响应。")
  }

  if (!response.ok) {
    const detail = await extractResponseErrorDetail(response)
    throw new Error(detail
      ? `${normalizeErrorMessage(response, "AI 接口翻译请求失败")}：${detail}`
      : normalizeErrorMessage(response, "AI 接口翻译请求失败"))
  }

  const payload = await readJsonWithFallback(response)
  const translatedText = String(payload?.choices?.[0]?.message?.content ?? "").trim()

  if (!translatedText) {
    throw new Error("AI 接口没有返回可用译文。")
  }

  return {
    translatedText,
  }
}

export function isExternalEngineConfigured(engine: TranslatorEngineEntry) {
  if (engine.kind === "ai_api") {
    return (
      !!String(engine.config?.baseUrl ?? "").trim() &&
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
