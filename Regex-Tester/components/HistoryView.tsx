import {
  Button,
  Group,
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
  clearRegexHistory,
  formatTime,
  loadRegexHistory,
  removeRegexHistoryById,
  type RegexHistoryItem,
} from "../utils/history"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

function oneLine(text: string, max = 64): string {
  const compact = String(text ?? "").replace(/\s+/g, " ").trim()
  if (!compact) return "(空)"
  return compact.length > max ? `${compact.slice(0, max)}...` : compact
}

export function HistoryView() {
  const dismiss = Navigation.useDismiss()
  const [items, setItems] = useState<RegexHistoryItem[]>(() => loadRegexHistory())

  async function clearAll() {
    const ok = await Dialog.confirm({ message: "确定清空最近匹配记录吗？" })
    if (!ok) return
    clearRegexHistory()
    setItems([])
  }

  async function copyPattern(item: RegexHistoryItem) {
    await Pasteboard.setString(item.pattern)
    await Dialog.alert({ message: "已复制正则表达式" })
  }

  async function copyText(item: RegexHistoryItem) {
    await Pasteboard.setString(item.text)
    await Dialog.alert({ message: "已复制待匹配文本" })
  }

  async function removeItem(item: RegexHistoryItem) {
    const ok = await Dialog.confirm({ message: "确定删除这条历史记录吗？" })
    if (!ok) return
    const next = removeRegexHistoryById(item.id)
    setItems(next)
  }

  function restore(item: RegexHistoryItem) {
    dismiss(item)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="历史记录"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{
          topBarLeading: (
            <Button
              title="清空"
              disabled={!items.length}
              action={withHaptic(clearAll)}
            />
          ),
        }}
      >
        {items.length ? (
          <Section header={<Text>最近30条</Text>}>
            {items.map((item) => (
              <Button
                key={item.id}
                buttonStyle="plain"
                action={withHaptic(() => restore(item))}
                contextMenu={{
                  menuItems: (
                    <Group>
                      <Button title="复制正则表达式" action={() => void copyPattern(item)} />
                      <Button title="复制待匹配文本" action={() => void copyText(item)} />
                      <Button title="删除" role="destructive" action={() => void removeItem(item)} />
                    </Group>
                  ),
                }}
              >
                <VStack
                  frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
                  spacing={6}
                  padding={{ top: 8, bottom: 8 }}
                >
                  <HStack frame={{ width: "100%" as any }}>
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                      {formatTime(item.createdAt)}
                    </Text>
                    <Spacer />
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                      点击还原
                    </Text>
                  </HStack>
                  <Text font="subheadline">正则：{oneLine(item.pattern)}</Text>
                  <Text font="footnote" foregroundStyle="secondaryLabel">
                    文本：{oneLine(item.text, 96)}
                  </Text>
                </VStack>
              </Button>
            ))}
          </Section>
        ) : (
          <Section>
            <Text foregroundStyle="secondaryLabel">暂无历史记录</Text>
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}
