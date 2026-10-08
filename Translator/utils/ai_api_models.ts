import { fetch } from "scripting"
import type { AiApiCompatibilityMode } from "../types"
import { AI_PROVIDERS, aiProvider } from "./ai_providers"

function normalizeBaseUrl(value: string) {
  return String(value ?? "").trim().replace(/\/+$/, "")
}

function joinBaseUrl(baseUrl: string, suffix: string) {
  const base = normalizeBaseUrl(baseUrl)
  const path = suffix.startsWith("/") ? suffix : `/${suffix}`
  return `${base}${path}`
}

function normalizeMode(mode: unknown): AiApiCompatibilityMode {
  return AI_PROVIDERS.some((item) => item.mode === mode) ? mode as AiApiCompatibilityMode : "custom"
}

function resolveBaseUrl(mode: AiApiCompatibilityMode, input: string) {
  const normalized = normalizeBaseUrl(input)
  if (normalized) return normalized
  return aiProvider(mode).baseUrl
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
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

function buildModelUrls(mode: AiApiCompatibilityMode, baseUrl: string, apiKey: string) {
  const root = stripKnownEndpointSuffix(baseUrl).replace(/\/v1$/i, "")
  if (mode === "gemini") {
    return uniqueStrings([
      `${joinBaseUrl(root, "/v1beta/models")}?key=${encodeURIComponent(apiKey)}`,
    ])
  }

  if (mode === "siliconflow") {
    return uniqueStrings([
      `${joinBaseUrl(root, "/v1/models")}?type=text&sub_type=chat`,
    ])
  }

  if (mode === "anthropic") {
    return [joinBaseUrl(root, "/v1/models?limit=100")]
  }

  if (mode === "custom" || mode === "newapi") {
    return uniqueStrings(
      buildCustomRootCandidates(baseUrl).flatMap((root) => (
        /\/v1$/i.test(root)
          ? [joinBaseUrl(root, "/models")]
          : [joinBaseUrl(root, "/v1/models"), joinBaseUrl(root, "/models")]
      ))
    )
  }

  return uniqueStrings([
    joinBaseUrl(root, "/v1/models"),
  ])
}

function buildModelHeaders(mode: AiApiCompatibilityMode, apiKey: string): Array<Record<string, string>> | undefined {
  if (mode === "gemini") return undefined

  if (mode === "anthropic") {
    return [{ "x-api-key": apiKey, "anthropic-version": "2023-06-01" }]
  }

  const headers: Array<Record<string, string>> = [
    {
      Authorization: `Bearer ${apiKey}`,
    },
  ]

  if (mode === "custom" || mode === "newapi") {
    headers.unshift({
      Authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey,
      "api-key": apiKey,
    })
  }

  return headers
}

function extractModelIds(payload: any, mode: AiApiCompatibilityMode): string[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []

  return list
    .filter((item: any) => mode !== "openrouter" || item?.reasoning?.mandatory !== true)
    .filter((item: any) => mode !== "anthropic" || item?.capabilities?.thinking?.types?.disabled?.supported !== false)
    .map((item: any) => String(item?.id ?? item?.name ?? item?.model ?? item).trim().replace(/^models\//, ""))
    .filter(Boolean)
}

function filterTranslationModelIds(mode: AiApiCompatibilityMode, modelIds: string[]) {
  modelIds = modelIds.filter((item) => !/(?:embedding|rerank|image|audio|speech|tts|asr|ocr|realtime|moderation)/i.test(item))

  if (mode === "gemini") {
    return modelIds.filter((item) => /^gemini-(?:2\.5-flash|2\.0|1\.)/i.test(item))
  }

  if (mode === "minimax") {
    return modelIds.filter((item) => /^MiniMax-M3$/i.test(item))
  }

  if (mode === "anthropic") {
    return modelIds.filter((item) => !/^claude-(?:fable|mythos)-/i.test(item))
  }

  if (mode === "openai") {
    return modelIds.filter((item) => !/^(?:o\d|gpt-5(?:-|$))/i.test(item) || /gpt-5\.(?:[1-9]|\d{2,})/i.test(item))
  }

  if (mode === "qwen") {
    return modelIds.filter((item) => /(^|\/)qwen-mt(?:-|$)/i.test(item))
  }

  if (mode === "siliconflow") {
    const filtered = modelIds.filter((item) => !/(?:embedding|reranker|stable-diffusion|flux|sdxl|image|video|audio|speech|tts|asr|ocr|vl|vision)/i.test(item))
    return filtered.length ? filtered : modelIds
  }

  return modelIds
}

export async function fetchAiApiModels(input: {
  compatibilityMode: AiApiCompatibilityMode
  baseUrl: string
  apiKey: string
}) {
  const compatibilityMode = normalizeMode(input.compatibilityMode)
  const baseUrl = resolveBaseUrl(compatibilityMode, input.baseUrl)
  const apiKey = String(input.apiKey ?? "").trim()

  if (!baseUrl || !apiKey) {
    return {
      baseUrl,
      modelIds: [],
      message: compatibilityMode === "custom"
        ? "填写链接和 API Key 后会自动获取模型列表。"
        : "填写 API Key 后会自动获取模型列表。",
    }
  }

  let lastStatus = 0
  let sawUnfilteredModels = false
  const urls = buildModelUrls(compatibilityMode, baseUrl, apiKey)
  const headerCandidates = buildModelHeaders(compatibilityMode, apiKey) ?? [undefined]

  for (const url of urls) {
    for (const headers of headerCandidates) {
      const response = await fetch(url, {
        method: "GET",
        headers,
        timeout: 12,
      })

      lastStatus = response.status
      let payload: any = null
      try {
        payload = await response.json()
      } catch {}

      const availableModels = extractModelIds(payload, compatibilityMode)
      if (availableModels.length || payload?.data?.length || payload?.models?.length) sawUnfilteredModels = true
      const modelIds = filterTranslationModelIds(compatibilityMode, availableModels)
      if (response.ok && modelIds.length > 0) {
        return {
          baseUrl,
          modelIds,
          message: `发现 ${modelIds.length} 个模型。`,
        }
      }

      if ([401, 403, 404, 405].includes(response.status)) {
        continue
      }
    }
  }

  return {
    baseUrl,
    modelIds: [],
    message: sawUnfilteredModels
      ? "当前账号没有可用的非强制推理翻译模型。"
      : lastStatus
        ? `模型列表请求失败（HTTP ${lastStatus}）`
      : "接口可访问，但没有获取到可用模型。",
  }
}
