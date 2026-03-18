import {
  Button,
  Image,
  Spacer,
  Text,
  VStack,
  type ShapeStyle,
} from "scripting"

export function ActionTileButton(props: {
  title: string
  systemImage: string
  disabled?: boolean
  tint?: ShapeStyle
  onPress: () => void | Promise<void>
}) {
  const foreground: ShapeStyle = props.disabled ? "secondaryLabel" : (props.tint ?? "systemBlue")

  return (
    <Button
      action={() => {
        HapticFeedback.mediumImpact()
        void props.onPress()
      }}
      disabled={props.disabled}
      buttonStyle="plain"
      frame={{ maxWidth: "infinity", minHeight: 96 }}
      background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 16 } }}
    >
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding
        spacing={8}
      >
        <Spacer />
        <Image systemName={props.systemImage} font="title2" foregroundStyle={foreground} />
        <Text font="headline" foregroundStyle={foreground}>
          {props.title}
        </Text>
        <Spacer />
      </VStack>
    </Button>
  )
}
