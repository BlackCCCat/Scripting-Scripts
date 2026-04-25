import { Text, VStack, useEffect, useState } from "scripting"
import type { MonitorStatus } from "../types"

function timeText(timestamp = Date.now()): string {
  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  } catch {
    return ""
  }
}

export function PipStatusView(props: {
  status: MonitorStatus
  onStart: () => void
  onStop: () => void
}) {
  const [now, setNow] = useState(Date.now())
  const title = props.status.active ? "CAIS PiP 监听中" : "CAIS PiP 待启动"
  const detail = props.status.lastPreview || props.status.lastMessage || "等待剪贴板变化"

  useEffect(() => {
    const timer = (globalThis as any).setInterval?.(() => setNow(Date.now()), 1000)
    return () => {
      if (timer) (globalThis as any).clearInterval?.(timer)
    }
  }, [])

  return (
    <VStack
      spacing={2}
      frame={{ width: 260, height: 44, alignment: "leading" as any }}
      padding={{ leading: 10, trailing: 10 }}
      onPipStart={props.onStart}
      onPipStop={props.onStop}
      onPipPlayPauseToggle={(isPlaying: boolean) => {
        if (isPlaying) props.onStart()
        else props.onStop()
      }}
      pipHideOnForeground={false}
    >
      <Text font="headline">{title}</Text>
      <Text font="caption" lineLimit={1}>
        {timeText(now)} · {detail}
      </Text>
    </VStack>
  )
}
