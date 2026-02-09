import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  useState,
} from "scripting"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

function CenterRowButton(props: {
  title: string
  role?: "cancel" | "destructive"
  onPress: () => void | Promise<void>
}) {
  return (
    <Button role={props.role} action={withHaptic(props.onPress)} buttonStyle="plain">
      <HStack frame={{ width: "100%" as any }} padding={{ top: 14, bottom: 14 }}>
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

export function FullScreenInputView(props: {
  title: string
  initialValue: string
  prompt: string
}) {
  const dismiss = Navigation.useDismiss()
  const [value, setValue] = useState<string>(props.initialValue)

  return (
    <NavigationStack>
      <VStack navigationTitle={props.title} navigationBarTitleDisplayMode="inline">
        <Form formStyle="grouped">
          <Section>
            <TextField
              label={<Text>内容</Text>}
              value={value}
              axis="vertical"
              frame={{ minHeight: 420, alignment: "topLeading" }}
              prompt={props.prompt}
              autofocus
              onChanged={(v: string) => setValue(v)}
            />
          </Section>
          <Section>
            <CenterRowButton title="保存" onPress={() => dismiss(value)} />
            <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
