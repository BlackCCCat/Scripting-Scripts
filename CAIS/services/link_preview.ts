import { AbortSignal, fetch } from "scripting"
import type { LinkPreview } from "../types"
import { readLinkPreview, writeLinkPreview } from "../storage/database"
import { parseLinkPreviewHtml, previewableWebUrl } from "../utils/link_preview"

const MAX_HTML_BYTES = 160_000
const SUCCESS_TTL = 7 * 24 * 60 * 60 * 1000
const FAILURE_TTL = 5 * 60 * 1000
const MAX_PENDING = 24
type PreviewListener = (preview: LinkPreview | null) => void
type PreviewJob = { url: string; listeners: Set<PreviewListener>; started: boolean }
const jobs = new Map<string, PreviewJob>()
const queue: PreviewJob[] = []
const recent = new Map<string, LinkPreview>()
const scrollingOwners = new Set<unknown>()
const idleCallbacks = new Set<() => void>()
const idleWaiters = new Set<() => void>()
let running = false
let wakeTimer: ReturnType<typeof setTimeout> | null = null

function remember(url: string, preview: LinkPreview): void {
  recent.delete(url)
  recent.set(url, preview)
  if (recent.size > 128) recent.delete(recent.keys().next().value!)
}

function scheduleIdleWork(): void {
  if (wakeTimer || scrollingOwners.size || (!queue.length && !idleCallbacks.size)) return
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    if (scrollingOwners.size) return
    const callbacks = [...idleCallbacks].slice(0, 4)
    for (const callback of callbacks) {
      idleCallbacks.delete(callback)
      try { callback() } catch {}
    }
    if (running) {
      if (idleCallbacks.size) scheduleIdleWork()
      return
    }
    let job: PreviewJob | undefined
    while ((job = queue.shift())) {
      if (jobs.get(job.url) === job && job.listeners.size) break
    }
    if (!job || jobs.get(job.url) !== job || !job.listeners.size) {
      if (idleCallbacks.size) scheduleIdleWork()
      return
    }
    job.started = true
    running = true
    void loadPreview(job.url).then((preview) => {
      if (preview) remember(job.url, preview)
      for (const listener of job.listeners) {
        try { listener(preview) } catch {}
      }
    }).catch(() => {}).finally(() => {
      if (jobs.get(job!.url) === job) jobs.delete(job!.url)
      running = false
      scheduleIdleWork()
    })
    if (idleCallbacks.size) scheduleIdleWork()
  }, 150)
}

async function waitForIdle(): Promise<void> {
  while (scrollingOwners.size) {
    await new Promise<void>((resolve) => idleWaiters.add(resolve))
  }
}

export function setLinkPreviewScrolling(owner: unknown, scrolling: boolean): void {
  if (scrolling) scrollingOwners.add(owner)
  else scrollingOwners.delete(owner)
  if (scrollingOwners.size) return
  const waiters = [...idleWaiters]
  idleWaiters.clear()
  for (const resolve of waiters) resolve()
  scheduleIdleWork()
}

export function runWhenLinkPreviewIdle(callback: () => void): () => void {
  idleCallbacks.add(callback)
  scheduleIdleWork()
  return () => { idleCallbacks.delete(callback) }
}

export function linkPreviewFresh(preview: LinkPreview | undefined | null): boolean {
  if (!preview) return false
  const ttl = preview.title || preview.summary ? SUCCESS_TTL : FAILURE_TTL
  return Date.now() - preview.fetchedAt < ttl
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
  await waitForIdle()
  const parsed = parseLinkPreviewHtml(html, response.url || url)
  if (!parsed.title && !parsed.summary) throw new Error("网页未提供可显示内容")
  return { ...parsed, fetchedAt: Date.now() }
}

async function loadPreview(url: string): Promise<LinkPreview | null> {
  await waitForIdle()
  const cached = await readLinkPreview(url)
  if (linkPreviewFresh(cached)) return cached
  const preview = await fetchPreview(url).catch(() => ({ title: "", summary: "", fetchedAt: Date.now() }))
  await waitForIdle()
  try { await writeLinkPreview(url, preview) } catch {}
  return preview
}

export function observeLinkPreview(url: string, listener: PreviewListener): () => void {
  if (!previewableWebUrl(url)) return () => {}
  const cached = recent.get(url)
  if (linkPreviewFresh(cached)) {
    return runWhenLinkPreviewIdle(() => listener(cached!))
  }
  let job = jobs.get(url)
  if (!job) {
    if (jobs.size >= MAX_PENDING) return () => {}
    job = { url, listeners: new Set(), started: false }
    jobs.set(url, job)
    queue.push(job)
  }
  job.listeners.add(listener)
  scheduleIdleWork()
  return () => {
    job!.listeners.delete(listener)
    if (!job!.started && !job!.listeners.size && jobs.get(url) === job) {
      jobs.delete(url)
      const index = queue.indexOf(job!)
      if (index >= 0) queue.splice(index, 1)
    }
  }
}
