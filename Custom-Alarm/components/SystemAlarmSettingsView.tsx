import {
  Button,
  Form,
  NavigationStack,
  Section,
  Text,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"

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

export function SystemAlarmSettingsView(props: {
  items: AdvancedCleanupItem[]
  onRefresh: () => AdvancedCleanupSnapshot | void | Promise<AdvancedCleanupSnapshot | void>
  onDeleteIds: (ids: string[]) => AdvancedCleanupSnapshot | void | Promise<AdvancedCleanupSnapshot | void>
}) {
  const [items, setItems] = useState(props.items)

  useEffect(() => {
    setItems(props.items)
  }, [props.items])

  const groups = useMemo(() => buildGroups(items), [items])

  function applySnapshot(snapshot: AdvancedCleanupSnapshot | void) {
    if (!snapshot) return
    setItems(snapshot.items)
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

  return (
    <NavigationStack>
      <Form
        navigationTitle="高级清理"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
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
        <Section footer={<Text>首页删除后由于意外错误仍残留在系统中的闹钟实例</Text>}>
          <Text foregroundStyle="secondaryLabel">
            当前共发现 {items.length} 个残留实例
          </Text>
        </Section>

        {groups.length ? (
          groups.map((group) => (
            <Section
              key={group.timeLabel}
              header={<Text>{`${group.timeLabel} · ${group.items.length}`}</Text>}
            >
              {group.items.map((item) => (
                <VStack key={item.alarmId} spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  <Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    {item.title}
                  </Text>
                  <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    {item.summary}
                  </Text>
                  <Text font="caption" foregroundStyle="tertiaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    {item.detail}
                  </Text>
                  <Text font="caption2" foregroundStyle="tertiaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    {item.sourceLabel}
                  </Text>
                </VStack>
              ))}

              <Button
                title={`清理 ${group.timeLabel} 的全部实例`}
                role="destructive"
                tint="red"
                action={() => {
                  void deleteGroup(group)
                }}
              />
            </Section>
          ))
        ) : (
          <Section>
            <Text foregroundStyle="secondaryLabel">当前没有需要手动清理的残留闹钟。</Text>
          </Section>
        )}
      </Form>
    </NavigationStack>
  )
}
