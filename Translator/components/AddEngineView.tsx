import {
  Button,
  ForEach,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  HStack,
} from "scripting"

import { TRANSLATION_ENGINE_OPTIONS } from "../constants"

export function AddEngineView(props: {
  existingKinds: string[]
}) {
  const dismiss = Navigation.useDismiss()
  const options = [
    ...TRANSLATION_ENGINE_OPTIONS.filter((item) => (
      item.id === "google_translate"
      && !props.existingKinds.includes(item.id)
    )).map((item) => ({
      id: item.id,
      label: item.label,
      systemImage: item.systemImage,
    })),
    {
      id: "ai_api",
      label: "AI 接口",
      systemImage: "sparkles",
    },
  ]

  return (
    <NavigationStack>
      <List
        navigationTitle="添加引擎"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
      >
        <Section footer={<Text>AI 接口支持 New API 平台、OpenAI 兼容接口和 Gemini 接口三种格式。</Text>}>
          <ForEach
            count={options.length}
            itemBuilder={(index) => {
              const option = options[index]
              return (
                <Button
                  key={option.id}
                  action={() => {
                    dismiss({
                      kind: option.id,
                    })
                  }}
                >
                  <HStack spacing={10}>
                    <Image
                      systemName={option.systemImage}
                      foregroundStyle="systemBlue"
                    />
                    <Text>{option.label}</Text>
                  </HStack>
                </Button>
              )
            }}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}
