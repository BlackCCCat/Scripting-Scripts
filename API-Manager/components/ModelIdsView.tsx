import {
  Button,
  HStack,
  List,
  NavigationStack,
  Section,
  Spacer,
  Text,
  VStack,
  useState,
} from "scripting"

export function ModelIdsView(props: {
  title: string
  modelIds: string[]
  onCopy: (modelId: string) => void | Promise<void>
}) {
  const [copiedModelId, setCopiedModelId] = useState("")

  return (
    <NavigationStack>
      <List
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
      >
        <Section
          header={<Text>可用模型</Text>}
          footer={<Text>点击模型 ID 可直接复制</Text>}
        >
          {props.modelIds.length ? (
            props.modelIds.map((modelId) => (
              <Button
                key={modelId}
                buttonStyle="plain"
                action={() => {
                  setCopiedModelId(modelId)
                  void props.onCopy(modelId)
                }}
              >
                <HStack
                  frame={{ width: "100%" as any }}
                  spacing={10}
                  padding={{ top: 12, bottom: 12 }}
                  background={"rgba(0,0,0,0.001)"}
                >
                  <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={4}>
                    <Text>{modelId}</Text>
                  </VStack>
                  <Spacer />
                  {copiedModelId === modelId ? (
                    <Text font="footnote" foregroundStyle="systemGreen">
                      已复制
                    </Text>
                  ) : null}
                </HStack>
              </Button>
            ))
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无可用模型</Text>
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}
