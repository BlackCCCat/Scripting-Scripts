import type { AppConfig } from "./config"

export function getRemoteBaseURL(cfg: AppConfig): string {
  const host = String(cfg.remoteHost ?? "http://127.0.0.1").trim() || "http://127.0.0.1"
  const port = String(cfg.remotePort ?? "").trim()
  return port ? `${host.replace(/\/+$/, "")}:${port}` : ""
}

export function getModuleRemoteName(module: { name: string; surgeName?: string }): string {
  return String(module.surgeName ?? "").trim() || module.name
}

function remoteHeaders(cfg: AppConfig): Record<string, string> {
  return {
    "X-Key": String(cfg.remotePassword ?? ""),
    "Content-Type": "application/json",
  }
}

function parseEnabledNames(data: any): Set<string> {
  const enabled = data?.enabled
  if (Array.isArray(enabled)) {
    return new Set(enabled.map((x) => String(x).trim()).filter(Boolean))
  }
  if (enabled && typeof enabled === "object") {
    return new Set(
      Object.entries(enabled)
        .filter(([, value]) => !!value)
        .map(([key]) => String(key).trim())
        .filter(Boolean)
    )
  }
  return new Set()
}

export async function fetchEnabledModuleNames(cfg: AppConfig): Promise<Set<string>> {
  const baseURL = getRemoteBaseURL(cfg)
  if (!baseURL) return new Set()
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用")

  const res = await fetchFn(`${baseURL}/v1/modules`, {
    method: "GET",
    headers: remoteHeaders(cfg),
  })
  if (!res?.ok) throw new Error(`请求失败：${res?.status ?? "unknown"}`)
  const data = await res.json()
  return parseEnabledNames(data)
}

export async function setRemoteModuleEnabled(
  cfg: AppConfig,
  moduleName: string,
  enabled: boolean
): Promise<void> {
  const baseURL = getRemoteBaseURL(cfg)
  if (!baseURL) throw new Error("请先配置 HTTP 远程控制端口")
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用")

  const res = await fetchFn(`${baseURL}/v1/modules`, {
    method: "POST",
    headers: remoteHeaders(cfg),
    body: JSON.stringify({ [moduleName]: enabled }),
  })
  if (!res?.ok) throw new Error(`请求失败：${res?.status ?? "unknown"}`)
}
