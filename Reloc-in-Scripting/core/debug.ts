import { redactLog } from "./redact";

export const DEBUG = false;
const RING_SIZE = 600;

interface LogEntry {
  stamp: string;
  line: string;
  count: number;
}

const ring: LogEntry[] = [];

function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return describeError(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function debugLog(tag: string, ...args: unknown[]): void {
  const line = `[reloc:${tag}] ${args.map(formatArg).join(" ")}`;
  const stamp = new Date().toISOString().slice(11, 23);

  const last = ring[ring.length - 1];
  if (last && last.line === line) {
    last.count += 1;
    last.stamp = stamp;
  } else {
    ring.push({ stamp, line, count: 1 });
    if (ring.length > RING_SIZE) ring.shift();
  }

  if (DEBUG) console.log(line);
}

export function debugLogText(options?: { raw?: boolean }): string {
  const text = ring
    .map((entry) => (entry.count > 1 ? `${entry.stamp} ${entry.line} ×${entry.count}` : `${entry.stamp} ${entry.line}`))
    .join("\n");
  return options?.raw ? text : redactLog(text);
}

export function debugLogCount(): number {
  return ring.length;
}

export function clearDebugLog(): void {
  ring.length = 0;
}

export function describeError(error: unknown): string {
  if (!(error instanceof Object)) return String(error);

  const parts: string[] = [];
  const anyError = error as Record<string, unknown>;
  if (typeof anyError.name === "string") parts.push(`name=${anyError.name}`);
  if (typeof anyError.message === "string") parts.push(`message=${anyError.message}`);

  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === "stack" || key === "message" || key === "name") continue;
    let value: unknown;
    try {
      value = anyError[key];
    } catch {
      continue;
    }
    if (value === undefined) continue;
    parts.push(`${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }

  return parts.join(" ") || String(error);
}
