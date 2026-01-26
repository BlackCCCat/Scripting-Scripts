// File: utils/downloader.tsx
export type DownloadProgress = {
  percent?: number
  received: number
  total?: number
  speedBps?: number
}

declare const BackgroundURLSession: any

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx > 0 ? path.slice(0, idx) : ""
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

  if (fm?.createDirectory) {
    const parent = dirOf(dstPath)
    if (parent) {
      try {
        await fm.createDirectory(parent, true)
      } catch {}
    }
  }

  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  if (typeof fm?.writeAsBytes === "function") {
    await fm.writeAsBytes(dstPath, bytes)
  } else {
    const Data = (globalThis as any).Data
    const FileEntity = (globalThis as any).FileEntity
    if (FileEntity?.openNewForWriting && (Data?.fromUint8Array || Data?.fromArrayBuffer)) {
      const file = FileEntity.openNewForWriting(dstPath)
      try {
        const data = Data.fromUint8Array ? Data.fromUint8Array(bytes) : Data.fromArrayBuffer(buf)
        if (data) file.write(data)
      } finally {
        try { file.close() } catch {}
      }
    } else {
      throw new Error("无法写入文件（缺少 FileManager.writeAsBytes 或 FileEntity/Data）")
    }
  }

  onProgress?.({
    received: bytes.length,
    total: Number.isFinite(total) ? total : undefined,
    percent: Number.isFinite(total) && total && total > 0 ? bytes.length / total : 1,
  })
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

  // 1) HEAD 优先
  try {
    const res = await fetchFn(url, { method: "HEAD" })
    const len = res?.headers?.get?.("content-length")
    const n = len != null ? Number(len) : NaN
    if (Number.isFinite(n) && n > 0) return n
  } catch {}

  // 2) Range 兜底（部分服务器不允许 HEAD）
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
  // 兼容各种字段：progress.fractionCompleted / fractionCompleted / progressPercent 等
  const p = task?.progress
  const f1 = num(p?.fractionCompleted)
  if (f1 !== undefined) return f1

  const f2 = num(task?.fractionCompleted)
  if (f2 !== undefined) return f2

  const f3 = num(task?.progressPercent)
  if (f3 !== undefined) return f3 > 1 ? f3 / 100 : f3

  // 有些只有已写/总量
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

function attachOnError(task: any, setError: (e: any) => void) {
  if (!task) return
  // 尽量兼容各种命名
  if ("onError" in task) task.onError = setError
  if ("onFailed" in task) task.onFailed = setError
  if ("onFailure" in task) task.onFailure = setError
}

function startIfNeeded(task: any) {
  // 有些实现需要手动 resume/start
  try {
    if (typeof task?.resume === "function") task.resume()
  } catch {}
  try {
    if (typeof task?.start === "function") task.start()
  } catch {}
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

/**
 * ✅ 系统下载到 dstPath（不需要 FileManager.write*）
 * 通过轮询 task 的 progress/state 来等待完成，避免“卡在 2% 永远不结束”。
 */
export async function downloadWithProgress(
  url: string,
  dstPath: string,
  onProgress?: (p: DownloadProgress) => void
) {
  if (!BackgroundURLSession || typeof BackgroundURLSession.startDownload !== "function") {
    throw new Error("BackgroundURLSession 不可用：无法执行后台落盘下载")
  }

  let hintedTotal: number | undefined
  void fetchContentLength(url).then((n) => (hintedTotal = n)).catch(() => {})

  const task: any = BackgroundURLSession.startDownload({
    url,
    destination: dstPath,
  })

  if (!task || typeof task !== "object") {
    throw new Error("startDownload 未返回有效任务对象")
  }

  let lastTs = Date.now()
  let lastBytes = 0
  let lastPercent: number | undefined
  let lastTotal: number | undefined
  let lastProgressAt = Date.now()
  let lastAnySignalAt = Date.now()
  let completionSince: number | null = null
  let err: any = null

  function emitProgress(p: DownloadProgress) {
    let received = typeof p.received === "number" ? p.received : 0
    let total = typeof p.total === "number" ? p.total : hintedTotal ?? lastTotal

    if (typeof total === "number") lastTotal = total
    if (!Number.isFinite(received)) received = 0
    if (received < lastBytes) received = lastBytes
    if (received !== lastBytes) lastProgressAt = Date.now()
    lastBytes = received

    let percent = p.percent
    if (typeof percent !== "number" && typeof total === "number" && total > 0) {
      percent = received / total
    }
    if (typeof percent === "number") {
      percent = Math.max(0, Math.min(1, percent))
      if (typeof lastPercent === "number" && percent < lastPercent) percent = lastPercent
      if (percent !== lastPercent) lastProgressAt = Date.now()
      lastPercent = percent
    }

    lastAnySignalAt = Date.now()
    onProgress?.({
      received,
      total,
      percent,
      speedBps: p.speedBps,
    })
  }

  attachOnProgress(task, emitProgress)
  attachOnError(task, (e) => (err = e))
  startIfNeeded(task)

  // 主动轮询：即使 onProgress 不再触发，也能推进 UI 并最终退出
  for (;;) {
    if (err) {
      throw (err instanceof Error ? err : new Error(String(err?.message ?? err ?? "下载失败")))
    }

    // 某些实现会有完成标记
    if (task?.isCompleted === true || task?.completed === true || task?.finished === true) {
      const ok = await waitForFile(dstPath, 3000)
      if (!ok) {
        await downloadWithFetchFallback(url, dstPath, onProgress)
      }
      emitProgress({ received: lastBytes, total: lastTotal, percent: 1 })
      return
    }

    const f = getFraction(task)
    const { received, total } = readBytes(task)

    // 计算速度（尽力）
    const now = Date.now()
    const dt = Math.max(1, now - lastTs)
    const rcv = typeof received === "number" ? received : lastBytes
    const db = rcv - lastBytes
    const speedBps = (db * 1000) / dt

    if (typeof f === "number" || typeof received === "number") {
      emitProgress({
        received: typeof received === "number" ? received : lastBytes,
        total,
        percent: typeof f === "number" ? f : undefined,
        speedBps,
      })
    } else if (typeof lastPercent === "number") {
      emitProgress({ received: lastBytes, total: lastTotal, percent: lastPercent, speedBps })
    }

    lastTs = now

    const doneByBytes = typeof lastTotal === "number" && lastTotal > 0 && lastBytes >= lastTotal
    const staleMs = Date.now() - lastProgressAt
    const doneByStale = typeof lastPercent === "number" && lastPercent >= 0.999 && staleMs > 1500
    if (doneByBytes || doneByStale) {
      if (completionSince == null) completionSince = Date.now()
      const ok = await waitForFile(dstPath, 1500)
      if (ok) {
        emitProgress({ received: lastBytes, total: lastTotal, percent: 1 })
        return
      }
      if (completionSince && Date.now() - completionSince > 6000) {
        // 无法确认文件存在时，尝试兜底下载
        await downloadWithFetchFallback(url, dstPath, onProgress)
        emitProgress({ received: lastBytes, total: lastTotal, percent: 1 })
        return
      }
    } else {
      completionSince = null
    }

    // 兜底：若长时间没有任何信号但文件已存在，避免卡死
    if (Date.now() - lastAnySignalAt > 12000) {
      const ok = await waitForFile(dstPath, 2000)
      if (ok) {
        emitProgress({ received: lastBytes, total: lastTotal, percent: lastPercent ?? 1 })
        return
      }
      lastAnySignalAt = Date.now()
    }

    await sleep(500)
  }
}
