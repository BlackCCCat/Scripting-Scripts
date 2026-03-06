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

import { isLikelyHttpUrl, normalizeBaseUrl } from "../utils/common"

export type EditEntryResult = {
  name: string
  baseUrl: string
  apiKey: string
}

function LabeledInputRow(props: {
  value: string
  prompt: string
  onChanged: (value: string) => void
}) {
  return (
    <TextField
      title=""
      value={props.value}
      prompt={props.prompt}
      onChanged={props.onChanged}
    />
  )
}

function CenterRowButton(props: {
  title: string
  role?: "cancel" | "destructive"
  onPress: () => void | Promise<void>
}) {
  return (
    <Button
      buttonStyle="plain"
      role={props.role}
      frame={{ maxWidth: "infinity" }}
      action={() => {
        try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
        void props.onPress()
      }}
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

export function EditEntryView(props: {
  title: string
  initial?: Partial<EditEntryResult>
}) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(String(props.initial?.name ?? ""))
  const [baseUrl, setBaseUrl] = useState(String(props.initial?.baseUrl ?? ""))
  const [apiKey, setApiKey] = useState(String(props.initial?.apiKey ?? ""))

  async function onSave() {
    const fixedName = String(name ?? "").trim()
    const fixedBaseUrl = normalizeBaseUrl(baseUrl)
    const fixedApiKey = String(apiKey ?? "").trim()

    if (!fixedName) {
      await Dialog.alert({ message: "请输入名称" })
      return
    }
    if (!fixedBaseUrl) {
      await Dialog.alert({ message: "请输入链接" })
      return
    }
    if (!fixedApiKey) {
      await Dialog.alert({ message: "请输入 API Key" })
      return
    }

    if (!isLikelyHttpUrl(fixedBaseUrl)) {
      await Dialog.alert({
        message: "链接请填写基础地址，例如 https://example.com 或 https://example.com/proxy",
      })
      return
    }

    dismiss({
      name: fixedName,
      baseUrl: fixedBaseUrl,
      apiKey: fixedApiKey,
    } satisfies EditEntryResult)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
      >
        <Section
          header={<Text>基础信息</Text>}
          footer={
            <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={4}>
              <Text
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                multilineTextAlignment="leading"
              >
                链接请填写 API 的基础地址，不要填写 /api/status 或 /v1/models。
              </Text>
              <Text
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                multilineTextAlignment="leading"
              >
                可填写示例：https://example.com
              </Text>
              <Text
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                multilineTextAlignment="leading"
              >
                也可以填写带前缀路径的地址：https://example.com/proxy
              </Text>
            </VStack>
          }
        >
          <LabeledInputRow
            value={name}
            prompt="名称，如OpenAI中转"
            onChanged={setName}
          />
          <LabeledInputRow
            value={baseUrl}
            prompt="base url，如 https://example.com"
            onChanged={setBaseUrl}
          />
          <LabeledInputRow
            value={apiKey}
            prompt="API Key，如sk-******"
            onChanged={setApiKey}
          />
        </Section>

        <Section>
          <CenterRowButton title="保存" onPress={onSave} />
          <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
        </Section>
      </Form>
    </NavigationStack>
  )
}
