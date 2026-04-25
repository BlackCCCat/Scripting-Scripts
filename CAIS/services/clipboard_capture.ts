import type { CaptureResult, CaisSettings, MonitorStatus } from "../types"
import { addClipFromPayload, cleanupDeleted } from "../storage/clip_repository"
import { currentChangeCount, readPasteboardPayload } from "./pasteboard_adapter"

export type MonitorListener = (status: MonitorStatus) => void

let monitorTimer: any = null
let monitorActive = false
let lastChangeCount = -1
let lastMessage = "未启动"

function previewItem(result: CaptureResult): string | undefined {
  if (result.status === "skipped") return undefined
  if (result.item.kind === "image") return result.item.title
  return result.item.content.length > 80
    ? `${result.item.content.slice(0, 80)}...`
    : result.item.content
}

export async function captureCurrentClipboard(settings: CaisSettings): Promise<CaptureResult> {
  const payload = await readPasteboardPayload()
  if (!payload) return { status: "skipped", reason: "没有可采集内容" }
  return addClipFromPayload(payload, settings)
}

export function isMonitorActive(): boolean {
  return monitorActive
}

export function stopClipboardMonitor(listener?: MonitorListener): void {
  monitorActive = false
  if (monitorTimer) {
    clearTimeout(monitorTimer)
    monitorTimer = null
  }
  lastMessage = "监听已停止"
  listener?.({ active: false, lastMessage, lastCheckedAt: Date.now() })
}

export function startClipboardMonitor(settings: CaisSettings, listener?: MonitorListener): () => void {
  if (monitorActive) return () => {}
  monitorActive = true
  lastMessage = "监听中"
  listener?.({ active: true, lastMessage, lastCheckedAt: Date.now() })

  const tick = async () => {
    if (!monitorActive) return
    const now = Date.now()
    try {
      const current = await currentChangeCount()
      if (current !== lastChangeCount) {
        lastChangeCount = current
        const result = await captureCurrentClipboard(settings)
        lastMessage =
          result.status === "created" ? `已采集：${result.item.title}` :
          result.status === "updated" ? `已更新：${result.item.title}` :
          result.reason
        const lastPreview = previewItem(result)
        listener?.({
          active: true,
          lastMessage,
          lastPreview,
          lastCheckedAt: now,
          lastCapturedAt: result.status === "created" || result.status === "updated" ? now : undefined,
        })
      } else {
        listener?.({ active: true, lastMessage, lastCheckedAt: now })
      }
      await cleanupDeleted(settings)
    } catch (error: any) {
      lastMessage = String(error?.message ?? error ?? "监听失败")
      listener?.({ active: true, lastMessage, lastCheckedAt: now })
    } finally {
      if (monitorActive) {
        monitorTimer = setTimeout(tick, settings.monitorIntervalMs)
      }
    }
  }

  monitorTimer = setTimeout(tick, 100)
  return () => stopClipboardMonitor(listener)
}
