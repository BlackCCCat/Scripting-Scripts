import {
  Button,
  EmptyView,
  Image,
  Spacer,
  Text,
  VStack,
  type ShapeStyle,
} from "scripting"

export function OriginSFSymbolButton(props: {
  title: string
  systemImage: string
  onPress: () => void | Promise<void>
  subtitle?: string
  disabled?: boolean
  hapticEnabled?: boolean
  height?: number
  showBackground?: boolean
  tint?: ShapeStyle
}) {
  const foreground: ShapeStyle = props.disabled ? "secondaryLabel" : (props.tint ?? "systemBlue")
  const height = props.height ?? 96
  const hapticEnabled = props.hapticEnabled ?? true
  const showBackground = props.showBackground ?? true

  return (
    <Button
      action={() => {
        if (hapticEnabled) {
          try {
            HapticFeedback.mediumImpact()
          } catch {}
        }
        void props.onPress()
      }}
      disabled={props.disabled}
      buttonStyle="glass"
      tint={props.tint}
      frame={{ maxWidth: "infinity", minHeight: height }}
      listRowBackground={showBackground ? undefined : <EmptyView />}
      listRowSeparator={showBackground ? undefined : "hidden"}
    >
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding
        spacing={6}
      >
        <Spacer />
        <Image systemName={props.systemImage} font="title2" foregroundStyle={foreground} />
        <Text font="headline" foregroundStyle={foreground}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
            {props.subtitle}
          </Text>
        ) : null}
        <Spacer />
      </VStack>
    </Button>
  )
}
