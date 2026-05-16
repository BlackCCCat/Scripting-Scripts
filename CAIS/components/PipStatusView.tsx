import { Device, HStack, Image, Text, VStack, useEffect, useObservable } from "scripting"
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
  const started = useObservable(false)
  const now = useObservable(Date.now())
  const active = props.status.active || started.value
  const capturedCount = props.status.capturedCount ?? 0
  const title = active ? "PiP 监听中" : "PiP 待启动"
  const detail = active ? `已复制 ${capturedCount} 条` : "等待启动"

  useEffect(() => {
    if (!started.value && !props.status.active) return
    let timerId: number

    function startTimer() {
      timerId = (globalThis as any).setTimeout?.(() => {
        now.setValue(Date.now())
        startTimer()
      }, 1000)
    }

    startTimer()

    return () => {
      if (timerId) (globalThis as any).clearTimeout?.(timerId)
    }
  }, [started.value, props.status.active])

  return (
    <HStack
      spacing={8}
      frame={{ width: Device.screen.width, height: 50, alignment: "leading" as any }}
      padding={{ leading: 12, trailing: 12 }}
      onPipStart={() => {
        started.setValue(true)
        props.onStart()
      }}
      onPipStop={() => {
        started.setValue(false)
        props.onStop()
      }}
      pipHideOnForeground={false}
    >
      <Image
        systemName="doc.on.clipboard"
        font="title3"
        foregroundStyle="white"
      />
      <VStack spacing={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <Text
          font="caption"
          foregroundStyle="white"
          lineLimit={1}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          multilineTextAlignment="leading"
        >
          {timeText(now.value)} · {title}
        </Text>
        <Text
          font="headline"
          foregroundStyle="white"
          lineLimit={1}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          multilineTextAlignment="leading"
        >
          {detail}
        </Text>
      </VStack>
    </HStack>
  )
}
