import { createServer, type Server, type Socket } from "node:net"
import { newDiagnosticTrace, reportServerIssue, type DiagnosticTrace } from "./diagnostics"

const MAX_BODY = 8 * 1024 * 1024
const MAX_HEADERS = 16 * 1024
const REQUEST_IDLE_TIMEOUT = 60_000
const RESPONSE_IDLE_TIMEOUT = 610_000

function quietly(action: () => void, onError?: (error: unknown) => void) {
  try { action() } catch (error) { if (onError) { try { onError(error) } catch { } } }
}

export type HttpInput = { method: string; path: string; body: string }

export class HttpReply {
  private sent = false
  private ended = false
  private writing: Promise<void> = Promise.resolve()
  readonly controller = new AbortController()
  private bytesWritten = 0

  constructor(private readonly socket: Socket, readonly trace: DiagnosticTrace | null = null) {
    socket.on("close", () => quietly(() => {
      this.controller.abort()
      if (!this.ended) trace?.mark("socket.closed", { bytesWritten: this.bytesWritten })
      trace?.finish("closed")
    }, error => trace?.fail("client.abort", error)))
    socket.on("error", error => quietly(() => trace?.fail("socket.error", error)))
  }

  private closeSocket() {
    quietly(() => { if (!this.socket.destroyed) this.socket.end() }, error => this.trace?.fail("downstream.end", error))
  }

  destroy() {
    quietly(() => { if (!this.socket.destroyed) this.socket.destroy() }, error => this.trace?.fail("downstream.destroy", error))
  }

  get headersSent() { return this.sent }
  get signal() { return this.controller.signal }

  private write(data: string): Promise<void> {
    const action = this.writing.then(async () => {
      const bytes = new TextEncoder().encode(data)
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        if (this.socket.destroyed) throw new Error("客户端连接已关闭")
        await new Promise<void>((resolve, reject) => {
          try { this.socket.write(bytes.subarray(offset, offset + 64 * 1024), error => error ? reject(error) : resolve()) }
          catch (error) { reject(error) }
        })
        this.bytesWritten += Math.min(64 * 1024, bytes.length - offset)
      }
    })
    this.writing = action.catch(() => {})
    void action.catch(error => this.trace?.fail("downstream.write", error))
    return action
  }

  async json(status: number, value: unknown) {
    if (this.sent) return
    const body = JSON.stringify(value)
    this.sent = true
    this.trace?.mark("downstream.headers", { status, bodyBytes: Buffer.byteLength(body) })
    await this.write(`HTTP/1.1 ${status} ${status === 200 ? "OK" : "Error"}\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
    this.ended = true
    this.trace?.mark("downstream.completed", { bytesWritten: this.bytesWritten })
    this.trace?.finish(status < 400 ? "ok" : "error", status)
    this.closeSocket()
  }

  async startEvents() {
    if (this.sent) return
    this.sent = true
    this.trace?.mark("downstream.headers", { status: 200, stream: true })
    await this.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-store\r\nX-Accel-Buffering: no\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
  }

  async event(value: unknown) {
    await this.chunk(`data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`)
  }

  async comment() { await this.chunk(": keep-alive\n\n") }

  private async chunk(body: string) {
    if (!this.sent || this.ended) throw new Error("事件流已结束")
    await this.write(`${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n`)
  }

  async endEvents(outcome: "ok" | "error" = "ok") {
    if (this.ended || this.socket.destroyed) return
    try {
      if (!this.sent) return this.destroy()
      await this.event("[DONE]")
      this.ended = true
      await this.write("0\r\n\r\n")
      this.trace?.mark("downstream.completed", { bytesWritten: this.bytesWritten })
      this.trace?.finish(outcome, 200)
      this.closeSocket()
    } catch (error) {
      quietly(() => this.trace?.fail("downstream.end_events", error))
      this.ended = true
      this.destroy()
    }
  }

  async fail(error: unknown) {
    quietly(() => this.trace?.fail("gateway.unhandled", error))
    if (this.ended) return
    try {
      if (this.headersSent) {
        await this.event({ error: { message: error instanceof Error ? error.message : String(error), type: "api_error" } })
        await this.endEvents("error")
      } else await this.json(500, { error: { message: "服务内部错误", type: "api_error" } })
    } catch (error) { quietly(() => this.trace?.fail("gateway.reply_failed", error)); this.destroy() }
  }
}

function chunkedBody(bytes: Buffer): Buffer | null {
  const parts: Buffer[] = []
  let offset = 0, size = 0
  while (true) {
    const end = bytes.indexOf("\r\n", offset)
    if (end < 0) return null
    const token = bytes.toString("ascii", offset, end).split(";", 1)[0]
    if (!/^[\da-f]+$/i.test(token)) throw new Error("分块请求格式错误")
    const length = Number.parseInt(token, 16)
    if (!Number.isSafeInteger(length) || size + length > MAX_BODY) throw new Error("请求体超过 8 MB")
    offset = end + 2
    if (length === 0) {
      if (bytes.length < offset + 2) return null
      if (bytes.toString("ascii", offset, offset + 2) !== "\r\n") throw new Error("不支持请求尾部字段")
      const result = Buffer.allocUnsafe(size)
      let position = 0
      for (const part of parts) { result.set(part, position); position += part.length }
      return result
    }
    if (bytes.length < offset + length + 2) return null
    if (bytes.toString("ascii", offset + length, offset + length + 2) !== "\r\n") throw new Error("分块请求格式错误")
    parts.push(bytes.subarray(offset, offset + length))
    size += length
    offset += length + 2
  }
}

export class RawHttpServer {
  private readonly peers = new Set<Socket>()
  private readonly server: Server

  constructor(private readonly handler: (input: HttpInput, reply: HttpReply) => Promise<void>) {
    this.server = createServer({ noDelay: true, allowHalfOpen: true }, socket => this.accept(socket))
    this.server.on("error", error => reportServerIssue("server.error", error))
  }

  get running() { return this.server.listening }
  get port() {
    const address = this.server.address()
    return address && typeof address !== "string" ? address.port : null
  }

  async start(port: number, lan: boolean) {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => { this.server.removeListener("error", fail); reject(error) }
      this.server.once("error", fail)
      this.server.listen({ port, host: lan ? "0.0.0.0" : "127.0.0.1" }, () => {
        this.server.removeListener("error", fail)
        resolve()
      })
    })
  }

  async stop() {
    const closed = this.server.listening ? new Promise<void>(resolve => this.server.close(() => resolve())) : Promise.resolve()
    for (const peer of this.peers) quietly(() => peer.destroy(), error => reportServerIssue("server.stop", error))
    this.peers.clear()
    await Promise.race([closed, new Promise<void>(resolve => setTimeout(resolve, 3_000))])
  }

  private accept(socket: Socket) {
    this.peers.add(socket)
    socket.on("close", () => this.peers.delete(socket))
    socket.on("error", () => {})
    const reply = new HttpReply(socket, newDiagnosticTrace())
    const idle = (ms: number) => quietly(() => socket.setTimeout(ms, () => { reply.trace?.mark("socket.idle_timeout"); reply.destroy() }), error => reply.trace?.fail("socket.timeout", error))
    idle(REQUEST_IDLE_TIMEOUT)
    let bytes = Buffer.alloc(0)
    let headersEnd = -1
    let bodyLength = 0
    let chunked = false
    let method = "", path = "", received = false
    socket.on("end", () => { if (!received) reply.destroy() })
    socket.on("data", data => {
      if (received) return
      const incoming = typeof data === "string" ? Buffer.from(data) : data
      const combined = Buffer.allocUnsafe(bytes.length + incoming.length)
      combined.set(bytes, 0)
      combined.set(incoming, bytes.length)
      bytes = combined
      try {
        if (headersEnd < 0) {
          headersEnd = bytes.indexOf("\r\n\r\n")
          if (headersEnd < 0) {
            if (bytes.length > MAX_HEADERS) throw new Error("请求头过大")
            return
          }
          if (headersEnd > MAX_HEADERS) throw new Error("请求头过大")
          const [first, ...lines] = bytes.toString("latin1", 0, headersEnd).split("\r\n")
          const match = /^(GET|POST) (\/[^\s]*) HTTP\/1\.[01]$/.exec(first)
          if (!match) throw new Error("仅支持 HTTP/1.0 或 HTTP/1.1 GET/POST")
          method = match[1]
          path = match[2].split("?", 1)[0]
          reply.trace?.setRequest(method, path)
          const headers = new Map<string, string>()
          for (const line of lines) {
            const colon = line.indexOf(":")
            if (colon <= 0) throw new Error("请求头格式错误")
            const name = line.slice(0, colon).toLowerCase()
            if (headers.has(name)) throw new Error("重复请求头不受支持")
            headers.set(name, line.slice(colon + 1).trim())
          }
          chunked = headers.get("transfer-encoding")?.toLowerCase() === "chunked"
          if (headers.has("transfer-encoding") && !chunked || chunked && headers.has("content-length")) throw new Error("请求体编码不受支持")
          const length = headers.get("content-length") ?? "0"
          if (!chunked && !/^\d+$/.test(length)) throw new Error("Content-Length 无效")
          bodyLength = chunked ? 0 : Number(length)
          if (!Number.isSafeInteger(bodyLength) || bodyLength > MAX_BODY) throw new Error("请求体超过 8 MB")
          if (headers.get("expect")?.toLowerCase() === "100-continue") socket.write("HTTP/1.1 100 Continue\r\n\r\n")
        }
        const body = bytes.subarray(headersEnd + 4)
        if (body.length > MAX_BODY + 64 * 1024) throw new Error("请求体超过 8 MB")
        const complete = chunked ? chunkedBody(body) : body.length >= bodyLength ? body.subarray(0, bodyLength) : null
        if (!complete) return
        received = true
        idle(RESPONSE_IDLE_TIMEOUT)
        bytes = Buffer.alloc(0)
        reply.trace?.mark("http.body", { bytes: complete.length })
        void this.handler({ method, path, body: complete.toString("utf8") }, reply).catch(error => { void reply.fail(error) })
      } catch (error) {
        received = true
        reply.trace?.fail("http.parse", error)
        void reply.json(400, { error: { message: error instanceof Error ? error.message : String(error), type: "invalid_request_error" } }).catch(() => reply.destroy())
      }
    })
  }
}
