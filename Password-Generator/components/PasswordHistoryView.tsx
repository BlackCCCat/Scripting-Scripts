import {
  Button,
  ForEach,
  HStack,
  Image,
  List,
  NavigationStack,
  Spacer,
  Text,
  VStack,
  useState,
  useObservable,
} from "scripting"

import {
  addPasswordHistory,
  clearPasswordHistory,
  formatDateTime,
  loadPasswordHistory,
  removePasswordHistoryByIds,
  type PasswordHistoryItem,
} from "../utils/history"
import {
  buildPasswordStyledText,
  evaluatePasswordStrength,
  summarizePasswordOptions,
} from "../utils/password"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

function HistoryRow(props: {
  item: PasswordHistoryItem
  onCopy: (item: PasswordHistoryItem) => void | Promise<void>
  selected: boolean
  selectionMode: boolean
  onToggleSelected: (id: string) => void
  onDelete: (id: string) => void
}) {
  const strength = evaluatePasswordStrength(props.item.password, props.item.options)
  return (
    <Button
      buttonStyle="plain"
      action={withHaptic(() => {
        if (props.selectionMode) props.onToggleSelected(props.item.id)
        else void props.onCopy(props.item)
      })}
      frame={{ maxWidth: "infinity" }}
      trailingSwipeActions={{
        allowsFullSwipe: true,
        actions: [
          <Button
            title="删除"
            role="destructive"
            action={() => props.onDelete(props.item.id)}
          />,
        ],
      }}
    >
      <VStack
        spacing={8}
        padding={{ top: 10, bottom: 10, leading: 10, trailing: 10 }}
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        background={{
          style: "secondarySystemBackground",
          shape: { type: "rect", cornerRadius: 12 },
        }}
      >
        <HStack frame={{ width: "100%" as any }}>
          {props.selectionMode ? (
            <HStack spacing={8}>
              <Image
                systemName={props.selected ? "checkmark.circle.fill" : "circle"}
                foregroundStyle={props.selected ? "systemBlue" : "secondaryLabel"}
              />
            </HStack>
          ) : null}
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {formatDateTime(props.item.copiedAt)}
          </Text>
          <Spacer />
          <Text font="caption2" foregroundStyle="secondaryLabel">
            点击再次复制
          </Text>
        </HStack>
        <Text
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          styledText={buildPasswordStyledText(props.item.password)}
          lineLimit={1}
        />
        <HStack frame={{ width: "100%" as any }}>
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {summarizePasswordOptions(props.item.options)}
          </Text>
          <Spacer />
          <Text font="caption2" foregroundStyle={strength.color}>
            {strength.score} 分
          </Text>
        </HStack>
      </VStack>
    </Button>
  )
}

export function PasswordHistoryView() {
  const items = useObservable<PasswordHistoryItem[]>(() => loadPasswordHistory())
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  async function copyItem(item: PasswordHistoryItem) {
    await Pasteboard.setString(item.password)
    const next = addPasswordHistory({
      id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      copiedAt: Date.now(),
      password: item.password,
      options: item.options,
    })
    items.setValue(next)
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ))
  }

  function removeIds(ids: string[]) {
    const next = removePasswordHistoryByIds(ids)
    items.setValue(next)
    setSelectedIds((current) => current.filter((item) => !ids.includes(item)))
  }

  function removeOne(id: string) {
    removeIds([id])
  }

  async function clearAll() {
    if (selectionMode) {
      if (!selectedIds.length) return
      const ok = await Dialog.confirm({
        title: "删除所选",
        message: `确定删除已勾选的 ${selectedIds.length} 条历史记录吗？`,
        confirmLabel: "删除",
        cancelLabel: "取消",
      })
      if (!ok) return
      removeIds(selectedIds)
      return
    }

    if (!items.value.length) return
    const ok = await Dialog.confirm({
      title: "清空历史",
      message: "确定清空所有复制历史吗？",
      confirmLabel: "清空",
      cancelLabel: "取消",
    })
    if (!ok) return
    clearPasswordHistory()
    items.setValue([])
    setSelectedIds([])
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => {
      const next = !current
      if (!next) setSelectedIds([])
      return next
    })
  }

  function selectAll() {
    setSelectedIds(items.value.map((item) => item.id))
  }

  function invertSelection() {
    const selected = new Set(selectedIds)
    setSelectedIds(items.value.map((item) => item.id).filter((id) => !selected.has(id)))
  }

  const toolbar = {
    topBarLeading: selectionMode ? (
      <HStack spacing={10}>
        <Button
          title="全选"
          action={withHaptic(selectAll)}
        />
        <Button
          title="反选"
          action={withHaptic(invertSelection)}
        />
      </HStack>
    ) : undefined,
    topBarTrailing: (
      <HStack spacing={10}>
        <Button
          title=""
          systemImage={selectionMode ? "checkmark.circle.fill" : "checkmark.circle"}
          action={withHaptic(toggleSelectionMode)}
        />
        <Button
          title=""
          systemImage="trash"
          disabled={selectionMode ? !selectedIds.length : !items.value.length}
          action={withHaptic(clearAll)}
        />
      </HStack>
    ),
  }

  return (
    <NavigationStack>
      {items.value.length ? (
        <List
          navigationTitle="历史记录"
          navigationBarTitleDisplayMode="inline"
          listStyle="insetGroup"
          toolbar={toolbar}
        >
          <ForEach
            data={items}
            builder={(item) => (
              <HistoryRow
                key={item.id}
                item={item}
                onCopy={copyItem}
                onDelete={removeOne}
                selectionMode={selectionMode}
                selected={selectedIds.includes(item.id)}
                onToggleSelected={toggleSelected}
              />
            )}
          />
        </List>
      ) : (
        <VStack
          navigationTitle="历史记录"
          navigationBarTitleDisplayMode="inline"
          toolbar={toolbar}
          spacing={10}
          padding={{ top: 56, bottom: 24, leading: 24, trailing: 24 }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" as any }}
        >
          <Image
            systemName="clock.arrow.circlepath"
            font="title2"
            foregroundStyle="secondaryLabel"
          />
          <VStack
            spacing={8}
            frame={{ maxWidth: "infinity", alignment: "center" as any }}
          >
            <Text frame={{ maxWidth: "infinity", alignment: "center" as any }}>
              暂无复制历史
            </Text>
            <Text
              font="caption"
              foregroundStyle="secondaryLabel"
              multilineTextAlignment="center"
              frame={{ maxWidth: "infinity", alignment: "center" as any }}
            >
              从主页面点击密码复制后，会自动出现在这里。
            </Text>
          </VStack>
        </VStack>
      )}
    </NavigationStack>
  )
}
