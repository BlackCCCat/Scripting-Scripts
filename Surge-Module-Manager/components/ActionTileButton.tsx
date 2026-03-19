import {
  Button,
  Image,
  RoundedRectangle,
  Spacer,
  Text,
  useColorScheme,
  VStack,
  ZStack,
  type ShapeStyle,
} from "scripting"

export function ActionTileButton(props: {
  title: string
  systemImage: string
  disabled?: boolean
  tint?: ShapeStyle
  onPress: () => void | Promise<void>
}) {
  const colorScheme = useColorScheme()
  const foreground: ShapeStyle = props.disabled ? "secondaryLabel" : (props.tint ?? "systemBlue")
  const darkCardFill: ShapeStyle = props.disabled ? "rgba(58,58,60,0.72)" : "rgba(58,58,60,0.96)"

  return (
    <Button
      action={() => {
        HapticFeedback.mediumImpact()
        void props.onPress()
      }}
      disabled={props.disabled}
      buttonStyle="plain"
      frame={{ maxWidth: "infinity", minHeight: 96 }}
    >
      {colorScheme === "dark" ? (
        <ZStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          background={"rgba(0,0,0,0.001)"}
        >
          <RoundedRectangle
            cornerRadius={16}
            fill={darkCardFill}
            stroke={"separator"}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
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
        </ZStack>
      ) : (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding
          spacing={8}
          background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 16 } }}
        >
          <VStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            background={"rgba(0,0,0,0.001)"}
            spacing={8}
          >
            <Spacer />
            <Image systemName={props.systemImage} font="title2" foregroundStyle={foreground} />
            <Text font="headline" foregroundStyle={foreground}>
              {props.title}
            </Text>
            <Spacer />
          </VStack>
        </VStack>
      )}
    </Button>
  )
}
