import {
  Button,
  Canvas,
  Divider,
  EmptyView,
  HStack,
  Image,
  ProgressView,
  Rectangle,
  ScrollView,
  ScrollViewReader,
  Script,
  Spacer,
  Text,
  TimelineCanvas,
  VStack,
  gradient,
  useEffect,
  useRef,
  useState,
  type Color,
  type CommonViewProps,
  type VirtualNode,
} from "scripting"
import type { DownloadMediaInfo, DownloadProgress } from "../services/douyin"
import type { LanguageMode } from "../services/preferences"
import { formatBytes, formatEta } from "../utils/common"
import { getI18n, localizeRuntimeText } from "../utils/i18n"

export const supportsDownloadGlass = Number.parseInt(Device.systemVersion, 10) >= 26 && typeof UIGlass !== "undefined"
export const downloadAccent = Script.metadata?.color ?? "systemBlue"
const supportsNumericTransition = Number.parseInt(Device.systemVersion, 10) >= 17
const cardShape = { type: "rect", cornerRadius: 8, style: "continuous" } as const
const thumbnailShape = { type: "rect", cornerRadius: 7 } as const
const cardSecondary = "#D1DEEE"

export function DownloadBackdrop() {
  return (
    <Rectangle
      fill="systemGroupedBackground"
      ignoresSafeArea={{ regions: "container", edges: ["top", "bottom"] }}
      allowsHitTesting={false}
    />
  )
}

export function DownloadCardRow(props: { children: VirtualNode } & Pick<CommonViewProps, "onTapGesture" | "trailingSwipeActions">) {
  return (
    <VStack
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      listRowInsets={{ leading: 16, trailing: 16, top: 6, bottom: 6 }}
      listRowBackground={<EmptyView />}
      listRowSeparator="hidden"
      contentShape={props.onTapGesture ? "rect" : undefined}
      onTapGesture={props.onTapGesture}
      trailingSwipeActions={props.trailingSwipeActions}
    >
      {props.children}
    </VStack>
  )
}

export function DownloadPanel(props: { children?: VirtualNode | (VirtualNode | null | undefined)[] }) {
  return (
    <VStack
      alignment="leading"
      spacing={12}
      padding={14}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      glassEffect={supportsDownloadGlass ? { glass: UIGlass.regular(), shape: cardShape } : undefined}
      background={supportsDownloadGlass ? undefined : { style: "regularMaterial", shape: cardShape }}
    >
      {props.children}
    </VStack>
  )
}

export function DownloadLogCard(props: {
  logs: readonly string[]
  language: LanguageMode
  status: string
  active: boolean
  onCopy: () => void
}) {
  const t = getI18n(props.language)
  const proxyRef = useRef<{ scrollTo: (id: string, anchor: "bottom") => void } | null>(null)
  useEffect(() => {
    if (!props.logs.length) return
    const scroll = () => {
      try { proxyRef.current?.scrollTo("latest-download-log", "bottom") } catch {}
    }
    scroll()
    const timer = setTimeout(scroll, 120)
    return () => clearTimeout(timer)
  }, [props.logs])

  return (
    <DownloadPanel>
      <HStack spacing={8}>
        <VStack alignment="leading" spacing={3}>
          <Text font="headline" accessibilityAddTraits="isHeader">{t.downloadLog}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{t.sessionLog}</Text>
        </VStack>
        <Spacer />
        <DownloadIconButton symbol="doc.on.doc" label={t.copyLogs} action={props.onCopy} />
      </HStack>
      <Divider />
      <ScrollViewReader>
        {(proxy) => {
          proxyRef.current = proxy
          return (
            <ScrollView frame={{ height: 176, maxWidth: "infinity", alignment: "topLeading" }}>
              <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                {props.logs.length === 0 ? <Text font="caption" foregroundStyle="secondaryLabel">{t.noLogs}</Text> : null}
                {props.logs.map((log, index) => {
                  const line = localizeRuntimeText(log, props.language)
                  const timestamp = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/)
                  return (
                    <HStack key={`${index}-${log}`} alignment="top" spacing={8}>
                      <Image systemName="chevron.right" font={10} foregroundStyle={downloadAccent} />
                      {timestamp ? <Text font="caption2" monospacedDigit foregroundStyle="secondaryLabel">{timestamp[1]}</Text> : null}
                      <Text font="caption" frame={{ maxWidth: "infinity", alignment: "leading" }}>{timestamp ? line.slice(timestamp[0].length) : line}</Text>
                    </HStack>
                  )
                })}
                <Rectangle key="latest-download-log" foregroundStyle="clear" frame={{ height: 1 }} />
              </VStack>
            </ScrollView>
          )
        }}
      </ScrollViewReader>
      <Divider />
      <HStack spacing={7}>
        <Image systemName="circle.fill" font={7} foregroundStyle={props.active ? downloadAccent : "secondaryLabel"} />
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {localizeRuntimeText(props.status, props.language)}
        </Text>
      </HStack>
    </DownloadPanel>
  )
}

export function DownloadIconButton(props: {
  symbol: string
  label: string
  action: () => void
  large?: boolean
  disabled?: boolean
}) {
  return (
    <Button
      action={props.action}
      accessibilityLabel={props.label}
      disabled={props.disabled}
      buttonBorderShape="circle"
      buttonStyle={props.large ? "plain" : supportsDownloadGlass ? "glass" : "bordered"}
      glassEffect={props.large && supportsDownloadGlass ? { glass: UIGlass.regular().interactive(), shape: "circle" } : undefined}
      background={props.large && !supportsDownloadGlass ? { style: "regularMaterial", shape: "circle" } : undefined}
      tint={downloadAccent}
    >
      <Image
        systemName={props.symbol}
        font={props.large ? 24 : 17}
        fontWeight="semibold"
        frame={props.large ? { width: 56, height: 56 } : { minWidth: 24, minHeight: 30 }}
        foregroundStyle={props.large ? downloadAccent : undefined}
        contentTransition={supportsNumericTransition ? "symbolEffectReplace" : undefined}
        animation={{ animation: Animation.easeOut(0.2), value: props.symbol }}
      />
    </Button>
  )
}

type Artwork = { url: string; image: UIImage; color?: RGBAColor }

function TransferSignal() {
  const frame = { width: 102, height: 42 }
  const draw: Parameters<typeof TimelineCanvas>[0]["draw"] = (ctx, { width, height }, time) => {
    const count = 18
    const step = width / count
    ctx.fillStyle = downloadAccent
    for (let i = 0; i < count; i++) {
      const envelope = 0.28 + 0.42 * Math.sin(i * 0.37) ** 2
      const pulse = 0.45 + 0.55 * (Math.sin(i * 0.62 - time * 5) + 1) / 2
      const barHeight = Math.max(4, envelope * pulse * height)
      ctx.fillRect(i * step, height - barHeight, Math.max(1, step - 2), barHeight)
    }
  }
  return typeof TimelineCanvas === "function" ? (
    <TimelineCanvas frame={frame} schedule={{ minimumInterval: 1 / 24 }} opaque={false} accessibilityHidden draw={draw} />
  ) : (
    <Canvas frame={frame} opaque={false} accessibilityHidden draw={(ctx, size) => draw(ctx, size, 0)} />
  )
}

function artworkGradient(color?: RGBAColor) {
  function tint(strength: number): Color {
    const rgb = [color?.red ?? 30 / 255, color?.green ?? 144 / 255, color?.blue ?? 1]
    const channels = rgb.map((channel) => Math.round(12 + channel * strength * 255)).join(",")
    return `rgba(${channels},1)` as Color
  }
  return gradient("linear", {
    colors: [tint(0.38), tint(0.25), tint(0.13)],
    startPoint: "topLeading",
    endPoint: "bottomTrailing",
  })
}

function TransferMetric(props: { label: string; value: string }) {
  return (
    <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="caption2" foregroundStyle={cardSecondary}>{props.label}</Text>
      <Text font="caption" fontWeight="semibold" monospacedDigit foregroundStyle="white">{props.value}</Text>
    </VStack>
  )
}

export function DownloadTaskCard(props: {
  media: DownloadMediaInfo | null
  progress?: DownloadProgress
  titleFallback?: string
  status: string
  language: LanguageMode
  phase: "idle" | "active" | "done" | "error" | "cancelled"
  onCopyStatus?: () => void
}) {
  const t = getI18n(props.language)
  const thumbnailURL = props.media?.thumbnailURL
  const [artwork, setArtwork] = useState<Artwork | null>(null)
  useEffect(() => {
    if (!thumbnailURL || !/^https?:\/\//i.test(thumbnailURL)) return
    let active = true
    void (async () => {
      try {
        const image = await UIImage.fromURL(thumbnailURL)
        if (!active || !image) return
        const thumbnail = image.preparingThumbnail({ width: 384, height: 216 }) ?? image
        let palette: DominantColor[] = []
        try { palette = thumbnail.dominantColors?.(5) ?? [] } catch {}
        const visibleColors = palette.filter(({ color }) => color.alpha >= 0.6)
        const color = visibleColors.find(({ color }) => {
          const { red, green, blue } = color
          return Math.max(red, green, blue) - Math.min(red, green, blue) >= 0.12
        })?.color ?? visibleColors[0]?.color
        setArtwork({ url: thumbnailURL, image: thumbnail, color })
      } catch {
        // The task can run even when a CDN rejects the cover request.
      }
    })()
    return () => { active = false }
  }, [thumbnailURL])

  const cover = artwork?.url === thumbnailURL ? artwork : null
  const progress = props.phase === "active" ? props.progress : undefined
  const fraction = progress?.transferFraction
  const percent = fraction == null ? null : Math.round(fraction * 100)
  const metrics = progress?.transfer
  const eta = formatEta(metrics?.eta)
  const status = localizeRuntimeText(props.status, props.language)
  const displayStatus = metrics && fraction !== undefined ? status.split(" · ")[0] : status
  const symbol = props.phase === "done" ? "checkmark.circle.fill"
    : props.phase === "error" ? "exclamationmark.circle.fill"
    : props.phase === "cancelled" ? "stop.circle"
    : fraction !== undefined ? "arrow.down.circle.fill"
    : props.phase === "active" ? "ellipsis.circle" : "link"
  const signalColor = props.phase === "error" ? "#FFC0BA" : "white"
  const badge = fraction !== undefined ? t.transferring
    : props.phase === "done" ? t.downloadSuccess
    : props.phase === "error" ? t.downloadFailed
    : props.phase === "cancelled" ? t.canceled : null

  return (
    <VStack
      spacing={0}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={{ style: artworkGradient(cover?.color), shape: cardShape }}
      clipShape={cardShape}
      environments={{ colorScheme: "dark" }}
    >
      <VStack
        alignment="leading"
        spacing={13}
        padding={16}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        glassEffect={supportsDownloadGlass ? { glass: UIGlass.clear(), shape: cardShape } : undefined}
        foregroundStyle="white"
        onTapGesture={props.onCopyStatus}
        accessibilityHint={props.onCopyStatus ? t.copyStatus : undefined}
      >
        <HStack spacing={7}>
          <Image systemName="waveform.path" foregroundStyle={signalColor} font="subheadline" />
          <Text font="subheadline" fontWeight="semibold">{t.currentTask}</Text>
          <Spacer />
          {badge ? <Text font="caption" foregroundStyle={signalColor}>{badge}</Text> : null}
          <Image
            systemName={symbol}
            foregroundStyle={signalColor}
            font="title3"
            contentTransition={supportsNumericTransition ? "symbolEffectReplace" : undefined}
            animation={{ animation: Animation.easeOut(0.22), value: symbol }}
          />
        </HStack>

        {props.media?.title || cover || props.media?.detail ? (
          <HStack spacing={11}>
            <VStack
              frame={{ width: 76, height: 48 }}
              background={{ style: "#FFFFFF18", shape: thumbnailShape }}
              clipShape={thumbnailShape}
            >
              {cover ? (
                <Image image={cover.image} resizable scaleToFit frame={{ width: 76, height: 48 }} />
              ) : (
                <Image systemName="play.rectangle" foregroundStyle={cardSecondary} />
              )}
            </VStack>
            <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {props.media?.title ? <Text font="headline" lineLimit={2}>{props.media.title}</Text> : null}
              {props.media?.detail ? <Text font="caption" foregroundStyle={cardSecondary} lineLimit={2}>{props.media.detail}</Text> : null}
            </VStack>
          </HStack>
        ) : props.titleFallback ? (
          <Text font="caption" foregroundStyle={cardSecondary} lineLimit={2}>{props.titleFallback}</Text>
        ) : null}

        <Divider />
        {fraction !== undefined ? (
          <VStack alignment="leading" spacing={9} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font="caption" foregroundStyle={cardSecondary}>{t.progress}</Text>
            <HStack alignment="bottom" spacing={3}>
              {percent == null ? (
                <Text font="title2" fontWeight="semibold" lineLimit={1} minScaleFactor={0.65}>{t.transferring}</Text>
              ) : (
                <>
                  <Text
                    font={52}
                    fontWeight="bold"
                    monospacedDigit
                    contentTransition={supportsNumericTransition ? "numericTextCountsUp" : undefined}
                    animation={{ animation: Animation.easeOut(0.22), value: percent }}
                  >{String(percent)}</Text>
                  <Text font="title2" fontWeight="semibold" foregroundStyle={cardSecondary}>%</Text>
                </>
              )}
              <Spacer />
              <TransferSignal />
            </HStack>
            <ProgressView
              value={fraction ?? undefined}
              total={1}
              tint={downloadAccent}
              progressViewStyle="linear"
              animation={{ animation: Animation.linear(0.22), value: fraction ?? -1 }}
              accessibilityLabel={t.progress}
            />
            {metrics ? (
              <HStack alignment="top" spacing={8}>
                <TransferMetric label={t.transferred} value={formatBytes(metrics.bytes) + (metrics.total ? ` / ${formatBytes(metrics.total)}` : "")} />
                {metrics.speed ? <TransferMetric label={t.transferSpeed} value={`${formatBytes(metrics.speed)}/s`} /> : null}
                {eta ? <TransferMetric label={t.transferEta} value={eta} /> : null}
              </HStack>
            ) : null}
            <Text font="caption" foregroundStyle={cardSecondary}>{displayStatus}</Text>
          </VStack>
        ) : (
          <Text
            font={props.phase === "error" || props.phase === "done" ? "subheadline" : "headline"}
            lineLimit={props.phase === "error" ? 4 : undefined}
            contentTransition="opacity"
            animation={{ animation: Animation.easeOut(0.2), value: status }}
          >{status}</Text>
        )}
      </VStack>
    </VStack>
  )
}
