import {
  Button,
  Form,
  ForEach,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  VStack,
  useObservable,
  useState,
} from "scripting"

import type { FavoriteGroup } from "../types"
import { FavoriteGroupEditorView, type FavoriteGroupDraft } from "./FavoriteGroupEditorView"

const EditModeAPI = (globalThis as any).EditMode

export function FavoriteGroupManagerView(props: {
  initialGroups: FavoriteGroup[]
  initialCounts: Record<string, number>
  reloadCounts: () => Promise<Record<string, number>>
  embedded?: boolean
  onCreateGroup: (draft: FavoriteGroupDraft) => Promise<FavoriteGroup>
  onSaveGroup: (group: FavoriteGroup, draft: FavoriteGroupDraft) => Promise<FavoriteGroup>
  onDeleteGroup: (group: FavoriteGroup) => Promise<void>
  onReorderGroups: (groups: FavoriteGroup[]) => Promise<void>
}) {
  const dismiss = Navigation.useDismiss()
  const editMode = useObservable(() => EditModeAPI.inactive())
  const [groups, setGroups] = useState(props.initialGroups)
  const [counts, setCounts] = useState(props.initialCounts)
  const [editingGroup, setEditingGroup] = useState<FavoriteGroup | null>(null)
  const [editorPresented, setEditorPresented] = useState(false)
  const [saving, setSaving] = useState(false)

  function edit(group: FavoriteGroup) {
    setEditingGroup(group)
    setEditorPresented(true)
  }

  function add() {
    setEditingGroup(null)
    setEditorPresented(true)
  }

  function toggleEditMode() {
    editMode.setValue(editMode.value.isEditing ? EditModeAPI.inactive() : EditModeAPI.active())
  }

  async function save(draft: FavoriteGroupDraft) {
    if (saving) return
    setSaving(true)
    try {
      const nextGroup = editingGroup
        ? await props.onSaveGroup(editingGroup, draft)
        : await props.onCreateGroup(draft)
      setGroups((current) => editingGroup
        ? current.map((item) => item.id === editingGroup.id ? nextGroup : item)
        : [...current, nextGroup]
      )
      setEditorPresented(false)
      void props.reloadCounts().then(setCounts).catch((error) => console.warn("[CAIS] Favorite group counts unavailable", error))
    } finally {
      setSaving(false)
    }
  }

  function move(indices: number[], newOffset: number) {
    if (!indices.length) return
    const previous = groups
    const moving = indices.map((index) => groups[index]).filter((group): group is FavoriteGroup => group != null)
    const next = groups.filter((_, index) => !indices.includes(index))
    next.splice(Math.max(0, Math.min(next.length, newOffset)), 0, ...moving)
    setGroups(next)
    void props.onReorderGroups(next).catch(async (error: any) => {
      setGroups(previous)
      await Dialog.alert({ message: String(error?.message ?? error ?? "分组排序失败") })
    })
  }

  async function remove(group: FavoriteGroup) {
    const previousGroups = groups
    try {
      const confirmed = await Dialog.confirm({
        title: `删除“${group.title}”？`,
        message: "分组内的收藏会回到自动分类。",
        cancelLabel: "取消",
        confirmLabel: "删除",
      })
      if (!confirmed) return
      setGroups((current) => current.filter((item) => item.id !== group.id))
      await props.onDeleteGroup(group)
      void props.reloadCounts().then(setCounts).catch((error) => console.warn("[CAIS] Favorite group counts unavailable", error))
    } catch (error: any) {
      setGroups(previousGroups)
      await Dialog.alert({ message: String(error?.message ?? error ?? "分组删除失败") })
    }
  }

  const form = (
    <Form
      navigationTitle="分组管理"
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility={props.embedded ? "visible" : undefined}
      formStyle="grouped"
      environments={{ editMode }}
      toolbar={{
        topBarLeading: props.embedded
          ? undefined
          : <Button title="" systemImage="xmark" accessibilityLabel="关闭" action={() => dismiss()} />,
        topBarTrailing: (
          <HStack spacing={12}>
            <Button title="" systemImage="plus" accessibilityLabel="添加分组" action={add} />
            <Button
              title=""
              systemImage={editMode.value.isEditing ? "checkmark" : "arrow.up.arrow.down"}
              accessibilityLabel={editMode.value.isEditing ? "完成排序" : "排序分组"}
              action={toggleEditMode}
            />
          </HStack>
        ),
      }}
      navigationDestination={{
        isPresented: editorPresented,
        onChanged: (isPresented: boolean) => {
          setEditorPresented(isPresented)
          if (!isPresented) setEditingGroup(null)
        },
        content: (
          <FavoriteGroupEditorView
            key={editingGroup?.id ?? "new-favorite-group"}
            initial={editingGroup ?? undefined}
            embedded
            onCancel={() => setEditorPresented(false)}
            onSave={save}
          />
        ),
      }}
    >
      <Section
        header={<Text>收藏分组</Text>}
        footer={<Text>点击分组可修改规则；进入编辑模式后可拖动排序，左滑可以编辑或删除。</Text>}
      >
        {groups.length ? (
          <ForEach
            count={groups.length}
            onMove={move}
            itemBuilder={(index) => {
              const group = groups[index]
              return (
                <HStack
                  key={group.id}
                  spacing={12}
                  frame={{ maxWidth: "infinity", alignment: "center" as any }}
                  background="rgba(0,0,0,0.001)"
                  contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
                  onTapGesture={() => edit(group)}
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [
                      <Button
                        title=""
                        systemImage="square.and.pencil"
                        tint="systemOrange"
                        action={() => edit(group)}
                      />,
                      <Button
                        title=""
                        systemImage="trash"
                        tint="systemRed"
                        action={() => void remove(group)}
                      />,
                    ],
                  }}
                >
                  <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>{group.title}</Text>
                    <Text
                      font="caption"
                      foregroundStyle="secondaryLabel"
                      lineLimit={1}
                      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                      multilineTextAlignment="leading"
                    >
                      {`${group.ruleType === "regex" ? "正则" : "关键词"}${group.ruleType === "keyword" && group.ignoreCase ? "（忽略大小写）" : ""}：${group.pattern}`}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Text foregroundStyle="secondaryLabel" monospacedDigit>{counts[`favorite-group:${group.id}`] ?? 0}</Text>
                  <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
                </HStack>
              )
            }}
          />
        ) : (
          <Text foregroundStyle="secondaryLabel">暂无收藏分组</Text>
        )}
      </Section>
    </Form>
  )

  return props.embedded ? form : <NavigationStack>{form}</NavigationStack>
}
