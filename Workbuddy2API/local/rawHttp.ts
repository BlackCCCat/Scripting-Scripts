import { createServer, type Server, type Socket } from "node:net"

const MAX_BODY = 8 * 1024 * 1024
const MAX_HEADERS = 16 * 1024

export type HttpInput = { method: string; path: string; body: string }

export class HttpReply {
  private sent = false
  private ended = false
  private writing: Promise<void> = Promise.resolve()
  readonly controller = new AbortController()

  constructor(private readonly socket: Socket) {
    socket.on("close", () => this.controller.abort())
  }

  get headersSent() { return this.sent }
  get signal() { return this.controller.signal }

  private write(data: string): Promise<void> {
    const action = this.writing.then(async () => {
      const bytes = new TextEncoder().encode(data)
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        if (this.socket.destroyed) throw new Error("客户端连接已关闭")
        await new Promise<void>((resolve, reject) => {
          this.socket.write(bytes.subarray(offset, offset + 64 * 1024), error => error ? reject(error) : resolve())
        })
      }
    })
    this.writing = action.catch(() => {})
    return action
  }

  async json(status: number, value: unknown) {
    if (this.sent) return
    const body = JSON.stringify(value)
    this.sent = true
    await this.write(`HTTP/1.1 ${status} ${status === 200 ? "OK" : "Error"}\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
    this.ended = true
    this.socket.end()
  }

  async startEvents() {
    if (this.sent) return
    this.sent = true
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

  async endEvents() {
    if (this.ended || this.socket.destroyed) return
    await this.event("[DONE]")
    await this.write("0\r\n\r\n")
    this.ended = true
    this.socket.end()
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
    this.server = createServer({ noDelay: true }, socket => this.accept(socket))
    this.server.on("error", () => {})
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
    for (const peer of this.peers) peer.destroy()
    if (this.server.listening) await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  private accept(socket: Socket) {
    this.peers.add(socket)
    socket.on("close", () => this.peers.delete(socket))
    socket.on("error", () => {})
    socket.setTimeout(610_000, () => socket.destroy())
    const reply = new HttpReply(socket)
    let bytes = Buffer.alloc(0)
    let headersEnd = -1
    let bodyLength = 0
    let chunked = false
    let method = "", path = "", received = false
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
        bytes = Buffer.alloc(0)
        void this.handler({ method, path, body: complete.toString("utf8") }, reply).catch(async error => {
          try {
            if (reply.headersSent) { await reply.event({ error: { message: error instanceof Error ? error.message : String(error), type: "api_error" } }); await reply.endEvents() }
            else await reply.json(500, { error: { message: "服务内部错误", type: "api_error" } })
          } catch { socket.destroy() }
        })
      } catch (error) {
        received = true
        void reply.json(400, { error: { message: error instanceof Error ? error.message : String(error), type: "invalid_request_error" } }).catch(() => socket.destroy())
      }
    })
  }
}
