import {
  AVPlayerView,
  Button,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"

import type { BiliAuthSession, BiliInlinePlaybackSource, VideoDynamicItem } from "../types"
import { fetchInlinePlaybackSource, reportPlaybackProgress } from "../utils/bilibili"

function resolveVideoUrl(item: VideoDynamicItem): string {
  const jumpUrl = String(item.jumpUrl ?? "").trim()
  if (jumpUrl) return jumpUrl

  const bvid = String(item.bvid ?? "").trim()
  if (bvid) return `https://www.bilibili.com/video/${bvid}`

  const aid = String(item.aid ?? "").trim()
  if (aid) return `https://www.bilibili.com/video/av${aid}`

  return ""
}

async function openExternalUrl(url: string): Promise<void> {
  const target = String(url ?? "").trim()
  if (!target) return

  const runtimeSafari = (globalThis as any).Safari

  if (runtimeSafari?.openURL) {
    const ok = await runtimeSafari.openURL(target)
    if (ok) return
  }

  if (runtimeSafari?.open) {
    const ok = await runtimeSafari.open(target)
    if (ok !== false) return
  }

  const openURL = (globalThis as any).openURL
  if (typeof openURL === "function") {
    const ok = await openURL(target)
    if (ok !== false) return
  }

  if (runtimeSafari?.present) {
    await runtimeSafari.present(target, true)
  }
}

async function setPlaybackAudioSessionActive(active: boolean): Promise<void> {
  const runtimeSharedAudioSession = (globalThis as any).SharedAudioSession

  if (!runtimeSharedAudioSession?.setActive) return

  if (active) {
    if (runtimeSharedAudioSession?.setCategory) {
      await runtimeSharedAudioSession.setCategory("playback", ["mixWithOthers"])
    }
    await runtimeSharedAudioSession.setActive(true)
    return
  }

  await runtimeSharedAudioSession.setActive(false, ["notifyOthersOnDeactivation"])
}

export function InlineVideoPlayerPage(props: {
  auth: BiliAuthSession
  item: VideoDynamicItem
}) {
  const player = useMemo(() => new AVPlayer(), [])
  const pipStatus = useObservable<any>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState("")
  const sourceRef = useRef<BiliInlinePlaybackSource | null>(null)
  const progressReportedRef = useRef(false)
  const pageDismissedRef = useRef(false)
  const jumpUrl = useMemo(() => resolveVideoUrl(props.item), [props.item])

  function stopPlayback() {
    player.pause()
    player.stop()
    player.onReadyToPlay = undefined
    player.onError = undefined
  }

  async function reportProgressIfNeeded() {
    if (progressReportedRef.current) return

    const source = sourceRef.current
    const currentTime = Number(player.currentTime ?? 0) || 0
    const duration = Number(player.duration ?? 0) || 0

    if (!source || currentTime < 3) return

    progressReportedRef.current = true
    const nearFinished = duration > 0 && currentTime >= Math.max(duration - 3, duration * 0.98)
    const progress = nearFinished && duration > 0 ? duration : currentTime

    try {
      await reportPlaybackProgress(props.auth.cookieHeader, source, progress)
    } catch (error) {
      progressReportedRef.current = false
      console.log("[BiliFavor] 上报播放进度失败:", String(error))
    }
  }

  async function teardownPlayback(options?: {
    reportProgress?: boolean
    dispose?: boolean
  }) {
    if (options?.reportProgress) {
      await reportProgressIfNeeded()
    }

    stopPlayback()
    await setPlaybackAudioSessionActive(false)

    if (options?.dispose) {
      player.dispose()
    }
  }

  async function handlePageDismiss() {
    if (pageDismissedRef.current) return
    pageDismissedRef.current = true
    await teardownPlayback({ reportProgress: true })
  }

  useEffect(() => {
    ;(async () => {
      await setPlaybackAudioSessionActive(true)
    })()
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrorMessage("")
    sourceRef.current = null
    progressReportedRef.current = false
    pageDismissedRef.current = false
    stopPlayback()

    ;(async () => {
      try {
        const source = await fetchInlinePlaybackSource(props.auth.cookieHeader, props.item)
        if (cancelled) return
        sourceRef.current = source

        player.onReadyToPlay = () => {
          if (!cancelled) {
            player.play()
          }
        }
        player.onError = (message) => {
          if (!cancelled) {
            setErrorMessage(String(message ?? "播放器加载失败"))
          }
        }

        const accepted = player.setSource(source.url)
        if (!accepted) {
          throw new Error("播放器无法载入当前视频")
        }
      } catch (error: any) {
        if (cancelled) return
        setErrorMessage(String(error?.message ?? error ?? "当前视频暂时无法在应用内播放"))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      void reportProgressIfNeeded()
    }
  }, [player, props.auth.cookieHeader, props.item.id])

  useEffect(() => {
    return () => {
      void teardownPlayback({ reportProgress: true, dispose: true })
    }
  }, [player])

  return (
    <VStack
      spacing={16}
      padding={{ top: 16, bottom: 24, leading: 16, trailing: 16 }}
      navigationTitle="播放"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarTrailing: <Button
          title=""
          systemImage="safari"
          action={() => {
            void openExternalUrl(jumpUrl)
          }}
        />,
      }}
      onDisappear={() => {
        void handlePageDismiss()
      }}
    >
      <ZStack
        frame={{ maxWidth: "infinity", height: 240 }}
        background={{ style: "black", shape: { type: "rect", cornerRadius: 20 } }}
      >
        {loading || errorMessage ? (
          <Image
            imageUrl={props.item.cover}
            resizable={true}
            scaleToFill={true}
            frame={{ maxWidth: "infinity", height: 240 }}
            clipShape={{ type: "rect", cornerRadius: 20 }}
            opacity={errorMessage ? 0.45 : 0.75}
          />
        ) : null}

        {!loading && !errorMessage ? (
          <AVPlayerView
            player={player}
            pipStatus={pipStatus}
            allowsPictureInPicturePlayback={true}
            canStartPictureInPictureAutomaticallyFromInline={true}
            updatesNowPlayingInfoCenter={true}
            entersFullScreenWhenPlaybackBegins={false}
            exitsFullScreenWhenPlaybackEnds={true}
            videoGravity="resizeAspect"
            frame={{ maxWidth: "infinity", height: 240 }}
            clipShape={{ type: "rect", cornerRadius: 20 }}
          />
        ) : null}

        {loading ? (
          <VStack spacing={10}>
            <ProgressView progressViewStyle="circular" tint="white" />
            <Text foregroundStyle="white">正在解析视频地址…</Text>
          </VStack>
        ) : null}

        {errorMessage ? (
          <VStack spacing={12} padding={{ leading: 20, trailing: 20 }}>
            <Text font="headline" foregroundStyle="white">
              应用内播放失败
            </Text>
            <Text
              font="subheadline"
              foregroundStyle="rgba(255,255,255,0.88)"
              multilineTextAlignment="center"
            >
              {errorMessage}
            </Text>
            <Button
              title="在哔哩哔哩打开"
              systemImage="arrow.up.right.square"
              action={() => {
                void openExternalUrl(jumpUrl)
              }}
            />
          </VStack>
        ) : null}
      </ZStack>

      <VStack spacing={10} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <Text font="title3" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          {props.item.title}
        </Text>
        <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text font="subheadline" foregroundStyle="#FB7299">
            {props.item.authorName}
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel">
            {props.item.publishedLabel || "最新投稿"}
          </Text>
          <Spacer />
        </HStack>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        >
          播放 {props.item.playText} · 弹幕 {props.item.danmakuText}
        </Text>
      </VStack>
      <Spacer />
    </VStack>
  )
}
