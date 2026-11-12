import { createConnection } from "node:net"
import {
  makeTLSClient,
  setCryptoImplementation,
  webcryptoCrypto,
  type TLSClient,
} from "./vendor/reclaim-tls.bundle"

const MAX_RESPONSE_BYTES = 5_000_000
export const CUSTOM_TLS_SNI_HOSTS = [
  "cdn.cloudflare.com",
  "www.apple.com",
  "www.microsoft.com",
  "cdn.jsdelivr.net",
  "www.debian.org",
  "www.163.com",
]
const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
}

export class SubscriptionHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds = 0,
  ) {
    super(message)
    this.name = "SubscriptionHttpError"
  }
}

let cryptoReady = false

function ensureCrypto(): void {
  if (cryptoReady) return
  setCryptoImplementation(webcryptoCrypto)
  cryptoReady = true
}

export function isIpHost(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")
}

function findHeaderEnd(bytes: Uint8Array): number {
  const buffer = Buffer.from(bytes)
  return buffer.indexOf("\r\n\r\n")
}

function decodeChunkedBody(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let offset = 0
  while (offset < bytes.length) {
    const lineEnd = Buffer.from(bytes).indexOf("\r\n", offset)
    if (lineEnd < 0) throw new Error("订阅响应分块不完整")
    const line = Buffer.from(bytes.subarray(offset, lineEnd)).toString("ascii")
    const size = Number.parseInt(line.split(";", 1)[0].trim(), 16)
    if (!Number.isFinite(size) || size < 0) throw new Error("订阅响应分块格式错误")
    offset = lineEnd + 2
    if (size === 0) return new Uint8Array(Buffer.concat(chunks))
    const end = offset + size
    if (end + 2 > bytes.length) throw new Error("订阅响应分块不完整")
    chunks.push(bytes.subarray(offset, end))
    offset = end + 2
  }
  throw new Error("订阅响应分块不完整")
}

function decodeHttpResponse(bytes: Uint8Array): string {
  if (bytes.length > MAX_RESPONSE_BYTES) throw new Error("订阅内容过大，已停止导入")
  const headerEnd = findHeaderEnd(bytes)
  if (headerEnd < 0) throw new Error("订阅服务器返回了无效的 HTTP 响应")
  const headerText = Buffer.from(bytes.subarray(0, headerEnd)).toString("latin1")
  const [statusLine, ...headerLines] = headerText.split("\r\n")
  const status = Number(statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i)?.[1])
  const headers = new Map<string, string>()
  for (const line of headerLines) {
    const separator = line.indexOf(":")
    if (separator < 1) continue
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
  }
  let body = bytes.subarray(headerEnd + 4)
  if (/\bchunked\b/i.test(headers.get("transfer-encoding") ?? "")) body = decodeChunkedBody(body)
  const declaredLength = Number(headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength >= 0 && body.length < declaredLength) {
    throw new Error("订阅响应内容不完整")
  }
  const bodyText = Buffer.from(body).toString("utf8")
  if (status !== 200) {
    let serverMessage = ""
    let bodyRetryAfter = 0
    try {
      const payload = JSON.parse(bodyText)
      serverMessage = String(payload?.message ?? payload?.error ?? "").trim()
      bodyRetryAfter = Number(payload?.retry_after) || 0
    } catch {}
    if (!serverMessage && headers.get("x-subscription-error")) {
      try {
        serverMessage = decodeURIComponent(headers.get("x-subscription-error") ?? "").trim()
      } catch {}
    }
    const headerRetryAfter = Number(headers.get("retry-after")) || 0
    let retryAfterSeconds = Math.max(headerRetryAfter, bodyRetryAfter)
    const minutes = serverMessage.match(/(\d+)\s*分钟/)
    const seconds = serverMessage.match(/(\d+)\s*秒/)
    if (minutes) retryAfterSeconds = Math.max(retryAfterSeconds, Number(minutes[1]) * 60 + 2)
    else if (seconds) retryAfterSeconds = Math.max(retryAfterSeconds, Number(seconds[1]) + 2)
    else if (retryAfterSeconds > 0) retryAfterSeconds += 2
    const message = status === 429
      ? serverMessage || "订阅服务器限流（HTTP 429）"
      : `获取订阅失败：HTTP ${Number.isFinite(status) ? status : "未知"}${serverMessage ? `，${serverMessage}` : ""}`
    throw new SubscriptionHttpError(status, message, retryAfterSeconds)
  }
  return bodyText
}

export async function fetchWithCustomSni(
  targetUrl: string,
  sniHost: string,
  userAgent: string,
  timeoutMs = 15_000,
): Promise<string> {
  ensureCrypto()
  const url = new URL(targetUrl)
  if (url.protocol !== "https:") throw new Error("自定义 TLS 请求仅支持 HTTPS")
  const port = Number(url.port || 443)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("订阅地址端口无效")

  return await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: url.hostname, port, noDelay: true })
    const chunks: Uint8Array[] = []
    let settled = false
    let tls: TLSClient | undefined
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    let pending = Promise.resolve()

    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      if (closeTimer) clearTimeout(closeTimer)
      try {
        socket.destroy()
      } catch {}
      try {
        const text = chunks.length ? decodeHttpResponse(new Uint8Array(Buffer.concat(chunks))) : ""
        if (text) resolve(text)
        else reject(error instanceof Error ? error : new Error(String(error ?? "订阅服务器未返回内容")))
      } catch (decodeError) {
        reject(decodeError)
      }
    }

    const fail = (error: unknown) => finish(error)
    socket.setTimeout(timeoutMs, () => fail(new Error("自定义 TLS 请求超时")))
    socket.on("data", (data) => {
      if (settled || !tls) return
      const bytes = typeof data === "string" ? new Uint8Array(Buffer.from(data)) : new Uint8Array(data)
      pending = pending
        .then(() => tls!.handleReceivedBytes(bytes))
        .catch((error) => {
          if (!chunks.length) fail(error)
        })
    })
    socket.on("end", () => {
      if (!settled && !closeTimer) {
        closeTimer = setTimeout(() => {
          void pending.finally(() => finish())
        }, 100)
      }
    })
    socket.on("close", () => {
      if (!settled && !closeTimer) {
        closeTimer = setTimeout(() => {
          void pending.finally(() => finish())
        }, 100)
      }
    })
    socket.on("error", fail)

    tls = makeTLSClient({
      host: sniHost,
      verifyServerCertificate: false,
      applicationLayerProtocols: ["http/1.1"],
      cipherSuites: ["TLS_AES_128_GCM_SHA256", "TLS_AES_256_GCM_SHA384"],
      namedCurves: ["X25519"],
      supportedProtocolVersions: ["TLS1_3"],
      logger: NOOP_LOGGER,
      write(packet: { header: Uint8Array; content: Uint8Array }) {
        if (!settled) {
          socket.write(packet.header)
          socket.write(packet.content)
        }
      },
      onHandshake() {
        const request = [
          `GET ${url.pathname}${url.search} HTTP/1.1`,
          `Host: ${url.host}`,
          `User-Agent: ${userAgent}`,
          "Accept: */*",
          "Accept-Encoding: identity",
          "Connection: close",
          "",
          "",
        ].join("\r\n")
        void tls?.write(new Uint8Array(Buffer.from(request))).catch(fail)
      },
      onApplicationData(data: Uint8Array) {
        if (!settled) chunks.push(new Uint8Array(data))
      },
      onTlsEnd(error?: Error) {
        void pending.finally(() => finish(error))
      },
    })

    void tls.startHandshake().catch(fail)
  })
}
