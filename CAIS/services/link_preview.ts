import { AbortSignal, fetch } from "scripting"
import type { LinkPreview } from "../types"
import { readLinkPreview, writeLinkPreview } from "../storage/database"
import { parseLinkPreviewHtml, previewableWebUrl } from "../utils/link_preview"

const MAX_HTML_BYTES = 160_000
const SUCCESS_TTL = 7 * 24 * 60 * 60 * 1000
const FAILURE_TTL = 5 * 60 * 1000
const MAX_PENDING = 8
const inflight = new Map<string, Promise<LinkPreview | null>>()
const waiting: Array<() => void> = []
let active = 0
let pending = 0

export function linkPreviewFresh(preview: LinkPreview | undefined | null): boolean {
  return Boolean(preview && (preview.iconUrl || (!preview.title && !preview.summary)) &&
    Date.now() - preview.fetchedAt < (preview.title || preview.summary ? SUCCESS_TTL : FAILURE_TTL))
}

async function fetchPreview(url: string): Promise<LinkPreview> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: { Accept: "text/html,application/xhtml+xml" },
    handleRedirect: async (request) => previewableWebUrl(request.url) ? request : null,
  })
  const contentType = response.headers.get("content-type") ?? ""
  if (!response.ok || !/^(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
    throw new Error("网页未返回 HTML")
  }
  const reader = response.body.getReader()
  const charset = response.textEncodingName || contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || "utf-8"
  let decoder: TextDecoder
  try { decoder = new TextDecoder(charset) } catch { decoder = new TextDecoder("utf-8") }
  let html = ""
  let bytes = 0
  try {
    while (bytes < MAX_HTML_BYTES) {
      const { done, value } = await reader.read()
      if (done || !value) break
      const remaining = MAX_HTML_BYTES - bytes
      bytes += value.byteLength
      html += decoder.decode(value.subarray(0, remaining), { stream: true })
    }
    html += decoder.decode()
  } finally {
    void reader.cancel().catch(() => {})
  }
  const parsed = parseLinkPreviewHtml(html, response.url || url)
  if (!parsed.title && !parsed.summary) throw new Error("网页未提供可显示内容")
  return { ...parsed, fetchedAt: Date.now() }
}

async function loadPreview(url: string): Promise<LinkPreview | null> {
  const cached = await readLinkPreview(url)
  if (linkPreviewFresh(cached)) return cached
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
  active += 1
  try {
    const preview = await fetchPreview(url).catch(() => ({ title: "", summary: "", fetchedAt: Date.now() }))
    try { await writeLinkPreview(url, preview) } catch {}
    return preview
  } finally {
    active -= 1
    waiting.shift()?.()
  }
}

export function requestLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!previewableWebUrl(url)) return Promise.resolve(null)
  const current = inflight.get(url)
  if (current) return current
  if (pending >= MAX_PENDING) return Promise.resolve(null)
  pending += 1
  const task = loadPreview(url).catch(() => null).finally(() => {
    pending -= 1
    inflight.delete(url)
  })
  inflight.set(url, task)
  return task
}
