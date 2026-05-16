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

        <Section footer={<Text>这里会列出系统接口当前返回的全部闹钟实例。它们不一定都属于首页里的闹钟，删除前请先确认。</Text>}>
          <Text foregroundStyle="secondaryLabel">
            当前共扫描到 {diagnosticItems.length} 个系统实例
          </Text>
        </Section>

        {diagnosticGroups.length ? (
          diagnosticGroups.map((group) => (
            <Section
              key={`diagnostic-${group.timeLabel}`}
              header={<Text>{`全部实例 · ${group.timeLabel} · ${group.items.length}`}</Text>}
            >
              {group.items.map((item) => (
                <VStack key={`diagnostic-${item.alarmId}`} spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
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
                title={`删除 ${group.timeLabel} 的全部实例`}
                role="destructive"
                tint="red"
                action={() => {
                  void deleteDiagnosticGroup(group)
                }}
              />
            </Section>
          ))
        ) : (
          <Section>
            <Text foregroundStyle="secondaryLabel">当前没有扫描到任何系统闹钟实例。</Text>
          </Section>
        )}
      </Form>
    </NavigationStack>
  )
}
