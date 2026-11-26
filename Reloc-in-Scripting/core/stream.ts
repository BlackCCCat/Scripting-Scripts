export interface ByteStream {
  read(max: number): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export const MAX_CHUNK = 16384;

export class StreamClosedError extends Error {
  constructor(message = "连接已被对端关闭") {
    super(message);
  }
}

export class ReadTimeoutError extends Error {
  constructor(message = "读取超时") {
    super(message);
  }
}

const TIMEOUT_SENTINEL = Symbol("timeout");

async function awaitWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT_SENTINEL> {
  return new Promise<T | typeof TIMEOUT_SENTINEL>((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), Math.max(1, ms));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 带缓冲的读取器（保持最多只有 1 个底层 read() 在途，满足 VPNRSDConnection 的单读约束）。
 */
export class BufferedReader {
  private buffer: Uint8Array = new Uint8Array(0);
  private pendingRead: Promise<Uint8Array | null> | null = null;
  private eof = false;

  constructor(private readonly stream: ByteStream) {}

  get buffered(): number {
    return this.buffer.length;
  }

  private take(count: number): Uint8Array {
    const out = this.buffer.slice(0, count);
    this.buffer = this.buffer.subarray(count);
    return out;
  }

  private ensureReadPromise(): Promise<Uint8Array | null> {
    if (!this.pendingRead) {
      this.pendingRead = this.stream.read(MAX_CHUNK).finally(() => {
        this.pendingRead = null;
      });
    }
    return this.pendingRead;
  }

  private async fillStatus(timeoutMs?: number): Promise<"ok" | "eof" | "timeout"> {
    if (this.eof) return "eof";
    const readPromise = this.ensureReadPromise();
    let chunk: Uint8Array | null;
    if (timeoutMs !== undefined) {
      const raced = await awaitWithTimeout(readPromise, timeoutMs);
      if (raced === TIMEOUT_SENTINEL) return "timeout";
      chunk = raced;
    } else {
      chunk = await readPromise;
    }

    if (!chunk || chunk.length === 0) {
      this.eof = true;
      return "eof";
    }
    if (this.buffer.length === 0) {
      this.buffer = chunk;
    } else {
      const merged = new Uint8Array(this.buffer.length + chunk.length);
      merged.set(this.buffer);
      merged.set(chunk, this.buffer.length);
      this.buffer = merged;
    }
    return "ok";
  }

  /**
   * 在不触发异常栈分配的前提下读取指定字节；超时返回 null，EOF 抛出 StreamClosedError。
   */
  async readExactOrTimeout(count: number, timeoutMs?: number): Promise<Uint8Array | null> {
    const deadline = timeoutMs !== undefined ? Date.now() + Math.max(1, timeoutMs) : undefined;
    while (this.buffer.length < count) {
      const remaining = deadline !== undefined ? Math.max(1, deadline - Date.now()) : undefined;
      if (deadline !== undefined && Date.now() >= deadline) {
        return null;
      }
      const status = await this.fillStatus(remaining);
      if (status === "timeout") return null;
      if (status === "eof") throw new StreamClosedError();
    }
    return this.take(count);
  }

  async readExact(count: number, timeoutMs?: number): Promise<Uint8Array> {
    const out = await this.readExactOrTimeout(count, timeoutMs);
    if (!out) throw new ReadTimeoutError();
    return out;
  }

  async readSome(timeoutMs?: number): Promise<Uint8Array | null> {
    if (this.buffer.length > 0) return this.take(this.buffer.length);
    const status = await this.fillStatus(timeoutMs);
    if (status === "timeout") throw new ReadTimeoutError();
    if (status === "eof") return null;
    return this.take(this.buffer.length);
  }
}

export async function writeAll(stream: ByteStream, data: Uint8Array): Promise<void> {
  for (let offset = 0; offset < data.length; offset += MAX_CHUNK) {
    await stream.write(data.subarray(offset, Math.min(offset + MAX_CHUNK, data.length)));
  }
}

export function withTimeoutError<T>(
  promise: Promise<T>,
  ms: number,
  makeError: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(makeError()), Math.max(1, ms));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return withTimeoutError(promise, ms, () => new Error(message));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
