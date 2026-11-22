import { RoundedRectangle, ZStack, type Color, type DynamicShapeStyle, type VirtualNode } from "scripting"
import { isIOS26OrLater } from "../utils/theme"

export function glassCardSurface(
  fill: DynamicShapeStyle,
  cornerRadius: number,
  options?: { decoration?: VirtualNode; tint?: Color }
) {
  const hasGlass = isIOS26OrLater()
  const shape = { type: "rect", cornerRadius, style: "continuous" } as const
  return {
    background: (
      <ZStack allowsHitTesting={false} accessibilityHidden={true}>
        {hasGlass ? null : (
          <RoundedRectangle cornerRadius={cornerRadius} style="continuous" fill="secondarySystemGroupedBackground" />
        )}
        <RoundedRectangle
          cornerRadius={cornerRadius}
          style="continuous"
          fill={fill}
          opacity={hasGlass ? 0.48 : 1}
        />
        {options?.decoration}
      </ZStack>
    ),
    glassEffect: hasGlass
      ? options?.tint ? { glass: UIGlass.regular().tint(options.tint), shape } : shape
      : undefined,
  }
}
