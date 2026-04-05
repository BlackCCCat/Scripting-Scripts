import { fetch } from "scripting"
import type { AiApiCompatibilityMode } from "../types"

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com"
const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"

function normalizeBaseUrl(value: string) {
  return String(value ?? "").trim().replace(/\/+$/, "")
}

function joinBaseUrl(baseUrl: string, suffix: string) {
  const base = normalizeBaseUrl(baseUrl)
  const path = suffix.startsWith("/") ? suffix : `/${suffix}`
  return `${base}${path}`
}

function normalizeMode(mode: unknown): AiApiCompatibilityMode {
  if (mode === "openai") return "openai"
  if (mode === "gemini") return "gemini"
  return "newapi"
}

function resolveBaseUrl(mode: AiApiCompatibilityMode, input: string) {
  const normalized = normalizeBaseUrl(input)
  if (normalized) return normalized
  if (mode === "openai") return OPENAI_DEFAULT_BASE_URL
  if (mode === "gemini") return GEMINI_DEFAULT_BASE_URL
  return ""
}

function extractModelIds(payload: any): string[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []

  return list
    .map((item: any) => String(item?.id ?? item?.name ?? item?.model ?? item).trim().replace(/^models\//, ""))
    .filter(Boolean)
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
      message: "填写 Base URL 和 API Key 后会自动获取模型列表。",
    }
  }

  const url = compatibilityMode === "gemini"
    ? `${joinBaseUrl(baseUrl, "/v1beta/models")}?key=${encodeURIComponent(apiKey)}`
    : joinBaseUrl(baseUrl, "/v1/models")

  // 这里先拉模型列表，再允许保存配置，顺手把接口可用性一起确认掉。
  const response = await fetch(url, {
    method: "GET",
    headers: compatibilityMode === "gemini"
      ? undefined
      : {
          Authorization: `Bearer ${apiKey}`,
        },
    timeout: 12,
  })

  let payload: any = null
  try {
    payload = await response.json()
  } catch {}

  const modelIds = extractModelIds(payload)
  if (response.ok && modelIds.length > 0) {
    return {
      baseUrl,
      modelIds,
      message: `发现 ${modelIds.length} 个模型。`,
    }
  }

  if (!response.ok) {
    return {
      baseUrl,
      modelIds: [],
      message: `模型列表请求失败（HTTP ${response.status}）`,
    }
  }

  return {
    baseUrl,
    modelIds: [],
    message: "接口可访问，但没有获取到可用模型。",
  }
}
