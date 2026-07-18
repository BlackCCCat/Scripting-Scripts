import {
  Image,
  ProgressView,
  Rectangle,
  RoundedRectangle,
  ZStack,
  gradient,
  useEffect,
  useObservable,
  type Color,
} from "scripting"

type CoverDominantColor = {
  red: number
  green: number
  blue: number
  alpha: number
  hex: string
}

type CoverDominantColorItem = {
  color: CoverDominantColor
  fraction: number
}

type VideoCoverArtworkState = {
  coverUrl: string | null
  image: UIImage | null
  dominantColor: CoverDominantColor | null
  fallbackToUrl: boolean
}

const memoryCache = new Map<string, VideoCoverArtworkState>()
const pendingTasks = new Map<string, Promise<VideoCoverArtworkState>>()

const neutralCardFill = {
  light: "rgba(255,255,255,0.96)",
  dark: "rgba(28,28,30,0.96)",
} as const

const neutralCoverFill = {
  light: "rgba(0,0,0,0.04)",
  dark: "rgba(255,255,255,0.07)",
} as const

const emptyState = (coverUrl: string | null = null): VideoCoverArtworkState => ({
  coverUrl,
  image: null,
  dominantColor: null,
  fallbackToUrl: false,
})

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

const luminance = (color: CoverDominantColor) => (
  0.299 * color.red + 0.587 * color.green + 0.114 * color.blue
)

const isUsableDominantColor = (item: CoverDominantColorItem) => {
  const lightness = luminance(item.color)
  return item.color.alpha > 0.45 && lightness > 0.08 && lightness < 0.96
}

const rgbToHsl = (red: number, green: number, blue: number) => {
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2

  if (max === min) return { hue: 0, saturation: 0, lightness }

  const delta = max - min
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min)

  let hue = 0
  switch (max) {
    case red:
      hue = (green - blue) / delta + (green < blue ? 6 : 0)
      break
    case green:
      hue = (blue - red) / delta + 2
      break
    default:
      hue = (red - green) / delta + 4
      break
  }

  return { hue: hue / 6, saturation, lightness }
}

const hueToRgb = (p: number, q: number, t: number) => {
  let next = t
  if (next < 0) next += 1
  if (next > 1) next -= 1
  if (next < 1 / 6) return p + (q - p) * 6 * next
  if (next < 1 / 2) return q
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6
  return p
}

const hslToRgb = (hue: number, saturation: number, lightness: number) => {
  if (saturation === 0) {
    return { red: lightness, green: lightness, blue: lightness }
  }

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q

  return {
    red: hueToRgb(p, q, hue + 1 / 3),
    green: hueToRgb(p, q, hue),
    blue: hueToRgb(p, q, hue - 1 / 3),
  }
}

const rgbaString = (red: number, green: number, blue: number, alpha: number): Color => (
  `rgba(${Math.round(red * 255)},${Math.round(green * 255)},${Math.round(blue * 255)},${alpha})` as Color
)

const normalizeBackgroundRgb = (dominantColor: CoverDominantColor) => {
  const hsl = rgbToHsl(dominantColor.red, dominantColor.green, dominantColor.blue)
  const saturation = clamp(hsl.saturation * 0.82)
  const lightness = clamp(hsl.lightness > 0.5 ? hsl.lightness + 0.06 : hsl.lightness + 0.16, 0, 0.9)
  return hslToRgb(hsl.hue, saturation, lightness)
}

const makeCoverGradient = (dominantColor: CoverDominantColor, startAlpha: number, middleAlpha: number) => {
  const rgb = normalizeBackgroundRgb(dominantColor)
  return gradient("linear", {
    stops: [
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, startAlpha), location: 0 },
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, middleAlpha), location: 0.42 },
      { color: rgbaString(rgb.red, rgb.green, rgb.blue, 0), location: 1 },
    ],
    startPoint: "topLeading",
    endPoint: "bottomTrailing",
  })
}

const makeCardStroke = (dominantColor: CoverDominantColor) => {
  const rgb = normalizeBackgroundRgb(dominantColor)
  return {
    light: rgbaString(rgb.red, rgb.green, rgb.blue, 0.18),
    dark: rgbaString(rgb.red, rgb.green, rgb.blue, 0.28),
  }
}

const makeVideoCoverFrameFill = (dominantColor: CoverDominantColor | null) => {
  if (!dominantColor) return neutralCoverFill

  const rgb = normalizeBackgroundRgb(dominantColor)
  return {
    light: rgbaString(rgb.red, rgb.green, rgb.blue, 0.12),
    dark: rgbaString(rgb.red, rgb.green, rgb.blue, 0.16),
  }
}

const extractDominantColor = (image: UIImage): CoverDominantColor | null => {
  try {
    const dominantColors = (image as UIImage & {
      dominantColors?: (count?: number) => CoverDominantColorItem[]
    }).dominantColors

    if (typeof dominantColors !== "function") return null

    const colors = dominantColors.call(image, 8)
    return colors.find(isUsableDominantColor)?.color ?? colors[0]?.color ?? null
  } catch {
    return null
  }
}

const buildState = (
  coverUrl: string,
  image: UIImage | null,
  dominantColor: CoverDominantColor | null,
  fallbackToUrl = false,
): VideoCoverArtworkState => ({
  coverUrl,
  image,
  dominantColor,
  fallbackToUrl,
})

const loadCoverArtwork = async (coverUrl: string): Promise<VideoCoverArtworkState> => {
  try {
    const image = await UIImage.fromURL(coverUrl)
    if (!image) return buildState(coverUrl, null, null, true)

    const thumbnail = image.preparingThumbnail({ width: 960, height: 540 }) ?? image
    const dominantColor = extractDominantColor(thumbnail) ?? extractDominantColor(image)

    return buildState(coverUrl, image, dominantColor)
  } catch {
    return buildState(coverUrl, null, null, true)
  }
}

const resolveCoverArtwork = (coverUrl: string): Promise<VideoCoverArtworkState> => {
  const cached = memoryCache.get(coverUrl)
  if (cached) return Promise.resolve(cached)

  const pending = pendingTasks.get(coverUrl)
  if (pending) return pending

  const task = loadCoverArtwork(coverUrl)
    .then((state) => {
      memoryCache.set(coverUrl, state)
      return state
    })
    .finally(() => {
      pendingTasks.delete(coverUrl)
    })

  pendingTasks.set(coverUrl, task)
  return task
}

export function useVideoCoverArtwork(coverUrl?: string | null): VideoCoverArtworkState {
  const state = useObservable<VideoCoverArtworkState>(emptyState(coverUrl ?? null))

  useEffect(() => {
    const nextCoverUrl = String(coverUrl ?? "").trim() || null
    if (!nextCoverUrl) {
      state.setValue(emptyState(null))
      return
    }

    if (state.value.coverUrl === nextCoverUrl && (state.value.image || state.value.fallbackToUrl)) {
      return
    }

    let cancelled = false
    state.setValue(emptyState(nextCoverUrl))

    resolveCoverArtwork(nextCoverUrl).then((nextState) => {
      if (!cancelled) state.setValue(nextState)
    })

    return () => {
      cancelled = true
    }
  }, [coverUrl])

  return state.value
}

export function VideoCardBackground(props: {
  dominantColor: CoverDominantColor | null
  cornerRadius?: number
}) {
  const cornerRadius = props.cornerRadius ?? 24
  const gradientFill = props.dominantColor
    ? {
      light: makeCoverGradient(props.dominantColor, 0.34, 0.12),
      dark: makeCoverGradient(props.dominantColor, 0.24, 0.08),
    }
    : null

  return (
    <ZStack
      allowsHitTesting={false}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      <RoundedRectangle
        cornerRadius={cornerRadius}
        fill={neutralCardFill}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      />
      {gradientFill ? (
        <RoundedRectangle
          cornerRadius={cornerRadius}
          fill={gradientFill}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        />
      ) : null}
      <RoundedRectangle
        cornerRadius={cornerRadius}
        fill="clear"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        stroke={props.dominantColor ? {
          shapeStyle: makeCardStroke(props.dominantColor),
          strokeStyle: { lineWidth: 0.6 },
        } : {
          shapeStyle: "separator",
          strokeStyle: { lineWidth: 0.35 },
        }}
      />
    </ZStack>
  )
}

export function VideoCoverImage(props: {
  artwork: VideoCoverArtworkState
  coverUrl?: string | null
  cornerRadius?: number
}) {
  const clipShape = {
    type: "rect" as const,
    cornerRadius: props.cornerRadius ?? 18,
    style: "continuous" as const,
  }

  const coverFrame = { maxWidth: "infinity" as const, maxHeight: "infinity" as const }

  const placeholder = (
    <ZStack
      frame={coverFrame}
      clipShape={clipShape}
    >
      <ProgressView progressViewStyle="circular" />
    </ZStack>
  )

  if (props.artwork.image) {
    return (
      <Image
        image={props.artwork.image}
        resizable={true}
        scaleToFit={true}
        frame={coverFrame}
        clipShape={clipShape}
      />
    )
  }

  if (props.artwork.fallbackToUrl && props.coverUrl) {
    return (
      <Image
        imageUrl={props.coverUrl}
        resizable={true}
        scaleToFit={true}
        frame={coverFrame}
        clipShape={clipShape}
        placeholder={placeholder}
      />
    )
  }

  return (
    <Rectangle
      fill="clear"
      frame={coverFrame}
      clipShape={clipShape}
      overlay={placeholder}
    />
  )
}

export function CompactVideoCoverImage(props: {
  artwork: VideoCoverArtworkState
  coverUrl?: string | null
  height: number
}) {
  const frame = { maxWidth: "infinity" as const, height: props.height }
  const frameFill = makeVideoCoverFrameFill(props.artwork.dominantColor)
  const background = { style: frameFill }
  const placeholder = (
    <ZStack frame={frame} background={background}>
      <ProgressView progressViewStyle="circular" />
    </ZStack>
  )

  if (props.artwork.image) {
    return (
      <Image
        image={props.artwork.image}
        resizable={true}
        scaleToFit={true}
        frame={frame}
        background={background}
      />
    )
  }

  if (props.artwork.fallbackToUrl && props.coverUrl) {
    return (
      <Image
        imageUrl={props.coverUrl}
        resizable={true}
        scaleToFit={true}
        frame={frame}
        background={background}
        placeholder={placeholder}
      />
    )
  }

  return <Rectangle fill={frameFill} frame={frame} overlay={placeholder} />
}
