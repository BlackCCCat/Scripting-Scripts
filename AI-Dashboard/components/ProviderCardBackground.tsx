import { gradient, RoundedRectangle, type Color, type DynamicShapeStyle } from "scripting"
import type { ProviderId } from "../models/types"
import { getProviderUIImage } from "./ProviderIconView"

type RGB = readonly [number, number, number]
const palettes = new Map<ProviderId, DynamicShapeStyle>()
const neutral: RGB = [117, 129, 151]

function blend(brand: RGB, surface: RGB, fraction: number, opacity: number): Color {
  const [r, g, b] = brand.map((channel, i) =>
    Math.round(channel * fraction + surface[i] * (1 - fraction))
  )
  return `rgba(${r},${g},${b},${opacity})`
}

export function providerCardFill(provider: ProviderId): DynamicShapeStyle {
  const cached = palettes.get(provider)
  if (cached) return cached

  let brand = neutral
  try {
    for (const { color } of getProviderUIImage(provider)?.dominantColors(8) ?? []) {
      const { red, green, blue, alpha } = color
      const max = Math.max(red, green, blue)
      const min = Math.min(red, green, blue)
      // Ignore transparent margins and near-white or black pixels.
      if (alpha >= 0.65 && max >= 0.18 && min <= 0.86 && max - min >= 0.12) {
        brand = [red * 255, green * 255, blue * 255]
        break
      }
    }
  } catch {
    // Older hosts and unavailable images still get a neutral card.
  }

  const white: RGB = [255, 255, 255]
  const darkBase: RGB = [12, 16, 30]
  const darkTrailing: RGB = [53, 62, 80]
  const fill: DynamicShapeStyle = {
    light: gradient("linear", {
      colors: [blend(brand, white, 0.30, 0.85), blend(brand, white, 0.04, 0.60)],
      startPoint: "leading",
      endPoint: "trailing",
    }),
    dark: gradient("linear", {
      colors: [blend(brand, darkBase, 0.18, 0.84), blend(brand, darkTrailing, 0.03, 0.78)],
      startPoint: "leading",
      endPoint: "trailing",
    }),
  }
  palettes.set(provider, fill)
  return fill
}

export function ProviderCardBackground(props: { provider: ProviderId }) {
  return (
    <RoundedRectangle
      cornerRadius={16}
      style="continuous"
      fill={providerCardFill(props.provider)}
    />
  )
}
