import { Image, Path, RoundedRectangle, Script, ZStack } from "scripting"
import { ProviderId } from "../models/types"
import { PROVIDER_ICON_BASE64 } from "../utils/provider_icons_data"
import { getProviderMeta } from "../utils/providers_catalog"
import { providerBrandBadgeBgColor } from "../utils/theme"

const uiImageCache = new Map<ProviderId, UIImage>()

function getProviderUIImage(provider: ProviderId): UIImage | null {
  const cached = uiImageCache.get(provider)
  if (cached) return cached

  const b64 = PROVIDER_ICON_BASE64[provider]
  if (b64) {
    const img = UIImage.fromBase64String(b64)
    if (img) {
      uiImageCache.set(provider, img)
      return img
    }
  }

  const iconPath = Path.join(
    Script.directory,
    "assets",
    "icons",
    `${provider}.png`
  )
  if (FileManager.existsSync(iconPath)) {
    const img = UIImage.fromFile(iconPath)
    if (img) {
      uiImageCache.set(provider, img)
      return img
    }
  }
  return null
}

export function ProviderIconView(props: {
  provider: ProviderId
  size?: number
  dimmed?: boolean
  rawEmblemOnly?: boolean
  opacity?: number
  tintColor?: any
}) {
  const { provider, size = 38, dimmed = false, rawEmblemOnly = false, opacity, tintColor } = props
  const meta = getProviderMeta(provider)
  const uiImage = getProviderUIImage(provider)
  const cornerRadius = Math.round(size * 0.26)
  const innerSize = rawEmblemOnly ? size : Math.round(size * 0.66)
  // 水印默认透明度调优为 0.46（显著提升色彩与轮廓清晰度，在任何深浅色壁纸下均清晰立体显眼）
  const watermarkOpacity = opacity ?? (dimmed ? 0.46 : 1)

  if (rawEmblemOnly) {
    if (uiImage) {
      return (
        <Image
          image={uiImage}
          renderingMode={tintColor ? "template" : "original"}
          foregroundStyle={tintColor}
          resizable={true}
          scaleToFit={true}
          interpolation="high"
          antialiased={true}
          frame={{ width: size, height: size }}
          opacity={dimmed ? watermarkOpacity : 1}
        />
      )
    }
    return (
      <Image
        systemName={meta.symbolName}
        font={Math.round(size * 0.75)}
        foregroundStyle={tintColor || providerBrandBadgeBgColor(provider)}
        opacity={dimmed ? watermarkOpacity : 1}
      />
    )
  }

  return (
    <ZStack
      frame={{ width: size, height: size }}
      opacity={dimmed ? 0.6 : 1}
    >
      <RoundedRectangle
        cornerRadius={cornerRadius}
        style="continuous"
        fill={providerBrandBadgeBgColor(provider)}
      />
      {uiImage ? (
        <Image
          image={uiImage}
          renderingMode="original"
          resizable={true}
          scaleToFit={true}
          interpolation="high"
          antialiased={true}
          frame={{ width: innerSize, height: innerSize }}
        />
      ) : (
        <Image
          systemName={meta.symbolName}
          font="subheadline"
          foregroundStyle="white"
        />
      )}
    </ZStack>
  )
}
