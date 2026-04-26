import type { CaptureResult, CaisSettings, MonitorStatus } from "../types"
import { addClipFromPayload } from "../storage/clip_repository"
import { currentChangeCount, readPasteboardPayload } from "./pasteboard_adapter"

export type MonitorListener = (status: MonitorStatus) => void
type MonitorOptions = {
  skipInitialCapture?: boolean
}

let monitorTimer: any = null
let monitorActive = false
let lastChangeCount = -1
let lastMessage = "未启动"
let lastStatus: MonitorStatus = { active: false, lastMessage }
const listeners = new Set<MonitorListener>()

function emit(status: MonitorStatus) {
  lastStatus = status
  for (const listener of listeners) listener(status)
}

export async function captureCurrentClipboard(settings: CaisSettings): Promise<CaptureResult> {
  const payload = await readPasteboardPayload()
  if (!payload) return { status: "skipped", reason: "没有可采集内容" }
  return addClipFromPayload(payload, settings)
}

export function stopClipboardMonitor(listener?: MonitorListener): void {
  const previousListeners = Array.from(listeners)
  monitorActive = false
  listeners.clear()
  if (monitorTimer) {
    clearTimeout(monitorTimer)
    monitorTimer = null
  }
  lastMessage = "监听已停止"
  lastStatus = { active: false, lastMessage, lastCheckedAt: Date.now() }
  for (const previousListener of previousListeners) previousListener(lastStatus)
  if (listener && !previousListeners.includes(listener)) listener(lastStatus)
}

export function startClipboardMonitor(settings: CaisSettings, listener?: MonitorListener, options: MonitorOptions = {}): () => void {
  if (listener) listeners.add(listener)
  if (monitorActive) {
    if (listener) listener(lastStatus)
    return () => {
      if (listener) listeners.delete(listener)
    }
  }
  monitorActive = true
  lastMessage = "监听中"
  emit({ active: true, lastMessage, lastCheckedAt: Date.now() })
  let skipInitialCapture = Boolean(options.skipInitialCapture)
  let firstTick = true

  const tick = async () => {
    if (!monitorActive) return
    const now = Date.now()
    try {
      const current = await currentChangeCount()
      if (skipInitialCapture && firstTick) {
        firstTick = false
        lastChangeCount = current
        emit({ active: true, lastMessage, lastCheckedAt: now })
        return
      }
      firstTick = false
      if (current !== lastChangeCount) {
        lastChangeCount = current
        const result = await captureCurrentClipboard(settings)
        lastMessage =
          result.status === "created" ? `已采集：${result.item.title}` :
          result.status === "updated" ? `已更新：${result.item.title}` :
          result.reason
        emit({
          active: true,
          lastMessage,
          lastCheckedAt: now,
          lastCapturedAt: result.status === "created" || result.status === "updated" ? now : undefined,
        })
      } else {
        emit({ active: true, lastMessage, lastCheckedAt: now })
      }
    } catch (error: any) {
      lastMessage = String(error?.message ?? error ?? "监听失败")
      emit({ active: true, lastMessage, lastCheckedAt: now })
    } finally {
      if (monitorActive) {
        monitorTimer = setTimeout(tick, settings.monitorIntervalMs)
      }
    }
  }

  monitorTimer = setTimeout(tick, 100)
  return () => {
    if (listener) listeners.delete(listener)
    if (!listeners.size) stopClipboardMonitor()
  }
}
