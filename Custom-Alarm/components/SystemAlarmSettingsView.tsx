import {
  Button,
  List,
  NavigationStack,
  Section,
  Text,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"

import {
  GlassListNotice,
  glassListRowAppearance,
  GradientPage,
  GRADIENT_SCROLL_APPEARANCE,
  PlainListText,
} from "./PageAppearance"

type AdvancedCleanupItem = {
  alarmId: string
  timeLabel: string
  title: string
  summary: string
  detail: string
  sourceLabel: string
}

type AdvancedCleanupSnapshot = {
  items: AdvancedCleanupItem[]
  diagnosticItems: AdvancedCleanupItem[]
}

type AdvancedCleanupGroup = {
  timeLabel: string
  items: AdvancedCleanupItem[]
}

function buildGroups(items: AdvancedCleanupItem[]): AdvancedCleanupGroup[] {
  const map = new Map<string, AdvancedCleanupItem[]>()
  for (const item of items) {
    const current = map.get(item.timeLabel) ?? []
    current.push(item)
    map.set(item.timeLabel, current)
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([timeLabel, groupedItems]) => ({
      timeLabel,
      items: groupedItems,
    }))
}

function renderCleanupGroup(group: AdvancedCleanupGroup, onDelete: () => void, diagnostic = false) {
  const { timeLabel, items } = group
  const heading = `${diagnostic ? "全部实例 · " : ""}${timeLabel} · ${items.length}`
  return (
    <Section
      key={`${diagnostic ? "diagnostic" : "cleanup"}-${timeLabel}`}
      listSectionSeparator="hidden"
    >
      <PlainListText heading text={heading} />
      {items.map((item) => (
        <VStack
          key={item.alarmId}
          alignment="leading"
          spacing={4}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          padding={{ top: 10, bottom: 10, leading: 16, trailing: 16 }}
          {...glassListRowAppearance()}
        >
          <Text font="subheadline">{item.title}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{item.summary}</Text>
          <Text font="caption" foregroundStyle="tertiaryLabel">{item.detail}</Text>
          <Text font="caption2" foregroundStyle="tertiaryLabel">{item.sourceLabel}</Text>
        </VStack>
      ))}
      <VStack
        frame={{ maxWidth: "infinity", minHeight: 44, alignment: "leading" }}
        padding={{ leading: 16, trailing: 16 }}
        {...glassListRowAppearance()}
      >
        <Button
          title={`${diagnostic ? "删除" : "清理"} ${timeLabel} 的全部实例`}
          buttonStyle="borderless"
          role="destructive"
          tint="red"
          action={onDelete}
        />
      </VStack>
    </Section>
  )
}

export function SystemAlarmSettingsView(props: {
  items: AdvancedCleanupItem[]
  diagnosticItems: AdvancedCleanupItem[]
  onRefresh: () => AdvancedCleanupSnapshot | void | Promise<AdvancedCleanupSnapshot | void>
  onDeleteIds: (ids: string[]) => AdvancedCleanupSnapshot | void | Promise<AdvancedCleanupSnapshot | void>
}) {
  const [items, setItems] = useState(props.items)
  const [diagnosticItems, setDiagnosticItems] = useState(props.diagnosticItems)

  useEffect(() => {
    setItems(props.items)
  }, [props.items])

  useEffect(() => {
    setDiagnosticItems(props.diagnosticItems)
  }, [props.diagnosticItems])

  const groups = useMemo(() => buildGroups(items), [items])
  const diagnosticGroups = useMemo(() => buildGroups(diagnosticItems), [diagnosticItems])

  function applySnapshot(snapshot: AdvancedCleanupSnapshot | void) {
    if (!snapshot) return
    setItems(snapshot.items)
    setDiagnosticItems(snapshot.diagnosticItems)
  }

  async function refresh() {
    applySnapshot(await props.onRefresh())
  }

  async function deleteGroup(group: AdvancedCleanupGroup) {
    const ok = await Dialog.confirm({
      message: `确定清理 ${group.timeLabel} 的 ${group.items.length} 个系统实例吗？`,
    })
    if (!ok) return
    applySnapshot(await props.onDeleteIds(group.items.map((item) => item.alarmId)))
  }

  async function deleteDiagnosticGroup(group: AdvancedCleanupGroup) {
    const ok = await Dialog.confirm({
      message: `确定删除 ${group.timeLabel} 的 ${group.items.length} 个系统实例吗？此操作可能影响当前首页仍在使用的闹钟。`,
    })
    if (!ok) return
    applySnapshot(await props.onDeleteIds(group.items.map((item) => item.alarmId)))
  }

  const list = (
    <List
      navigationTitle="高级清理"
      navigationBarTitleDisplayMode="inline"
      listStyle="plain"
      {...GRADIENT_SCROLL_APPEARANCE}
      toolbar={{
        topBarTrailing: (
          <Button
            title=""
            systemImage="arrow.clockwise"
            action={() => {
              void refresh()
            }}
          />
        ),
      }}
    >
      <GlassListNotice text={`当前共发现 ${items.length} 个残留实例`} />
      <PlainListText text="首页删除后由于意外错误仍残留在系统中的闹钟实例" />

      {groups.length ? (
        groups.map((group) => renderCleanupGroup(group, () => { void deleteGroup(group) }))
      ) : (
        <GlassListNotice text="当前没有需要手动清理的残留闹钟。" />
      )}

      <GlassListNotice text={`当前共扫描到 ${diagnosticItems.length} 个系统实例`} />
      <PlainListText text="这里会列出系统接口当前返回的全部闹钟实例。它们不一定都属于首页里的闹钟，删除前请先确认。" />

      {diagnosticGroups.length ? (
        diagnosticGroups.map((group) => renderCleanupGroup(group, () => { void deleteDiagnosticGroup(group) }, true))
      ) : (
        <GlassListNotice text="当前没有扫描到任何系统闹钟实例。" />
      )}
    </List>
  )

  return (
    <NavigationStack>
      <GradientPage>{list}</GradientPage>
    </NavigationStack>
  )
}
