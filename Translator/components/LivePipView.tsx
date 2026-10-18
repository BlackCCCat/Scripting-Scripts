import { EmptyView, GeometryReader, Text, VStack, useEffect, useObservable, useRef, useState } from "scripting"
import { LIVE_PIP_SIZES } from "../utils/live_translation"

function TextHeightObserver(props: {
  height: number
  text: string
  width: number
  onChange: (height: number, text: string, width: number) => void
}) {
  useEffect(() => props.onChange(props.height, props.text, props.width), [props.height, props.text, props.width])
  return <EmptyView />
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
  const [measuredText, setMeasuredText] = useState({ text: "", width: 0, height: 0 })
  const size = LIVE_PIP_SIZES[props.sizeIndex] ?? LIVE_PIP_SIZES[3]
  const text = props.text.value
  const width = Math.min(size.width, Device.screen.width - 40)
  const height = Math.round(size.height * width / size.width)
  const contentWidth = width - 20
  const contentHeight = height - 20
  const textHeight = measuredText.text === text && measuredText.width === contentWidth
    ? measuredText.height
    : 0
  const maxScroll = Math.max(0, textHeight - contentHeight)
  const maxScrollRef = useRef(maxScroll)
  const previousTextRef = useRef(text)
  maxScrollRef.current = maxScroll

  useEffect(() => {
    if (!text.startsWith(previousTextRef.current)) setScrollY(0)
    previousTextRef.current = text
  }, [text])

  useEffect(() => {
    if (textHeight > 0) setScrollY((current) => Math.min(current, maxScroll))
  }, [textHeight, maxScroll])

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
        background={
          <GeometryReader>
            {(proxy) => (
              <TextHeightObserver
                height={proxy.size.height}
                text={text}
                width={contentWidth}
                onChange={(value, measuredValue, measuredWidth) => setMeasuredText({
                  text: measuredValue,
                  width: measuredWidth,
                  height: value,
                })}
              />
            )}
          </GeometryReader>
        }
        offset={{ x: 10, y: 10 - scrollY }}
      >
        {text}
      </Text>
    </VStack>
  )
}
