import { RoundedRectangle, ZStack, type CommonViewProps, type DynamicShapeStyle, type VirtualNode } from "scripting"
import { isIOS26OrLater } from "../utils/theme"

export function glassCardSurface(
  fill: DynamicShapeStyle,
  cornerRadius: number,
  decoration?: VirtualNode,
  animation?: CommonViewProps["animation"]
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
          contentTransition={animation ? "interpolate" : undefined}
          animation={animation}
          opacity={hasGlass ? 0.48 : 1}
        />
        {decoration}
      </ZStack>
    ),
    glassEffect: hasGlass ? shape : undefined,
  }
}
