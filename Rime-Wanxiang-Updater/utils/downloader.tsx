// File: utils/downloader.tsx
export type DownloadProgress = {
  percent?: number // 0..1 (fractionCompleted)
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

// 轮询频率（用于兜底轮询 task.progress/bytes）
const POLL_MS = 500

// ✅ 内置日志
const DEBUG_PROGRESS = true
const DEBUG_EVERY_MS = 1000

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx > 0 ? path.slice(0, idx) : ""
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

/**
 * ✅ 兜底：用 fetch 下载并写文件（小文件/可获取大小时）
 */
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

function startIfNeeded(task: any) {
  try {
    if (typeof task?.resume === "function") task.resume()
  } catch {}
  try {
    if (typeof task?.start === "function") task.start()
  } catch {}
}

/**
 * ✅ 从 URLSessionProgress 读取（按文档字段）
 */
function readProgressFromURLSession(task: any): {
  fractionCompleted?: number
  completedUnitCount?: number
  totalUnitCount?: number
  isFinished?: boolean
  estimatedTimeRemaining?: number | null
} {
  const p = task?.progress
  if (!p || typeof p !== "object") return {}
  return {
    fractionCompleted: num(p.fractionCompleted),
    completedUnitCount: num(p.completedUnitCount),
    totalUnitCount: num(p.totalUnitCount),
    isFinished: typeof p.isFinished === "boolean" ? p.isFinished : undefined,
    estimatedTimeRemaining: p.estimatedTimeRemaining == null ? null : (num(p.estimatedTimeRemaining) ?? null),
  }
}

/**
 * 兼容读取 bytes（当 progress 字段不可用时）
 */
function readBytesFallback(task: any): { received?: number; total?: number } {
  const p = task?.progress
  const received =
    pickNum(task, ["totalBytesWritten", "bytesWritten", "receivedBytes", "completedBytes"]) ??
    pickNum(p, ["completedUnitCount", "totalBytesWritten"])
  const total =
    pickNum(task, ["totalBytesExpectedToWrite", "expectedBytes", "totalBytes", "contentLength"]) ??
    pickNum(p, ["totalUnitCount", "totalBytesExpectedToWrite"])
  return { received, total }
}

/**
 * ✅ 核心：累计化 + 不缩小 total + percent 单调 + 真正调用 onProgress
 */
function makeCumulativeEmitter(onProgress?: (p: DownloadProgress) => void) {
  const cb = typeof onProgress === "function" ? onProgress : undefined

  let maxReceived = 0
  let totalLocked: number | undefined
  let maxPercent: number | undefined

  let lastEmitAt = 0
  let lastDbgAt = 0

  function considerTotal(t?: number) {
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return
    // ✅ 不缩小 total：只接受更大的 total 或第一次设置
    if (typeof totalLocked !== "number" || t > totalLocked) totalLocked = t
  }

  function considerReceived(r?: number) {
    if (typeof r !== "number" || !Number.isFinite(r) || r < 0) return
    if (r > maxReceived) maxReceived = r
  }

  function emitCore(p: DownloadProgress, dbg?: any) {
    const now = Date.now()

    // ✅ 节流：避免 UI 刷太频繁
    if (now - lastEmitAt >= 120) {
      lastEmitAt = now
      cb?.(p) // ✅ 关键：把进度回调给 UI
    }

    if (DEBUG_PROGRESS && now - lastDbgAt >= DEBUG_EVERY_MS) {
      lastDbgAt = now
      try {
        console.log("[dl] progress:", {
          percent: p.percent,
          received: p.received,
          total: p.total,
          speedBps: p.speedBps,
          ...dbg,
        })
      } catch {}
    }
  }

  return (raw: {
    frac?: number
    received?: number
    total?: number
    finishedHint?: boolean
    speedBps?: number
    dbg?: any
  }) => {
    considerTotal(raw.total)
    considerReceived(raw.received)

    let pct: number | undefined

    // ✅ percent 优先用 URLSessionProgress.fractionCompleted（权威）
    if (typeof raw.frac === "number" && Number.isFinite(raw.frac)) {
      pct = Math.max(0, Math.min(1, raw.frac))
    } else if (typeof totalLocked === "number" && totalLocked > 0) {
      // 其次用累计 received/total
      pct = maxReceived / totalLocked
    }

    // ✅ percent 单调不回退
    if (typeof pct === "number") {
      if (typeof maxPercent === "number" && pct < maxPercent) pct = maxPercent
      maxPercent = pct
    } else if (typeof maxPercent === "number") {
      pct = maxPercent
    }

    const finished = raw.finishedHint === true || (typeof pct === "number" && pct >= 1)

    if (finished) {
      // ✅ 完成时：percent=1 且 received/total 不缩小
      if (typeof totalLocked === "number" && totalLocked > 0) {
        emitCore({ received: totalLocked, total: totalLocked, percent: 1, speedBps: raw.speedBps }, raw.dbg)
      } else {
        emitCore({ received: maxReceived, total: maxReceived, percent: 1, speedBps: raw.speedBps }, raw.dbg)
      }
      return
    }

    emitCore(
      {
        received: maxReceived,
        total: totalLocked,
        percent: pct,
        speedBps: raw.speedBps,
      },
      raw.dbg
    )
  }
}

export async function downloadWithProgress(
  url: string,
  dstPath: string,
  onProgress?: (p: DownloadProgress) => void,
  onState?: (e: DownloadStateEvent) => void
) {
  const emit = makeCumulativeEmitter(onProgress)
  return downloadWithProgressInternal(url, dstPath, emit, onState, 0)
}

async function downloadWithProgressInternal(
  url: string,
  dstPath: string,
  emit: (raw: any) => void,
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

  if (DEBUG_PROGRESS) {
    try {
      const p = readProgressFromURLSession(task)
      console.log("[dl] task.progress init:", p)
      console.log("[dl] task keys:", Object.keys(task ?? {}))
      console.log("[dl] progress keys:", Object.keys((task?.progress as any) ?? {}))
    } catch {}
  }

  const startedAt = Date.now()
  let lastProgressAt = Date.now()
  let lastAnySignalAt = Date.now()
  let completionSince: number | null = null
  let err: any = null

  attachOnError(task, (e) => (err = e))
  startIfNeeded(task)

  // 速度估算：基于 received 的变化
  let lastSpeedTs = Date.now()
  let lastSpeedBytes = 0

  // 进度变化判断（不要复用 lastSpeedBytes）
  let lastObservedReceived = 0
  let lastObservedFrac = 0

  for (;;) {
    if (err) throw (err instanceof Error ? err : new Error(String(err?.message ?? err ?? "下载失败")))

    const pr = readProgressFromURLSession(task)
    const fb = readBytesFallback(task)

    const total = pr.totalUnitCount ?? fb.total ?? hintedTotal
    const received = pr.completedUnitCount ?? fb.received
    const frac = pr.fractionCompleted

    const now = Date.now()

    // 速度
    let speedBps: number | undefined
    if (typeof received === "number") {
      const dt = Math.max(1, now - lastSpeedTs)
      const db = received - lastSpeedBytes
      speedBps = (db * 1000) / dt
      lastSpeedTs = now
      lastSpeedBytes = received
    }

    // 推送（累计化 + 不缩小 total）
    emit({
      frac,
      received,
      total,
      speedBps,
      finishedHint: pr.isFinished === true,
      dbg: DEBUG_PROGRESS
        ? {
            _urlSessionProgress: {
              fractionCompleted: pr.fractionCompleted,
              completedUnitCount: pr.completedUnitCount,
              totalUnitCount: pr.totalUnitCount,
              isFinished: pr.isFinished,
              estimatedTimeRemaining: pr.estimatedTimeRemaining,
            },
          }
        : undefined,
    })

    // “有信号”就刷新
    const hasSignal =
      (typeof received === "number" && received > 0) ||
      (typeof frac === "number" && frac > 0) ||
      (typeof total === "number" && total > 0)
    if (hasSignal) lastAnySignalAt = now

    // ✅ 只要 received 或 frac 有增长，就认为“有进度”
    let progressed = false
    if (typeof received === "number" && received > lastObservedReceived) {
      lastObservedReceived = received
      progressed = true
    }
    if (typeof frac === "number" && frac > lastObservedFrac) {
      lastObservedFrac = frac
      progressed = true
    }
    if (progressed) lastProgressAt = now

    // 完成标记（兼容）
    const completed =
      task?.isCompleted === true ||
      task?.completed === true ||
      task?.finished === true ||
      pr.isFinished === true

    if (completed) {
      const ok = await waitForFile(dstPath, 3000)
      if (!ok) {
        await downloadWithFetchFallback(url, dstPath, (p) => {
          emit({
            frac: p.percent,
            received: p.received,
            total: p.total,
            speedBps: p.speedBps,
            finishedHint: p.percent === 1,
          })
        })
      }
      emit({ frac: 1, received: total, total, finishedHint: true })
      return
    }

    // 看似完成：确认文件后退出
    const doneByFrac = typeof frac === "number" && frac >= 0.999
    const doneByBytes = typeof total === "number" && total > 0 && typeof received === "number" && received >= total

    if (doneByFrac || doneByBytes) {
      if (completionSince == null) completionSince = now
      const ok = await waitForFile(dstPath, 1500)
      if (ok) {
        emit({ frac: 1, received: total, total, finishedHint: true })
        return
      }
      if (completionSince && now - completionSince > 6000) {
        await downloadWithFetchFallback(url, dstPath, (p) => {
          emit({
            frac: p.percent,
            received: p.received,
            total: p.total,
            speedBps: p.speedBps,
            finishedHint: p.percent === 1,
          })
        })
        emit({ frac: 1, received: total, total, finishedHint: true })
        return
      }
    } else {
      completionSince = null
    }

    // stall 超时：重试
    if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
      cancelTask(task)
      if (attempt < MAX_RETRY) {
        onState?.({ type: "retrying", attempt: attempt + 2, maxAttempts: MAX_RETRY + 1 })
        await removeFileLoose(dstPath)
        return downloadWithProgressInternal(url, dstPath, emit, onState, attempt + 1)
      }
      throw new Error("下载超时：进度长时间无变化")
    }

    // 总耗时超限
    if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
      cancelTask(task)
      throw new Error("下载超时：耗时过长")
    }

    // 无信号兜底：若文件已出现也可退出
    if (Date.now() - lastAnySignalAt > 12000) {
      const ok = await waitForFile(dstPath, 2000)
      if (ok) {
        emit({ frac: 1, received: total, total, finishedHint: true })
        return
      }
      lastAnySignalAt = Date.now()
    }

    await sleep(POLL_MS)
  }
}