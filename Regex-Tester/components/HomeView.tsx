import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Section,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  useState,
} from "scripting"

import { RegexEditorView } from "./RegexEditorView"
import { RegexListRow } from "./RegexListRow"
import { RegexTemplatePickerView } from "./RegexTemplatePickerView"
import {
  loadRegexLibrary,
  removeRegexItemById,
  type RegexItem,
} from "../utils/library"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

function matchesQuery(item: RegexItem, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [item.name, item.pattern, item.sampleText, item.replacementTemplate].join("\n").toLowerCase()
  return haystack.includes(q)
}

export function HomeView() {
  const dismiss = Navigation.useDismiss()
  const [query, setQuery] = useState("")
  const [reloadToken, setReloadToken] = useState(0)

  void reloadToken
  const items = loadRegexLibrary()
  const filtered = items.filter((item) => matchesQuery(item, query))

  async function closeHome() {
    dismiss()
  }

  async function openTemplates() {
    await Navigation.present({
      element: <RegexTemplatePickerView />,
    })
    setReloadToken((value) => value + 1)
  }

  async function deleteItem(item: RegexItem) {
    removeRegexItemById(item.id)
    setReloadToken((value) => value + 1)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="RegEx Test"
        navigationBarTitleDisplayMode="large"
        searchable={{ value: query, onChanged: setQuery }}
        toolbar={(
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button
                title=""
                systemImage="xmark"
                action={withHaptic(closeHome)}
              />
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <HStack spacing={12}>
                <Button title="" systemImage="text.badge.star" action={withHaptic(openTemplates)} />
                <NavigationLink destination={<RegexEditorView isNew />}>
                  <Image systemName="plus.circle.fill" font="title3" />
                </NavigationLink>
              </HStack>
            </ToolbarItem>
          </Toolbar>
        )}
        listStyle="insetGroup"
      >
        {filtered.length ? (
          <Section header={<Text>{query.trim() ? `搜索结果 ${filtered.length} 条` : `已保存 ${filtered.length} 条`}</Text>}>
            {filtered.map((item) => (
              <NavigationLink
                key={item.id}
                destination={<RegexEditorView item={item} />}
                trailingSwipeActions={{
                  allowsFullSwipe: true,
                  actions: [
                    <Button title="删除" role="destructive" action={withHaptic(() => deleteItem(item))} />,
                  ],
                }}
              >
                <RegexListRow item={item} />
              </NavigationLink>
            ))}
          </Section>
        ) : (
          <Section>
            <VStack
              spacing={12}
              padding={{ top: 18, bottom: 18 }}
              frame={{ maxWidth: "infinity", alignment: "center" as any }}
            >
              <Text foregroundStyle="secondaryLabel">
                {query.trim() ? "没有符合条件的正则" : "还没有保存任何正则"}
              </Text>
              {!query.trim() ? (
                <VStack spacing={12}>
                  <NavigationLink destination={<RegexEditorView isNew />}>
                    <Text>新建空白</Text>
                  </NavigationLink>
                  <Button title="从模板创建" action={withHaptic(openTemplates)} />
                </VStack>
              ) : null}
            </VStack>
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}
