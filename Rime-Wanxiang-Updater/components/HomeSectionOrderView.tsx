import {
  Button,
  EditButton,
  ForEach,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  VStack,
  useState,
} from "scripting"

import {
  HOME_SECTION_LABELS,
  normalizeHomeSectionOrder,
  type HomeSectionKey,
} from "../utils/config"

function moveItems(list: HomeSectionKey[], indices: number[], newOffset: number): HomeSectionKey[] {
  if (!indices.length) return list
  const sorted = Array.from(new Set(indices)).sort((a, b) => a - b)
  const picked: HomeSectionKey[] = sorted
    .map((i) => list[i])
    .filter((item): item is HomeSectionKey => !!item)
  const rest = list.filter((_, idx) => !sorted.includes(idx))
  let insertAt = Math.max(0, Math.min(rest.length, newOffset))
  for (const idx of sorted) {
    if (idx < newOffset) insertAt -= 1
  }
  if (insertAt < 0) insertAt = 0
  rest.splice(insertAt, 0, ...picked)
  return normalizeHomeSectionOrder(rest)
}

function RowButton(props: { title: string; role?: "cancel"; onPress: () => void }) {
  return (
    <Button
      role={props.role}
      action={() => {
        try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
        props.onPress()
      }}
    >
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

export function HomeSectionOrderView(props: {
  initialOrder: HomeSectionKey[]
  onDone: (order: HomeSectionKey[]) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [order, setOrder] = useState<HomeSectionKey[]>(() => normalizeHomeSectionOrder(props.initialOrder))

  function saveAndClose() {
    props.onDone(normalizeHomeSectionOrder(order))
    dismiss()
  }

  return (
    <NavigationStack>
      <VStack navigationTitle={"页面显示设置"} navigationBarTitleDisplayMode={"inline"}>
        <List
          listStyle="insetGroup"
          toolbar={{
            topBarTrailing: <EditButton />,
          }}
        >
          <Section header={<Text>主页区块排序</Text>}>
            <Text foregroundStyle="secondaryLabel">
              点右上角编辑后拖动排序，主页会按这里的顺序显示五个区块。
            </Text>
            <ForEach
              count={order.length}
              onMove={(indices: number[], newOffset: number) => {
                setOrder((list) => moveItems(list, indices, newOffset))
              }}
              itemBuilder={(index: number) => {
                const key = order[index]
                if (!key) return <Text> </Text>
                return (
                  <HStack key={key} padding={{ top: 10, bottom: 10 }}>
                    <Text>{HOME_SECTION_LABELS[key]}</Text>
                    <Spacer />
                    <Text foregroundStyle="secondaryLabel">{index + 1}</Text>
                  </HStack>
                )
              }}
            />
          </Section>

          <Section>
            <RowButton title="保存" onPress={saveAndClose} />
            <RowButton title="取消" role="cancel" onPress={() => dismiss()} />
          </Section>
        </List>
      </VStack>
    </NavigationStack>
  )
}
