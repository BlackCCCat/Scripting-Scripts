import { fetch, Path } from "scripting"
import { CUSTOM_TLS_SNI_HOSTS, fetchWithCustomSni, isIpHost, SubscriptionHttpError } from "./auto_tls_http"
import { loadConfig } from "./config"
import { getModulesDirResolved } from "./storage"

export type Subscription = {
  name: string
  url: string
  fileName: string
  nodeCount?: number
}

export type SubscriptionEditorResult = {
  subscription: Subscription
  overwriteExisting: boolean
}

const STORAGE_KEY = "surge_modules_manager_subscriptions_v1"
const MAX_RESPONSE_LENGTH = 5_000_000

export function loadSubscriptions(): Subscription[] {
  try {
    const raw = Storage.get(STORAGE_KEY)
    const items = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!Array.isArray(items)) return []
    return items.filter((item) =>
      typeof item?.name === "string" &&
      typeof item?.url === "string" &&
      /^https?:\/\/\S+$/i.test(item.url) &&
      typeof item?.fileName === "string"
    )
  } catch {
    return []
  }
}

export function saveSubscriptions(items: Subscription[]): void {
  if (!Storage.set(STORAGE_KEY, JSON.stringify(items))) {
    throw new Error("保存订阅信息失败")
  }
}

export function normalizeFileName(value: string): string {
  const name = value.trim().replace(/\.dconf$/i, "")
  if (!name || name === "." || name === ".." || /[\/\\:\x00-\x1f]/.test(name) || name.startsWith(".")) {
    throw new Error("文件名不能留空，也不能包含路径或特殊字符")
  }
  return name
}

function decodeName(value: string): string {
  try {
    return decodeURIComponent(value).replace(/[=,\r\n]/g, " ").trim()
  } catch {
    return value.replace(/[=,\r\n]/g, " ").trim()
  }
}

function parseShareLink(raw: string, index: number): { name: string; line: string } | null {
  let url: any
  try {
    url = new (globalThis as any).URL(raw)
  } catch {
    return null
  }
  const protocol = url.protocol.slice(0, -1).toLowerCase()
  if (protocol !== "vless" && protocol !== "anytls") return null
  const host = url.hostname
  const port = Number(url.port)
  let identity: string
  try {
    identity = decodeURIComponent(url.username)
  } catch {
    return null
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !identity || /[,\r\n]/.test(identity)) return null
  const name = decodeName(url.hash.slice(1)) || `节点 ${index}`
  const parts = [protocol, host, String(port)]
  const query = url.searchParams
  const add = (key: string, value: string | null) => {
    if (value) parts.push(`${key}=${value.replace(/[\r\n,]/g, "")}`)
  }

  if (protocol === "anytls") {
    add("password", identity)
    add("sni", query.get("sni") || query.get("peer"))
    if (query.get("insecure") === "1" || query.get("allowInsecure") === "1") {
      parts.push("skip-cert-verify=true")
    }
  } else {
    const transport = (query.get("type") || "tcp").toLowerCase()
    const security = (query.get("security") || "none").toLowerCase()
    if (!["tcp", "raw", "ws", "grpc"].includes(transport)) return null
    if (!["none", "tls", "reality"].includes(security)) return null
    if (query.get("encryption") && query.get("encryption") !== "none") return null
    if (transport === "grpc" && security === "none") return null
    if (transport === "ws" && security === "reality") return null
    add("username", identity)
    if (query.get("flow")) {
      if (transport === "ws" || security === "none") return null
      add("flow", query.get("flow"))
    }
    if (transport === "ws") {
      parts.push("ws=true")
      add("ws-path", query.get("path"))
      add("ws-headers", query.get("host") ? `Host:${query.get("host")}` : null)
    }
    if (transport === "grpc") {
      parts.push("grpc=true")
      add("grpc-service-name", query.get("serviceName"))
      add("grpc-authority", query.get("authority"))
      if (query.get("mode") === "multi") parts.push("grpc-mode=multi")
    }
    if (security === "tls") parts.push("tls=true")
    if (security === "reality") {
      if (!query.get("pbk")) return null
      add("reality-public-key", query.get("pbk"))
      add("reality-short-id", query.get("sid"))
    }
    add("sni", query.get("sni"))
    add("alpn", query.get("alpn"))
    if (query.get("allowInsecure") === "1") parts.push("skip-cert-verify=true")
  }
  return { name, line: parts.join(", ") }
}

function decodeSubscription(text: string): string {
  const trimmed = text.trim()
  if (/\[Proxy\]/i.test(trimmed) || /(?:vless|anytls):\/\//i.test(trimmed) || /^proxies:\s*$/m.test(trimmed)) return trimmed
  const compact = trimmed.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/")
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) return trimmed
  const decoded = Data.fromBase64String(compact.padEnd(Math.ceil(compact.length / 4) * 4, "="))?.toRawString("utf-8")
  return decoded || trimmed
}

function yamlScalar(raw: string): string {
  const value = raw.trim()
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) } catch { return value.slice(1, -1) }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  return value.replace(/\s+#.*$/, "").trim()
}

function splitFlowMapping(source: string): string[] {
  const parts: string[] = []
  let quote = ""
  let depth = 0
  let start = 0
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === "\\" && quote === '"') index++
      else if (char === quote) quote = ""
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
    } else if (char === "{" || char === "[") {
      depth++
    } else if (char === "}" || char === "]") {
      depth--
    } else if (char === "," && depth === 0) {
      parts.push(source.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(source.slice(start).trim())
  return parts.filter(Boolean)
}

function splitFlowPair(source: string): [string, string] | null {
  let quote = ""
  let depth = 0
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === "\\" && quote === '"') index++
      else if (char === quote) quote = ""
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
    } else if (char === "{" || char === "[") {
      depth++
    } else if (char === "}" || char === "]") {
      depth--
    } else if (char === ":" && depth === 0) {
      return [source.slice(0, index).trim(), source.slice(index + 1).trim()]
    }
  }
  return null
}

function parseInlineYamlMapping(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  const value = source.trim()
  if (!value.startsWith("{") || !value.endsWith("}")) return result
  for (const part of splitFlowMapping(value.slice(1, -1))) {
    const pair = splitFlowPair(part)
    if (!pair || !pair[0]) continue
    const [key, rawValue] = pair
    if (rawValue.startsWith("{") && rawValue.endsWith("}")) {
      const nested = parseInlineYamlMapping(rawValue)
      for (const [nestedKey, nestedValue] of Object.entries(nested)) {
        result[`${key}.${nestedKey}`] = nestedValue
      }
    } else {
      result[key] = yamlScalar(rawValue)
    }
  }
  return result
}

function parseClashProxies(source: string): { proxies: { name: string; line: string }[]; skipped: number } | null {
  if (!/^proxies:\s*$/m.test(source)) return null
  const proxies: { name: string; line: string }[] = []
  let skipped = 0
  let inProxies = false
  let current: Record<string, string> | null = null
  let nested = ""
  let itemIndent = -1
  let keyIndent = -1

  function appendNode(node: Record<string, string>) {
    const type = node.type?.toLowerCase()
    const port = Number(node.port)
    const network = (node.network || "tcp").toLowerCase()
    const identity = type === "anytls" ? node.password : node.uuid
    const sni = node.servername || node.sni || node["tls-name"]
    if (!["vless", "anytls"].includes(type) || !node.name || !node.server || !identity || !Number.isInteger(port) || port < 1 || port > 65535 ||
      (type === "vless" && !["tcp", "raw"].includes(network)) ||
      [node.server, identity, node.flow, sni, node["reality-opts.public-key"], node["reality-opts.short-id"]].some((value) => value && /[,\r\n]/.test(value))) {
      skipped++
      return
    }
    const parts = [type, node.server, String(port), `${type === "anytls" ? "password" : "username"}=${identity}`]
    if (sni) parts.push(`sni=${sni}`)
    if (type === "vless") {
      if (node.flow) parts.push(`flow=${node.flow}`)
      if (node["reality-opts.public-key"]) {
        parts.push(`reality-public-key=${node["reality-opts.public-key"]}`)
        if (node["reality-opts.short-id"]) parts.push(`reality-short-id=${node["reality-opts.short-id"]}`)
      } else if (node.tls === "true") {
        parts.push("tls=true")
      } else if (node.flow) {
        skipped++
        return
      }
    }
    if (node["skip-cert-verify"] === "true" || node.insecure === "true") parts.push("skip-cert-verify=true")
    proxies.push({ name: decodeName(node.name), line: parts.join(", ") })
  }

  function finish() {
    if (!current) return
    const node = current
    current = null
    appendNode(node)
  }

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "  ")
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()
    if (!inProxies) {
      if (/^proxies:\s*$/.test(line)) inProxies = true
      continue
    }
    if (trimmed && indent === 0 && !trimmed.startsWith("#")) {
      finish()
      break
    }
    if (!trimmed || trimmed.startsWith("#")) continue
    const inlineItem = trimmed.match(/^-\s*(\{.+\})\s*$/)
    if (inlineItem) {
      finish()
      appendNode(parseInlineYamlMapping(inlineItem[1]))
      continue
    }
    const item = line.match(/^(\s*)-\s+([\w-]+)\s*:\s*(.*)$/)
    if (item && (itemIndent < 0 || indent === itemIndent)) {
      finish()
      itemIndent = indent
      keyIndent = -1
      nested = ""
      current = { [item[2]]: yamlScalar(item[3]) }
      continue
    }
    if (!current) continue
    const field = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/)
    if (!field) continue
    if (keyIndent < 0) keyIndent = indent
    if (indent === keyIndent) {
      nested = field[2] ? "" : field[1]
      if (field[2]) current[field[1]] = yamlScalar(field[2])
    } else if (indent > keyIndent && nested) {
      current[`${nested}.${field[1]}`] = yamlScalar(field[2])
    }
  }
  finish()
  return { proxies, skipped }
}

export function convertSubscription(text: string): { content: string; count: number; skipped: number } {
  const source = decodeSubscription(text)
  const clash = parseClashProxies(source)
  if (clash) {
    if (!clash.proxies.length) throw new Error("Clash 订阅中没有可转换的 VLESS 或 AnyTLS 节点")
    const names = new Map<string, number>()
    const lines = clash.proxies.map((proxy) => {
      const seen = names.get(proxy.name) ?? 0
      names.set(proxy.name, seen + 1)
      return `${seen ? `${proxy.name} (${seen + 1})` : proxy.name} = ${proxy.line}`
    })
    return { content: `[Proxy]\n${lines.join("\n")}\n`, count: lines.length, skipped: clash.skipped }
  }
  const lines = source.split(/\r?\n/)
  const proxySection = lines.some((line) => /^\s*\[Proxy\]\s*$/i.test(line))
  const proxies: string[] = []
  const names = new Map<string, number>()
  let section = ""
  let skipped = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || line.startsWith("//") || line.startsWith(";")) continue
    if (line.startsWith("[")) {
      section = line.toLowerCase()
      continue
    }
    let parsed: { name: string; line: string } | null = null
    if (proxySection) {
      if (section !== "[proxy]") continue
      const match = line.match(/^([^=]+?)\s*=\s*(vless|anytls)\s*,\s*(.+)$/i)
      if (match) parsed = { name: decodeName(match[1]), line: `${match[2]}, ${match[3]}` }
    } else {
      const match = line.match(/^(?:vless|anytls):\/\/[^\s]+/i)
      if (match) parsed = parseShareLink(match[0], proxies.length + 1)
    }
    if (!parsed || !parsed.name) {
      skipped++
      continue
    }
    const seen = names.get(parsed.name) ?? 0
    names.set(parsed.name, seen + 1)
    proxies.push(`${seen ? `${parsed.name} (${seen + 1})` : parsed.name} = ${parsed.line}`)
  }
  if (!proxies.length) throw new Error("没有识别到 VLESS 或 AnyTLS 节点；请检查订阅格式")
  return { content: `[Proxy]\n${proxies.join("\n")}\n`, count: proxies.length, skipped }
}

async function subscriptionFilePath(fileName: string): Promise<string> {
  const cfg = loadConfig()
  if (!cfg.baseDir || !cfg.baseBookmarkName) throw new Error("请先在模块设置中选择书签文件夹")
  const root = await getModulesDirResolved()
  if (!root) throw new Error("书签路径不可用，请在模块设置中重新选择文件夹")
  return Path.join(root, `${normalizeFileName(fileName)}.dconf`)
}

export async function subscriptionFileExists(fileName: string): Promise<boolean> {
  return FileManager.exists(await subscriptionFilePath(fileName))
}

export async function removeSubscriptionFile(item: Subscription): Promise<void> {
  const path = await subscriptionFilePath(item.fileName)
  if (!await FileManager.exists(path)) return
  await FileManager.remove(path)
}

export async function readSubscriptionFile(item: Subscription): Promise<string> {
  const path = await subscriptionFilePath(item.fileName)
  if (!await FileManager.exists(path)) throw new Error(`未找到 ${item.fileName}.dconf`)
  return FileManager.readAsString(path)
}

export async function writeSubscriptionFile(item: Subscription, content: string): Promise<void> {
  const path = await subscriptionFilePath(item.fileName)
  if (!await FileManager.exists(path)) throw new Error(`未找到 ${item.fileName}.dconf`)
  await FileManager.writeAsString(path, content)
}

function requestFailureReason(error: unknown): string {
  const message = String((error as { message?: string })?.message ?? error)
  if (/timeout|timed out|超时/i.test(message)) return "订阅请求超时，请检查网络或服务器状态"
  if (/certificate|证书/i.test(message)) return "订阅服务器证书验证失败，请检查订阅地址或证书"
  if (/ssl|tls|handshake|握手/i.test(message)) return "订阅服务器 TLS 握手失败，请检查域名、端口或服务器状态"
  return "无法连接订阅服务器，请检查网络、订阅地址或服务器状态"
}

export async function updateSubscription(item: Subscription, isNew: boolean, overwriteExisting = false): Promise<{ count: number; skipped: number }> {
  const path = await subscriptionFilePath(item.fileName)
  if (isNew && !overwriteExisting && await FileManager.exists(path)) throw new Error("目标目录已有同名文件，请确认后再覆盖")
  const url = item.url.trim()
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error("请输入有效的 HTTP 或 HTTPS 订阅链接")
  let converted: ReturnType<typeof convertSubscription> | undefined
  let lastError = "获取订阅失败，请检查网络和订阅链接"
  const target = new URL(url)
  const userAgent = "ClashMeta/1.18.0"

  if (target.protocol === "https:" && isIpHost(target.hostname)) {
    let rateLimitRetried = false
    for (let round = 0; round < 3 && !converted; round++) {
      for (const sniHost of CUSTOM_TLS_SNI_HOSTS) {
        try {
          const text = await fetchWithCustomSni(url, sniHost, userAgent)
          if (text.length > MAX_RESPONSE_LENGTH) throw new Error("订阅内容过大，已停止导入")
          converted = convertSubscription(text)
          break
        } catch (customError: any) {
          if (customError instanceof SubscriptionHttpError) {
            const retryAfter = customError.retryAfterSeconds
            const canRetry = customError.status === 429 && !rateLimitRetried && retryAfter >= 1 && retryAfter <= 90
            if (!canRetry) throw customError
            rateLimitRetried = true
            await new Promise<void>((resolve) => setTimeout(() => resolve(), (retryAfter + 1) * 1000))
            try {
              const text = await fetchWithCustomSni(url, sniHost, userAgent)
              if (text.length > MAX_RESPONSE_LENGTH) throw new Error("订阅内容过大，已停止导入")
              converted = convertSubscription(text)
              break
            } catch (retryError) {
              if (retryError instanceof SubscriptionHttpError) throw retryError
              lastError = String((retryError as any)?.message ?? retryError)
            }
          }
          lastError = String(customError?.message ?? customError)
          await new Promise<void>((resolve) => setTimeout(() => resolve(), 800))
        }
      }
    }
    if (!converted) throw new Error(`自动 TLS 请求失败：${lastError}`)
  } else {
    for (const currentUserAgent of [userAgent, "Egern/1.0"]) {
      let response: Awaited<ReturnType<typeof fetch>>
      try {
        response = await fetch(url, { timeout: 30, headers: { "User-Agent": currentUserAgent } })
      } catch (error) {
        throw new Error(requestFailureReason(error))
      }
      try {
        if (!response.ok) {
          if (response.status === 429) throw new Error("订阅服务器限流（HTTP 429），请稍后重试")
          lastError = `获取订阅失败：HTTP ${response.status}`
          continue
        }
        const text = await response.text()
        if (text.length > MAX_RESPONSE_LENGTH) throw new Error("订阅内容过大，已停止导入")
        converted = convertSubscription(text)
        break
      } catch (error: any) {
        if (String(error?.message ?? "").includes("HTTP 429")) throw error
        lastError = (error?.message?.includes("订阅") || error?.message?.includes("节点")) && !/https?:\/\//i.test(String(error.message))
          ? String(error.message)
          : "获取订阅失败，请检查网络和订阅链接"
      }
    }
  }
  if (!converted) throw new Error(lastError)
  await FileManager.writeAsString(path, converted.content)
  return { count: converted.count, skipped: converted.skipped }
}
