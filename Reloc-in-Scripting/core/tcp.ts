import { createConnection, type Socket } from "node:net";
import type { ByteStream } from "./stream";

export function wrapSocket(socket: Socket): ByteStream {
  const queue: Uint8Array[] = [];
  const waiters: { resolve: (chunk: Uint8Array | null) => void; reject: (error: Error) => void }[] = [];
  let queuedBytes = 0;
  let closed = false;
  let failure: Error | null = null;

  function push(chunk: Uint8Array) {
    if (closed) return;
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(chunk);
    else {
      if (queuedBytes + chunk.length > 4 * 1024 * 1024) {
        finish(new Error("配对连接缓冲已超限"));
        socket.destroy();
        return;
      }
      queue.push(chunk);
      queuedBytes += chunk.length;
    }
  }

  function finish(error?: Error) {
    if (error && !failure) failure = error;
    closed = true;
    while (waiters.length > 0) {
      const waiter = waiters.shift()!;
      if (failure) waiter.reject(failure);
      else waiter.resolve(null);
    }
  }

  socket.on("data", (data: Buffer) => {
    push(new Uint8Array(data));
  });
  socket.on("error", (error: Error) => finish(error));
  socket.on("close", () => finish());
  socket.on("end", () => finish());

  return {
    read(): Promise<Uint8Array | null> {
      const chunk = queue.shift();
      if (chunk) {
        queuedBytes -= chunk.length;
        return Promise.resolve(chunk);
      }
      if (closed) return failure ? Promise.reject(failure) : Promise.resolve(null);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    write(data: Uint8Array): Promise<void> {
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(failure ?? new Error("连接已关闭"));
          return;
        }
        socket.write(data, (error?: Error | null) => (error ? reject(error) : resolve()));
      });
    },
    close(): Promise<void> {
      socket.destroy();
      finish();
      return Promise.resolve();
    },
  };
}

export function connectTCP(host: string, port: number, timeoutMs = 5000): Promise<ByteStream> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port, noDelay: true });
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`连接 ${host}:${port} 超时`));
    }, timeoutMs);

    socket.on("connect", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(wrapSocket(socket));
    });

    socket.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

export interface ProbeResult {
  open: boolean;
  code: string | null;
}

export function probeTCPDetail(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;

    function settle(result: ProbeResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    }

    const timer = setTimeout(() => settle({ open: false, code: "ETIMEDOUT" }), timeoutMs);
    socket.on("connect", () => settle({ open: true, code: null }));
    socket.on("error", (error: unknown) => {
      settle({ open: false, code: (error as { code?: string } | null)?.code ?? "UNKNOWN" });
    });
  });
}

export function probeTCP(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return probeTCPDetail(host, port, timeoutMs).then((result) => result.open);
}
