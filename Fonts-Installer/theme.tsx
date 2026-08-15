import {
  type Color,
  type DynamicShapeStyle,
  type KeywordPoint,
  Rectangle,
} from "scripting"

export type GradientBackgroundConfig = {
  lightColors: Color[]
  darkColors: Color[]
  startPoint: KeywordPoint
  endPoint: KeywordPoint
}

export const fontInstallerGradient: GradientBackgroundConfig = {
  lightColors: ["#F7F2FF", "#D9EEFF", "#BDE9E2"],
  darkColors: ["#0B1020", "#172A46", "#123A3B"],
  startPoint: "topLeading",
  endPoint: "bottomTrailing",
}

type FontInstallerColors = {
  accent: Color
  success: Color
  warning: Color
  primary: DynamicShapeStyle
  secondary: DynamicShapeStyle
  nativeCard: DynamicShapeStyle
  nativeLine: DynamicShapeStyle
}

export const colors: FontInstallerColors = {
  accent: "#4F46E5",
  success: "#0F8A68",
  warning: "#A35B00",
  primary: { light: "#172033", dark: "#F5F7FF" },
  secondary: { light: "#566176", dark: "#B8C2D8" },
  nativeCard: { light: "rgba(255,255,255,0.88)", dark: "rgba(25,31,46,0.92)" },
  nativeLine: { light: "rgba(23,32,51,0.10)", dark: "rgba(245,247,255,0.14)" },
}

export function CustomGradientBackground({
  config = fontInstallerGradient,
}: {
  config?: GradientBackgroundConfig
}) {
  return (
    <Rectangle
      fill={{
        light: {
          colors: config.lightColors,
          startPoint: config.startPoint,
          endPoint: config.endPoint,
        },
        dark: {
          colors: config.darkColors,
          startPoint: config.startPoint,
          endPoint: config.endPoint,
        },
      }}
      ignoresSafeArea={true}
      allowsHitTesting={false}
    />
  )
}
