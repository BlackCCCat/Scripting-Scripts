import {
  AbortController,
  fetch,
  type RequestInit,
  type Response,
} from "scripting"

import type { ApiCheckResult, ApiEntry, CheckStatus } from "../types"
import {
  defaultBaseUrlForMode,
  isLikelyHttpUrl,
  joinBaseUrl,
  normalizeBaseUrl,
} from "./common"

const REQUEST_TIMEOUT_MS = 8000
export const CHECK_CONCURRENCY_LIMIT = 4

type ProbeResult = {
  ok: boolean
  detail: string
  count?: number
  modelIds?: string[]
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  return await new Promise<Response>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      controller.abort()
      reject(new Error(`请求超时（${REQUEST_TIMEOUT_MS}ms）`))
    }, REQUEST_TIMEOUT_MS)

    fetch(url, {
      ...init,
      signal: controller.signal,
    })
      .then((response) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(response)
      })
      .catch((error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      })
  })
}

async function probeBase(baseUrl: string): Promise<ProbeResult> {
  try {
    const response = await fetchWithTimeout(joinBaseUrl(baseUrl, "/api/status"), {
      method: "GET",
    })
    return {
      ok: response.ok,
      detail: `/api/status ${response.status}`,
    }
  } catch (error: any) {
    return {
      ok: false,
      detail: String(error?.message ?? error),
    }
  }
}

function readModelCount(payload: any): number {
  if (Array.isArray(payload)) return payload.filter(Boolean).length
  if (Array.isArray(payload?.data)) return payload.data.filter(Boolean).length
  if (Array.isArray(payload?.models)) return payload.models.filter(Boolean).length
  return 0
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
    .map((item: any) => {
      if (typeof item === "string") return normalizeModelId(item)
      return normalizeModelId(String(item?.id ?? item?.name ?? item?.model ?? ""))
    })
    .filter(Boolean)
}

function normalizeModelId(value: string): string {
  return String(value ?? "").trim().replace(/^models\//, "")
}

async function probeModels(baseUrl: string, apiKey: string): Promise<ProbeResult> {
  try {
    const response = await fetchWithTimeout(joinBaseUrl(baseUrl, "/v1/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    if (!response.ok) {
      return {
        ok: false,
        detail: `/v1/models ${response.status}`,
      }
    }

    let count = 0
    let modelIds: string[] = []
    try {
      const payload = await response.json()
      count = readModelCount(payload)
      modelIds = extractModelIds(payload)
    } catch {
      count = 0
      modelIds = []
    }

    return {
      ok: count > 0,
      detail: count > 0 ? `发现 ${count} 个模型` : "模型列表为空",
      count,
      modelIds,
    }
  } catch (error: any) {
    return {
      ok: false,
      detail: String(error?.message ?? error),
    }
  }
}

async function checkOpenAICompatible(entry: ApiEntry): Promise<ApiCheckResult> {
  const baseUrl = normalizeBaseUrl(entry.baseUrl || defaultBaseUrlForMode("openai"))
  const apiKey = String(entry.apiKey ?? "").trim()
  const checkedAt = Date.now()

  if (!apiKey) {
    return {
      status: "red",
      baseAvailable: false,
      modelsAvailable: false,
      modelIds: [],
      checkedAt,
      message: "API Key 为空",
    }
  }

  if (!isLikelyHttpUrl(baseUrl)) {
    return {
      status: "red",
      baseAvailable: false,
      modelsAvailable: false,
      modelIds: [],
      checkedAt,
      message: "链接格式无效，请填写 http(s) 基础地址",
    }
  }

  try {
    const response = await fetchWithTimeout(joinBaseUrl(baseUrl, "/v1/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    let payload: any = null
    try {
      payload = await response.json()
    } catch {}

    const count = readModelCount(payload)
    const modelIds = extractModelIds(payload)
    if (response.ok && count > 0) {
      return {
        status: "green",
        baseAvailable: true,
        modelsAvailable: true,
        modelIds,
        checkedAt,
        message: `OpenAI 兼容接口可用，发现 ${count} 个模型`,
      }
    }

    const invalidApiKey = payload?.code === "INVALID_API_KEY"
    if (invalidApiKey || payload?.error || !response.ok) {
      return {
        status: "yellow",
        baseAvailable: true,
        modelsAvailable: false,
        modelIds: [],
        checkedAt,
        message: invalidApiKey
          ? "OpenAI 兼容地址可用，但 API Key 无效"
          : "OpenAI 兼容地址可用，但模型接口不可用或没有可用模型",
      }
    }

    return {
      status: "yellow",
      baseAvailable: true,
      modelsAvailable: false,
      modelIds,
      checkedAt,
      message: "OpenAI 兼容地址可用，但模型列表为空",
    }
  } catch (error: any) {
    return {
      status: "red",
      baseAvailable: false,
      modelsAvailable: false,
      modelIds: [],
      checkedAt,
      message: String(error?.message ?? error),
    }
  }
}

async function checkGeminiCompatible(entry: ApiEntry): Promise<ApiCheckResult> {
  const baseUrl = normalizeBaseUrl(entry.baseUrl || defaultBaseUrlForMode("gemini"))
  const apiKey = String(entry.apiKey ?? "").trim()
  const checkedAt = Date.now()

  if (!apiKey) {
    return {
      status: "red",
      baseAvailable: false,
      modelsAvailable: false,
      modelIds: [],
      checkedAt,
      message: "API Key 为空",
    }
  }

  if (!isLikelyHttpUrl(baseUrl)) {
    return {
      status: "red",
      baseAvailable: false,
      modelsAvailable: false,
      modelIds: [],
      checkedAt,
      message: "链接格式无效，请填写 http(s) 基础地址",
    }
  }

  try {
    const response = await fetchWithTimeout(
      `${joinBaseUrl(baseUrl, "/v1beta/models")}?key=${encodeURIComponent(apiKey)}`,
      {
        method: "GET",
      }
    )
    let payload: any = null
    try {
      payload = await response.json()
    } catch {}

    const count = readModelCount(payload)
    const modelIds = extractModelIds(payload)
    if (response.ok && count > 0) {
      return {
        status: "green",
        baseAvailable: true,
        modelsAvailable: true,
        modelIds,
        checkedAt,
        message: `Gemini 接口可用，发现 ${count} 个模型`,
      }
    }

    if (payload?.error || !response.ok) {
      return {
        status: "yellow",
        baseAvailable: true,
        modelsAvailable: false,
        modelIds: [],
        checkedAt,
        message: "Gemini 地址可用，但 API Key 无效或模型接口不可用",
      }
    }

    return {
      status: "yellow",
      baseAvailable: true,
      modelsAvailable: false,
      modelIds,
      checkedAt,
      message: "Gemini 地址可用，但模型列表为空",
    }
  } catch (error: any) {
    return {
      status: "red",
      baseAvailable: false,
      modelsAvailable: false,
      modelIds: [],
      checkedAt,
      message: String(error?.message ?? error),
    }
  }
}

function resolveStatus(baseAvailable: boolean, modelsAvailable: boolean): CheckStatus {
  if (baseAvailable && modelsAvailable) return "green"
  if (!baseAvailable && !modelsAvailable) return "red"
  return "yellow"
}

function buildMessage(base: ProbeResult, models: ProbeResult, status: CheckStatus): string {
  if (status === "green") {
    return `地址可用，${models.detail}`
  }
  if (status === "red") {
    return `地址不可用，模型接口不可用或 Key 无效`
  }
  if (base.ok) {
    return `地址可用，但模型接口不可用或没有可用模型`
  }
  return `模型接口可访问，但 /api/status 不可用`
}

export async function checkApiEntry(entry: ApiEntry): Promise<ApiCheckResult> {
  if (entry.compatibilityMode === "openai") {
    return checkOpenAICompatible(entry)
  }
  if (entry.compatibilityMode === "gemini") {
    return checkGeminiCompatible(entry)
  }

  const baseUrl = normalizeBaseUrl(entry.baseUrl)
  const apiKey = String(entry.apiKey ?? "").trim()
  const checkedAt = Date.now()

  if (!baseUrl || !apiKey) {
    return {
      status: "red",
      baseAvailable: false,
      modelsAvailable: false,
      modelIds: [],
      checkedAt,
      message: "地址或 API Key 为空",
    }
  }

  if (!isLikelyHttpUrl(baseUrl)) {
    return {
      status: "red",
      baseAvailable: false,
      modelsAvailable: false,
      modelIds: [],
      checkedAt,
      message: "链接格式无效，请填写 http(s) 基础地址",
    }
  }

  const [baseProbe, modelsProbe] = await Promise.all([
    probeBase(baseUrl),
    probeModels(baseUrl, apiKey),
  ])
  const status = resolveStatus(baseProbe.ok, modelsProbe.ok)

  return {
    status,
    baseAvailable: baseProbe.ok,
    modelsAvailable: modelsProbe.ok,
    modelIds: modelsProbe.modelIds ?? [],
    checkedAt,
    message: buildMessage(baseProbe, modelsProbe, status),
  }
}

export async function checkEntries(entries: ApiEntry[]): Promise<Map<string, ApiCheckResult>> {
  return runChecksConcurrently(entries)
}

export async function runChecksConcurrently(
  entries: ApiEntry[],
  onResult?: (entry: ApiEntry, result: ApiCheckResult, completedCount: number) => void | Promise<void>,
  concurrency = CHECK_CONCURRENCY_LIMIT
): Promise<Map<string, ApiCheckResult>> {
  const results = new Map<string, ApiCheckResult>()
  const limit = Math.max(1, Math.min(concurrency, entries.length || 1))
  let nextIndex = 0

  async function worker() {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= entries.length) return

      const entry = entries[currentIndex]
      let result: ApiCheckResult
      try {
        result = await checkApiEntry(entry)
      } catch (error: any) {
        result = {
          status: "red",
          baseAvailable: false,
          modelsAvailable: false,
          modelIds: [],
          checkedAt: Date.now(),
          message: String(error?.message ?? error ?? "检测失败"),
        }
      }

      results.set(entry.id, result)
      if (onResult) {
        await onResult(entry, result, results.size)
      }
    }
  }

  await Promise.allSettled(
    Array.from({ length: limit }, () => worker())
  )

  return results
}
