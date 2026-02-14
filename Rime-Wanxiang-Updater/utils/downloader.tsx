// File: utils/downloader.tsx
export type DownloadProgress = {
  percent?: number
  received: number
  total?: number
  speedBps?: number
}

export type DownloadStateEvent =
  | {
      type: "retrying"
      attempt: number
      maxAttempts: number
    }

declare const BackgroundURLSession: any

const LARGE_FALLBACK_BYTES = 50 * 1024 * 1024
const STALL_TIMEOUT_MS = 2 * 60 * 1000
const HARD_TIMEOUT_MS = 5 * 60 * 1000
const MAX_RETRY = 1

// ✅ UI 刷新节流与阈值（你想“减缓频率”就在这里调）
const UI_MIN_INTERVAL_MS = 1000 // 最多 1 次/秒
const UI_MIN_DELTA_PERCENT = 0.005 // 0.5% 以上才刷新（1.0 = 100%）

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx > 0 ? path.slice(0, idx) : ""
}

async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
  try {
    const r = fn.apply(thisArg, args)
    if (r && typeof r.then === "function") return await r
    return r
  } catch {
    return undefined
  }
}

async function fileExistsLoose(path: string): Promise<boolean | undefined> {
  const fm = (globalThis as any).FileManager
  if (!fm) return undefined
  const fn = fm.exists ?? fm.fileExists ?? fm.existsSync
  if (typeof fn !== "function") return undefined
  const r = await callMaybeAsync(fn, fm, [path])
  return typeof r === "boolean" ? r : undefined
}

async function removeFileLoose(path: string) {
  const fm = (globalThis as any).FileManager
  if (!fm) return
  try {
    if (typeof fm.removeSync === "function") {
      fm.removeSync(path)
      return
    }
    if (typeof fm.remove === "function") {
      await fm.remove(path)
      return
    }
    if (typeof fm.delete === "function") {
      await fm.delete(path)
      return
    }
  } catch {}
}

function cancelTask(task: any) {
  try {
    if (typeof task?.cancel === "function") task.cancel()
  } catch {}
  try {
    if (typeof task?.stop === "function") task.stop()
  } catch {}
  try {
    if (typeof task?.suspend === "function") task.suspend()
  } catch {}
}

async function waitForFile(path: string, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await fileExistsLoose(path)
    if (ok) return true
    await sleep(200)
  }
  return false
}

async function fetchContentLength(url: string): Promise<number | undefined> {
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") return undefined

  // 1) HEAD
  try {
    const res = await fetchFn(url, { method: "HEAD" })
    const len = res?.headers?.get?.("content-length")
    const n = len != null ? Number(len) : NaN
    if (Number.isFinite(n) && n > 0) return n
  } catch {}

  // 2) Range
  try {
    const res = await fetchFn(url, { method: "GET", headers: { Range: "bytes=0-0" } })
    const cr = res?.headers?.get?.("content-range") ?? res?.headers?.get?.("Content-Range")
    if (typeof cr === "string") {
      const m = cr.match(/\/(\d+)\s*$/)
      const n = m ? Number(m[1]) : NaN
      if (Number.isFinite(n) && n > 0) return n
    }
  } catch {}

  return undefined
}

function num(v: any): number | undefined {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

function pickNum(obj: any, keys: string[]): number | undefined {
  if (!obj) return undefined
  for (const k of keys) {
    const v = num(obj[k])
    if (v !== undefined) return v
  }
  return undefined
}

function getFraction(task: any): number | undefined {
  const p = task?.progress
  const f1 = num(p?.fractionCompleted)
  if (f1 !== undefined) return f1

  const f2 = num(task?.fractionCompleted)
  if (f2 !== undefined) return f2

  const f3 = num(task?.progressPercent)
  if (f3 !== undefined) return f3 > 1 ? f3 / 100 : f3

  const written =
    pickNum(task, ["totalBytesWritten", "bytesWritten", "receivedBytes", "completedBytes"]) ??
    pickNum(p, ["completedUnitCount", "totalBytesWritten"])
  const total =
    pickNum(task, ["totalBytesExpectedToWrite", "expectedBytes", "totalBytes", "contentLength"]) ??
    pickNum(p, ["totalUnitCount", "totalBytesExpectedToWrite"])

  if (typeof written === "number" && typeof total === "number" && total > 0) {
    return written / total
  }
  return undefined
}

function readBytes(task: any): { received?: number; total?: number } {
  const p = task?.progress
  const received =
    pickNum(task, ["totalBytesWritten", "bytesWritten", "receivedBytes", "completedBytes"]) ??
    pickNum(p, ["completedUnitCount", "totalBytesWritten"])
  const total =
    pickNum(task, ["totalBytesExpectedToWrite", "expectedBytes", "totalBytes", "contentLength"]) ??
    pickNum(p, ["totalUnitCount", "totalBytesExpectedToWrite"])
  return { received, total }
}

// ✅ 统一：单调 + 节流 + 阈值
function makeSmoothOnProgress(onProgress?: (p: DownloadProgress) => void) {
  if (typeof onProgress !== "function") return undefined

  let maxReceived = 0
  let totalLocked: number | undefined
  let maxPercent: number | undefined

  let lastEmitAt = 0
  let lastEmitPercent: number | undefined
  let lastEmitReceived = 0

  function considerTotal(t?: number) {
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return
    if (t < maxReceived) return // 不允许 total < received
    // total 允许更新，但避免抖动：变化>1%才更新
    if (typeof totalLocked !== "number") {
      totalLocked = t
      return
    }
    const old = totalLocked
    if (Math.abs(old - t) > Math.max(1, old * 0.01)) totalLocked = t
  }

  function shouldEmit(now: number, pct?: number, rcv?: number) {
    if (now - lastEmitAt < UI_MIN_INTERVAL_MS) return false

    const dr = typeof rcv === "number" ? rcv - lastEmitReceived : 0
    const dp =
      typeof pct === "number" && typeof lastEmitPercent === "number"
        ? Math.abs(pct - lastEmitPercent)
        : typeof pct === "number" && lastEmitPercent == null
          ? pct
          : 0

    // 百分比足够变化 或 字节有变化
    if (typeof pct === "number" && dp >= UI_MIN_DELTA_PERCENT) return true
    if (dr > 0) return true

    // 兜底：偶尔也刷新一次（防止 UI 长时间不动）
    if (now - lastEmitAt > 1500) return true
    return false
  }

  return (p: DownloadProgress) => {
    // total
    considerTotal(p.total)

    // received 单调不减（防归零/回退）
    const rIn = typeof p.received === "number" && Number.isFinite(p.received) ? p.received : 0
    if (rIn > maxReceived) maxReceived = rIn
    if (rIn === 0 && maxReceived > 0) {
      // ignore
    }

    // percent：优先 received/total；否则用 p.percent
    let pct: number | undefined
    if (typeof totalLocked === "number" && totalLocked > 0) pct = maxReceived / totalLocked
    else if (typeof p.percent === "number" && Number.isFinite(p.percent)) pct = p.percent

    if (typeof pct === "number") {
      pct = Math.max(0, Math.min(1, pct))
      // percent 单调不减（避免 0↔8）
      if (typeof maxPercent === "number" && pct < maxPercent) pct = maxPercent
      maxPercent = pct
    } else if (typeof maxPercent === "number") {
      pct = maxPercent
    }

    const now = Date.now()

    // ✅ 完成强制发 100%（绑定完成与进度）
    if (typeof p.percent === "number" && p.percent >= 1) {
      totalLocked = maxReceived > 0 ? maxReceived : totalLocked
      maxPercent = 1
      lastEmitAt = now
      lastEmitPercent = 1
      lastEmitReceived = maxReceived
      onProgress({ received: maxReceived, total: totalLocked, percent: 1, speedBps: p.speedBps })
      return
    }

    if (!shouldEmit(now, pct, maxReceived)) return

    lastEmitAt = now
    lastEmitPercent = pct
    lastEmitReceived = maxReceived

    onProgress({ received: maxReceived, total: totalLocked, percent: pct, speedBps: p.speedBps })
  }
}

async function downloadWithFetchFallback(
  url: string,
  dstPath: string,
  onProgress?: (p: DownloadProgress) => void
) {
  const fetchFn: any = (globalThis as any).fetch
  if (typeof fetchFn !== "function") throw new Error("fetch 不可用，无法兜底下载")

  const res = await fetchFn(url)
  if (!res?.ok) throw new Error(`下载失败：${res?.status ?? "unknown"}`)

  const totalHeader = res.headers?.get?.("content-length")
  const total = totalHeader ? Number(totalHeader) : undefined
  const fm = (globalThis as any).FileManager
  const Data = (globalThis as any).Data
  const reader = res?.body?.getReader?.()

  const canAppend =
    !!reader &&
    (typeof fm?.appendData === "function" || typeof fm?.appendDataSync === "function") &&
    (Data?.fromUint8Array || Data?.fromArrayBuffer)

  if (!canAppend && (!Number.isFinite(total) || (typeof total === "number" && total > LARGE_FALLBACK_BYTES))) {
    throw new Error("兜底下载已关闭：文件过大或无法获取大小")
  }

  if (fm?.createDirectory) {
    const parent = dirOf(dstPath)
    if (parent) {
      try {
        await fm.createDirectory(parent, true)
      } catch {}
    }
  }

  if (canAppend && reader) {
    await removeFileLoose(dstPath)
    let received = 0
    for (;;) {
      const r = await reader.read()
      if (r?.done) break
      if (!r?.value) continue
      const chunk = r.value instanceof Uint8Array ? r.value : new Uint8Array(r.value)
      const data = Data.fromUint8Array ? Data.fromUint8Array(chunk) : Data.fromArrayBuffer(chunk.buffer)
      if (data) {
        if (typeof fm.appendDataSync === "function") fm.appendDataSync(dstPath, data)
        else await fm.appendData(dstPath, data)
      }
      received += chunk.length
      onProgress?.({
        received,
        total: Number.isFinite(total) ? total : undefined,
        percent: Number.isFinite(total) && total && total > 0 ? received / total : undefined,
      })
    }
    onProgress?.({ received, total: Number.isFinite(total) ? total : undefined, percent: 1 })
    return
  }

  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  if (typeof fm?.writeAsBytes === "function") {
    await fm.writeAsBytes(dstPath, bytes)
  } else {
    const FileEntity = (globalThis as any).FileEntity
    if (FileEntity?.openNewForWriting && (Data?.fromUint8Array || Data?.fromArrayBuffer)) {
      const file = FileEntity.openNewForWriting(dstPath)
      try {
        const data = Data.fromUint8Array ? Data.fromUint8Array(bytes) : Data.fromArrayBuffer(buf)
        if (data) file.write(data)
      } finally {
        try {
          file.close()
        } catch {}
      }
    } else {
      throw new Error("无法写入文件（缺少 FileManager.writeAsBytes 或 FileEntity/Data）")
    }
  }

  onProgress?.({
    received: bytes.length,
    total: Number.isFinite(total) ? total : undefined,
    percent: 1,
  })
}

function attachOnError(task: any, setError: (e: any) => void) {
  if (!task) return
  if ("onError" in task) task.onError = setError
  if ("onFailed" in task) task.onFailed = setError
  if ("onFailure" in task) task.onFailure = setError
}

function attachOnProgress(task: any, onProgress?: (p: DownloadProgress) => void) {
  if (!task || typeof onProgress !== "function") return

  let lastTs = Date.now()
  let lastBytes = 0

  task.onProgress = (d: any) => {
    const received =
      pickNum(d, ["receivedBytes", "bytesWritten", "totalBytesWritten", "completedBytes", "written"]) ?? 0
    const total =
      pickNum(d, ["totalBytes", "expectedBytes", "totalBytesExpected", "totalBytesExpectedToWrite", "contentLength"])

    const now = Date.now()
    const dt = Math.max(1, now - lastTs)
    const db = received - lastBytes
    const speedBps = (db * 1000) / dt

    onProgress({
      received,
      total,
      percent: typeof total === "number" && total > 0 ? received / total : undefined,
      speedBps,
    })

    lastTs = now
    lastBytes = received
  }
}

function startIfNeeded(task: any) {
  try {
    if (typeof task?.resume === "function") task.resume()
  } catch {}
  try {
    if (typeof task?.start === "function") task.start()
  } catch {}
}

export async function downloadWithProgress(
  url: string,
  dstPath: string,
  onProgress?: (p: DownloadProgress) => void,
  onState?: (e: DownloadStateEvent) => void
) {
  const smooth = makeSmoothOnProgress(onProgress)
  return downloadWithProgressInternal(url, dstPath, smooth, onState, 0)
}

async function downloadWithProgressInternal(
  url: string,
  dstPath: string,
  onProgress: ((p: DownloadProgress) => void) | undefined,
  onState: ((e: DownloadStateEvent) => void) | undefined,
  attempt: number
) {
  if (!BackgroundURLSession || typeof BackgroundURLSession.startDownload !== "function") {
    throw new Error("BackgroundURLSession 不可用：无法执行后台落盘下载")
  }

  let hintedTotal: number | undefined
  void fetchContentLength(url).then((n) => (hintedTotal = n)).catch(() => {})

  const task: any = BackgroundURLSession.startDownload({ url, destination: dstPath })
  if (!task || typeof task !== "object") throw new Error("startDownload 未返回有效任务对象")

  const startedAt = Date.now()
  let lastTotal: number | undefined
  let lastBytes = 0
  let lastPercent: number | undefined
  let lastProgressAt = Date.now()
  let lastAnySignalAt = Date.now()
  let completionSince: number | null = null
  let err: any = null

  function emit(p: DownloadProgress) {
    const total = typeof p.total === "number" ? p.total : hintedTotal ?? lastTotal
    if (typeof total === "number") lastTotal = total
    onProgress?.({ ...p, total })
    const r = typeof p.received === "number" ? p.received : 0
    if (r !== lastBytes || p.percent !== lastPercent) {
      lastProgressAt = Date.now()
      lastAnySignalAt = Date.now()
    }
    lastBytes = r
    lastPercent = p.percent
  }

  attachOnProgress(task, emit)
  attachOnError(task, (e) => (err = e))
  startIfNeeded(task)

  for (;;) {
    if (err) throw (err instanceof Error ? err : new Error(String(err?.message ?? err ?? "下载失败")))

    if (task?.isCompleted === true || task?.completed === true || task?.finished === true) {
      const ok = await waitForFile(dstPath, 3000)
      if (!ok) await downloadWithFetchFallback(url, dstPath, onProgress)
      onProgress?.({ received: lastBytes, total: lastTotal ?? hintedTotal, percent: 1 })
      return
    }

    const f = getFraction(task)
    const { received, total } = readBytes(task)
    emit({
      received: typeof received === "number" ? received : lastBytes,
      total: typeof total === "number" ? total : undefined,
      percent: typeof f === "number" ? f : undefined,
    })

    const doneByBytes = typeof lastTotal === "number" && lastTotal > 0 && lastBytes >= lastTotal
    const staleMs = Date.now() - lastProgressAt
    const doneByStale = typeof lastPercent === "number" && lastPercent >= 0.999 && staleMs > 1500

    if (doneByBytes || doneByStale) {
      if (completionSince == null) completionSince = Date.now()
      const ok = await waitForFile(dstPath, 1500)
      if (ok) {
        onProgress?.({ received: lastBytes, total: lastTotal, percent: 1 })
        return
      }
      if (completionSince && Date.now() - completionSince > 6000) {
        await downloadWithFetchFallback(url, dstPath, onProgress)
        onProgress?.({ received: lastBytes, total: lastTotal, percent: 1 })
        return
      }
    } else {
      completionSince = null
    }

    if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
      cancelTask(task)
      if (attempt < MAX_RETRY) {
        onState?.({ type: "retrying", attempt: attempt + 2, maxAttempts: MAX_RETRY + 1 })
        await removeFileLoose(dstPath)
        return downloadWithProgressInternal(url, dstPath, onProgress, onState, attempt + 1)
      }
      throw new Error("下载超时：进度长时间无变化")
    }

    if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
      cancelTask(task)
      throw new Error("下载超时：耗时过长")
    }

    if (Date.now() - lastAnySignalAt > 12000) {
      const ok = await waitForFile(dstPath, 2000)
      if (ok) {
        onProgress?.({ received: lastBytes, total: lastTotal, percent: lastPercent ?? 1 })
        return
      }
      lastAnySignalAt = Date.now()
    }

    await sleep(500)
  }
}