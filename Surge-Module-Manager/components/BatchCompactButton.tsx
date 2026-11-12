import { Button, EmptyView, Image, Text, VStack } from "scripting"

export function BatchCompactButton(props: {
  title: string
  systemImage: string
  tint?: "systemBlue" | "systemGreen" | "systemRed"
  disabled?: boolean
  onPress: () => void | Promise<void>
}) {
  const foreground = props.disabled ? "secondaryLabel" : (props.tint ?? "systemBlue")
  return <Button
    action={() => { HapticFeedback.mediumImpact(); void props.onPress() }}
    disabled={props.disabled}
    buttonStyle="borderless"
    glassEffect
    buttonBorderShape="roundedRectangle"
    tint={props.tint ?? "systemBlue"}
    frame={{ maxWidth: "infinity", minHeight: 46 }}
    listRowBackground={<EmptyView />}
    listRowSeparator="hidden"
  >
    <VStack frame={{ maxWidth: "infinity", minHeight: 46, alignment: "center" }} padding={{ top: 3, bottom: 3 }} spacing={2}>
      <Image systemName={props.systemImage} font={15} foregroundStyle={foreground} />
      <Text font="caption2" foregroundStyle={foreground} lineLimit={1}>{props.title}</Text>
    </VStack>
  </Button>
}
