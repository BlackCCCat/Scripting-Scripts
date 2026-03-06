import {
  AbortController,
  fetch,
  type RequestInit,
  type Response,
} from "scripting"

import type { ApiCheckResult, ApiEntry, CheckStatus } from "../types"
import { isLikelyHttpUrl, joinBaseUrl, normalizeBaseUrl } from "./common"

const REQUEST_TIMEOUT_MS = 8000

type ProbeResult = {
  ok: boolean
  detail: string
  count?: number
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
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
    try {
      const payload = await response.json()
      count = readModelCount(payload)
    } catch {
      count = 0
    }

    return {
      ok: count > 0,
      detail: count > 0 ? `发现 ${count} 个模型` : "模型列表为空",
      count,
    }
  } catch (error: any) {
    return {
      ok: false,
      detail: String(error?.message ?? error),
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
  const baseUrl = normalizeBaseUrl(entry.baseUrl)
  const apiKey = String(entry.apiKey ?? "").trim()
  const checkedAt = Date.now()

  if (!baseUrl || !apiKey) {
    return {
      status: "red",
      baseAvailable: false,
      modelsAvailable: false,
      checkedAt,
      message: "地址或 API Key 为空",
    }
  }

  if (!isLikelyHttpUrl(baseUrl)) {
    return {
      status: "red",
      baseAvailable: false,
      modelsAvailable: false,
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
    checkedAt,
    message: buildMessage(baseProbe, modelsProbe, status),
  }
}

export async function checkEntries(entries: ApiEntry[]): Promise<Map<string, ApiCheckResult>> {
  const results = await Promise.all(
    entries.map(async (entry) => ({
      id: entry.id,
      result: await checkApiEntry(entry),
    }))
  )
  return new Map(results.map((item) => [item.id, item.result]))
}
