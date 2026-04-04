import { Button, HStack, Spacer, Text } from "scripting"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

export function CenterRowButton(props: {
  title: string
  role?: "cancel" | "destructive"
  disabled?: boolean
  onPress: () => void | Promise<void>
}) {
  return (
    <Button
      buttonStyle="plain"
      role={props.role}
      disabled={props.disabled}
      frame={{ maxWidth: "infinity" }}
      action={withHaptic(props.onPress)}
    >
      <HStack
        frame={{ width: "100%" as any }}
        padding={{ top: 14, bottom: 14 }}
        background={"rgba(0,0,0,0.001)"}
      >
        <Text opacity={0} frame={{ width: 1 }}>
          .
        </Text>
        <Spacer />
        <Text font="headline">{props.title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}
