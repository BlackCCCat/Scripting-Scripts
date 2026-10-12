import { Text, VStack, useEffect, useMemo, useObservable, useRef, useState } from "scripting"
import { LIVE_PIP_SIZES } from "../utils/live_translation"

function estimateLineCount(text: string, maxUnits: number) {
  let count = 0
  for (const paragraph of text.split(/\r?\n/)) {
    let units = 0
    for (const character of paragraph) {
      const nextUnits = /[^\u0000-\u00ff]/.test(character) ? 2 : 1
      if (units && units + nextUnits > maxUnits) {
        count += 1
        units = 0
      }
      units += nextUnits
    }
    count += 1
  }
  return count
}

export function LivePipView(props: {
  text: ReturnType<typeof useObservable<string>>
  sizeIndex: number
  colorScheme: "light" | "dark"
  onStart: () => void
  onStop: () => void
  onClipboardTick: () => void
}) {
  const [started, setStarted] = useState(false)
  const [scrollY, setScrollY] = useState(0)
  const size = LIVE_PIP_SIZES[props.sizeIndex] ?? LIVE_PIP_SIZES[3]
  const text = props.text.value
  const width = Math.min(size.width, Device.screen.width - 40)
  const height = Math.round(size.height * width / size.width)
  const contentWidth = width - 20
  const contentHeight = height - 20
  const lineCount = useMemo(
    () => estimateLineCount(text, Math.max(8, Math.floor(contentWidth / 8.5))),
    [text, contentWidth],
  )
  const maxScroll = Math.max(0, lineCount * 23 - contentHeight + 8)
  const maxScrollRef = useRef(maxScroll)
  const previousTextRef = useRef(text)
  maxScrollRef.current = maxScroll

  useEffect(() => {
    if (!text.startsWith(previousTextRef.current)) setScrollY(0)
    previousTextRef.current = text
  }, [text])

  useEffect(() => {
    if (!started) return
    let timer: number
    function advance() {
      timer = setTimeout(() => {
        if (maxScrollRef.current > 0) {
          setScrollY((current) => Math.min(current + 1.4, maxScrollRef.current))
        }
        advance()
      }, 100)
    }
    advance()
    return () => clearTimeout(timer)
  }, [started])

  useEffect(() => {
    if (!started) return
    let timer: number
    function checkClipboard() {
      props.onClipboardTick()
      timer = setTimeout(checkClipboard, 900)
    }
    timer = setTimeout(checkClipboard, 900)
    return () => clearTimeout(timer)
  }, [started])

  return (
    <VStack
      frame={{ width, height, alignment: "topLeading" }}
      clipped
      environments={{ colorScheme: props.colorScheme }}
      background={props.colorScheme === "dark" ? "black" : "white"}
      onPipStart={() => {
        console.log("[Translator] PiP 窗口已启动")
        setStarted(true)
        props.onStart()
      }}
      onPipStop={() => {
        console.log("[Translator] PiP 窗口已关闭")
        setStarted(false)
        props.onStop()
      }}
      pipHideOnForeground={false}
    >
      <Text
        font="body"
        foregroundStyle={props.colorScheme === "dark" ? "white" : "black"}
        multilineTextAlignment="leading"
        frame={{ width: contentWidth, alignment: "topLeading" }}
        fixedSize={{ horizontal: false, vertical: true }}
        offset={{ x: 10, y: 10 - scrollY }}
      >
        {text}
      </Text>
    </VStack>
  )
}
