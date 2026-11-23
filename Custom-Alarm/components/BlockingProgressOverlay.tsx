import { ProgressView, Text, VStack, useColorScheme } from "scripting"

import { GLASS_CARD_SHAPE, supportsLiquidGlass } from "./PageAppearance"

export function BlockingProgressOverlay(props: { message: string; glass?: boolean }) {
  const dark = useColorScheme() === "dark"
  const useGlass = props.glass && supportsLiquidGlass

  return (
    <VStack
      spacing={12}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}
      contentShape="rect"
    >
      <VStack
        spacing={12}
        padding={{ top: 20, bottom: 20, leading: 24, trailing: 24 }}
        glassEffect={useGlass ? GLASS_CARD_SHAPE : undefined}
        shadow={useGlass ? undefined : {
          color: dark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)",
          radius: 20,
          y: 8,
        }}
        background={useGlass ? undefined : {
          style: dark ? "#1F1F22" : "#FFFFFF",
          shape: { type: "rect", cornerRadius: 20 },
        }}
      >
        <ProgressView progressViewStyle="circular" />
        <Text font="subheadline" foregroundStyle={useGlass ? "label" : "secondaryLabel"}>{props.message}</Text>
      </VStack>
    </VStack>
  )
}
