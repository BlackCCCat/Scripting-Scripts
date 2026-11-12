import { Button, Divider, EmptyView, Grid, GridRow, Group, HStack, Image, List, ProgressView, Section, Spacer, Text, TextField, VStack, useEffect, useState } from "scripting"
import { loadSubscriptions, readSubscriptionFile, removeSubscriptionFile, saveSubscriptions, updateSubscription, type Subscription, type SubscriptionEditorResult } from "../utils/subscriptions"
import { SubscriptionEditorView } from "./SubscriptionEditorView"
import { SubscriptionFileEditorView } from "./SubscriptionFileEditorView"
import { BatchCompactButton } from "./BatchCompactButton"
import type { TabActionSink } from "../shared/TabActions"

export function SubscriptionsView(props: { onActionsChange: TabActionSink }) {
  const glass = parseInt(Device.systemVersion, 10) >= 26
  const [items, setItems] = useState<Subscription[]>(() => loadSubscriptions())
  const [busyName, setBusyName] = useState("")
  const [editorInitial, setEditorInitial] = useState<Subscription | undefined>(undefined)
  const [editorVisible, setEditorVisible] = useState(false)
  const [editorSession, setEditorSession] = useState(0)
  const [fileEditor, setFileEditor] = useState<{ item: Subscription; content: string } | null>(null)
  const [fileEditorVisible, setFileEditorVisible] = useState(false)
  const [fileSession, setFileSession] = useState(0)
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState("")
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  const query = searchText.trim().toLowerCase()
  const filteredItems = items.filter(item => !query || [item.name, item.url, item.fileName].some(value => value.toLowerCase().includes(query)))
  const selectedItems = filteredItems.filter(item => selectedNames.has(item.name))

  function exitSelectionMode() {
    setSelectionMode(false)
    setSelectedNames(new Set())
  }

  function toggleSelected(name: string) {
    setSelectedNames(previous => {
      const next = new Set(previous)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function selectAll() {
    if (filteredItems.length && filteredItems.every(item => selectedNames.has(item.name))) {
      setSelectedNames(new Set())
    } else setSelectedNames(new Set(filteredItems.map(item => item.name)))
  }

  function invertSelection() {
    setSelectedNames(previous => {
      const next = new Set(previous)
      for (const item of filteredItems) {
        if (next.has(item.name)) next.delete(item.name)
        else next.add(item.name)
      }
      return next
    })
  }

  useEffect(() => {
    props.onActionsChange({
      add: () => edit(),
      update: () => { void refreshAll() },
      canAdd: !busyName,
      canUpdate: !busyName && items.length > 0,
      search: () => {
        if (searchVisible || searchText.trim()) {
          setSearchVisible(false)
          setSearchText("")
        } else setSearchVisible(true)
      },
      batch: () => selectionMode ? exitSelectionMode() : setSelectionMode(true),
      searchActive: searchVisible || !!searchText.trim(),
      batchActive: selectionMode,
    })
    return () => props.onActionsChange(null)
  }, [props.onActionsChange, busyName, items, searchVisible, searchText, selectionMode])

  async function refreshAll() {
    const current = loadSubscriptions()
    if (!current.length) {
      await Dialog.alert({ message: "暂无订阅，长按底部「订阅」添加" })
      return
    }
    setBusyName("全部订阅")
    const failed: string[] = []
    let updated = 0
    try {
      for (const item of current) {
        try {
          setBusyName(item.name)
          const result = await updateSubscription(item, false)
          item.nodeCount = result.count
          updated += 1
          saveSubscriptions(current)
          setItems([...current])
        } catch (error: any) {
          failed.push(`${item.name}：${String(error?.message ?? error)}`)
        }
      }
      await Dialog.alert({
        title: failed.length ? "订阅更新完成，部分失败" : "订阅更新完成",
        message: `成功 ${updated}/${current.length}${failed.length ? `\n\n${failed.join("\n")}` : ""}`,
      })
    } finally {
      setBusyName("")
    }
  }

  function edit(initial?: Subscription) {
    setEditorInitial(initial)
    setEditorSession(value => value + 1)
    setEditorVisible(true)
  }

  async function saveSubmitted(submitted: SubscriptionEditorResult): Promise<boolean> {
    const { subscription: result, overwriteExisting } = submitted
    const initial = editorInitial
    const current = loadSubscriptions()
    const other = current.filter((entry) => entry.name !== initial?.name)
    if (other.some((entry) => entry.name === result.name || entry.fileName === result.fileName)) {
      await Dialog.alert({ message: "订阅名称已存在，或该名称对应的文件已被其他订阅使用" })
      return false
    }
    if (!initial) {
      setBusyName(result.name)
      void (async () => {
        try {
          const fetched = await updateSubscription(result, true, overwriteExisting)
          const saved = { ...result, nodeCount: fetched.count }
          const next = [...loadSubscriptions(), saved]
          saveSubscriptions(next)
          setItems(next)
        } catch (error: any) {
          setBusyName("")
          await Dialog.alert({ title: "订阅保存失败", message: String(error?.message ?? error) })
        } finally {
          setBusyName("")
        }
      })()
      return true
    }
    try {
      const next = current.map((entry) => entry.name === initial.name ? { ...entry, ...result } : entry)
      saveSubscriptions(next)
      setItems(next)
      return true
    } catch (error: any) {
      await Dialog.alert({ title: "订阅保存失败", message: String(error?.message ?? error) })
      return false
    }
  }

  async function openFileEditor(item: Subscription) {
    try {
      const content = await readSubscriptionFile(item)
      setFileEditor({ item, content })
      setFileSession(value => value + 1)
      setFileEditorVisible(true)
    } catch (error: any) {
      await Dialog.alert({ title: "无法读取订阅文件", message: String(error?.message ?? error) })
    }
  }

  function fileSaved() {
    if (!fileEditor) return
    setFileEditorVisible(false)
    try {
      const next = loadSubscriptions().map(entry => entry.name === fileEditor.item.name ? { ...entry, nodeCount: undefined } : entry)
      saveSubscriptions(next)
      setItems(next)
    } catch (error: any) {
      void Dialog.alert({ message: `文件已保存，但节点统计未能更新：${String(error?.message ?? error)}` })
    }
  }

  async function refresh(item: Subscription) {
    try {
      setBusyName(item.name)
      const result = await updateSubscription(item, false)
      const next = loadSubscriptions().map((entry) => entry.name === item.name
        ? { ...entry, nodeCount: result.count }
        : entry)
      saveSubscriptions(next)
      setItems(next)
      setBusyName("")
      await Dialog.alert({ message: `已更新 ${item.fileName}.dconf：${result.count} 个节点${result.skipped ? `，跳过 ${result.skipped} 行` : ""}` })
    } catch (error: any) {
      setBusyName("")
      await Dialog.alert({ title: "订阅更新失败", message: String(error?.message ?? error) })
    }
  }

  async function remove(item: Subscription) {
    const choice = await Dialog.actionSheet({
      title: "删除订阅？",
      message: `确定删除「${item.name}」？`,
      cancelButton: true,
      actions: [
        { label: "删除订阅，保留文件", destructive: true },
        { label: "删除订阅及文件", destructive: true },
      ],
    })
    if (choice === 0) await confirmRemoval({ names: [item.name], batch: false }, false)
    else if (choice === 1) await confirmRemoval({ names: [item.name], batch: false }, true)
  }

  async function confirmRemoval(target: { names: string[]; batch: boolean }, deleteFiles: boolean) {
    try {
      const current = loadSubscriptions()
      const names = new Set(target.names)
      const targets = current.filter(entry => names.has(entry.name))
      if (deleteFiles) {
        if (targets.some(item => current.some(other => !names.has(other.name) && other.fileName === item.fileName))) {
          throw new Error("所选文件仍被其他订阅使用，无法删除")
        }
        for (const item of targets) await removeSubscriptionFile(item)
      }
      const next = current.filter(entry => !names.has(entry.name))
      saveSubscriptions(next)
      setItems(next)
      if (target.batch) exitSelectionMode()
    } catch (error: any) {
      await Dialog.alert({ title: target.batch ? "批量删除失败" : "删除订阅失败", message: String(error?.message ?? error) })
    }
  }

  async function refreshSelected() {
    if (!selectedItems.length || busyName) return
    const selected = selectedItems.map(item => item.name)
    const current = loadSubscriptions()
    const failed: string[] = []
    let updated = 0
    try {
      setBusyName("已选订阅")
      for (const item of current.filter(entry => selected.includes(entry.name))) {
        try {
          setBusyName(item.name)
          const result = await updateSubscription(item, false)
          item.nodeCount = result.count
          updated++
          saveSubscriptions(current)
          setItems([...current])
        } catch (error: any) {
          failed.push(`${item.name}：${String(error?.message ?? error)}`)
        }
      }
    } finally {
      setBusyName("")
    }
    await Dialog.alert({ title: failed.length ? "部分订阅更新失败" : "批量更新完成",
      message: `成功 ${updated}/${selected.length}${failed.length ? `\n\n${failed.join("\n")}` : ""}` })
  }

  async function removeSelected() {
    if (!selectedItems.length || busyName) return
    const target = { names: selectedItems.map(item => item.name), batch: true }
    const choice = await Dialog.actionSheet({
      title: `删除已选的 ${target.names.length} 个订阅？`,
      message: "请选择是否同时删除对应的 .dconf 文件。",
      cancelButton: true,
      actions: [
        { label: "删除订阅，保留文件", destructive: true },
        { label: "删除订阅及文件", destructive: true },
      ],
    })
    if (choice === 0) await confirmRemoval(target, false)
    else if (choice === 1) await confirmRemoval(target, true)
  }

  return (
      <List
        listStyle="insetGroup"
        sheet={[
          {
            isPresented: editorVisible,
            onChanged: setEditorVisible,
            content: <SubscriptionEditorView key={editorSession} initial={editorInitial} busy={!!busyName}
              onCancel={() => setEditorVisible(false)} onSave={saveSubmitted} />,
          },
          {
            isPresented: fileEditorVisible,
            onChanged: setFileEditorVisible,
            content: fileEditor ? <SubscriptionFileEditorView key={fileSession} item={fileEditor.item}
              content={fileEditor.content} onSaved={fileSaved} /> : <EmptyView />,
          },
        ]}
        safeAreaInset={{
          top: {
            spacing: 0,
            content: <VStack padding={{ top: 8, bottom: 8, leading: 16, trailing: 16 }} frame={{ maxWidth: "infinity" }}>
              <VStack
                spacing={6}
                padding={{ top: 14, bottom: 14, leading: 16, trailing: 16 }}
                frame={{ maxWidth: "infinity" }}
                background={glass ? "clear" : "secondarySystemGroupedBackground"}
                glassEffect={glass ? { glass: UIGlass.regular(), shape: { type: "rect", cornerRadius: 24 } } : false}
                clipShape={glass ? undefined : { type: "rect", cornerRadius: 24 }}
              >
                <HStack spacing={0}>
                  <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                    <Text font="title3" fontWeight="semibold">{items.length}</Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel">订阅</Text>
                  </VStack>
                  <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                    <Text font="title3" fontWeight="semibold">{items.reduce((sum, it) => sum + (it.nodeCount ?? 0), 0)}</Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel">已解析节点</Text>
                  </VStack>
                </HStack>
                <Text font="caption2" foregroundStyle="secondaryLabel">订阅文件保存至所选书签文件夹</Text>
              </VStack>
              {searchVisible || !!query ? (
                <HStack spacing={8} padding={{ top: 10, bottom: 10, leading: 18, trailing: 18 }}
                  frame={{ maxWidth: "infinity" }}
                  background={glass ? "clear" : "secondarySystemGroupedBackground"}
                  glassEffect={glass ? { glass: UIGlass.regular(), shape: { type: "rect", cornerRadius: 20 } } : false}
                  clipShape={glass ? undefined : { type: "rect", cornerRadius: 20 }}>
                  <TextField title="搜索订阅" value={searchText} onChanged={setSearchText} prompt="名称、链接或文件名" />
                  {query ? <Button title="" systemImage="xmark.circle.fill" action={() => setSearchText("")} /> : null}
                </HStack>
              ) : null}
              {selectionMode ? (
                <VStack spacing={8} padding={{ top: 13, bottom: 12, leading: 18, trailing: 18 }}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                  background={glass ? "clear" : "secondarySystemGroupedBackground"}
                  glassEffect={glass ? { glass: UIGlass.regular(), shape: { type: "rect", cornerRadius: 24 } } : false}
                  clipShape={glass ? undefined : { type: "rect", cornerRadius: 24 }}>
                  <HStack><Text font="headline">批量操作</Text><Spacer /><Text foregroundStyle="secondaryLabel">已选 {selectedItems.length}</Text></HStack>
                  <Grid horizontalSpacing={6} frame={{ maxWidth: "infinity" }}>
                    <GridRow>
                      <BatchCompactButton title="全选" systemImage="checkmark.circle" onPress={selectAll} />
                      <BatchCompactButton title="反选" systemImage="circle.lefthalf.filled" onPress={invertSelection} />
                      <BatchCompactButton title="更新" systemImage="arrow.triangle.2.circlepath" tint="systemGreen"
                        disabled={!!busyName || !selectedItems.length} onPress={refreshSelected} />
                      <BatchCompactButton title="删除" systemImage="trash" tint="systemRed"
                        disabled={!!busyName || !selectedItems.length} onPress={removeSelected} />
                      <BatchCompactButton title="完成" systemImage="checkmark" onPress={exitSelectionMode} />
                    </GridRow>
                  </Grid>
                </VStack>
              ) : null}
            </VStack>,
          },
        }}
        overlay={busyName ? (
          <VStack
            spacing={12}
            padding={20}
            background={glass ? "clear" : "secondarySystemGroupedBackground"}
            glassEffect={glass ? { glass: UIGlass.regular(), shape: { type: "rect", cornerRadius: 18 } } : false}
            clipShape={glass ? undefined : { type: "rect", cornerRadius: 18 }}
          >
            <ProgressView progressViewStyle="circular" />
            <Text>正在处理 {busyName}…</Text>
          </VStack>
        ) : undefined}
      >
        <Section header={<Text>{filteredItems.length ? `订阅列表(${filteredItems.length})` : "订阅列表"}</Text>}>
          {filteredItems.length ? filteredItems.map((item, index) => (
            <VStack
              key={item.name}
              alignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
              listRowInsets={0}
              listRowSeparator="hidden"
              contextMenu={selectionMode ? undefined : { menuItems: <Group>
                <Button title="编辑订阅" systemImage="pencil" action={() => { HapticFeedback.mediumImpact(); void edit(item) }} />
                <Button title="编辑保存的文件" systemImage="doc.text" action={() => { HapticFeedback.mediumImpact(); void openFileEditor(item) }} />
                <Button title="更新节点" systemImage="arrow.triangle.2.circlepath" action={() => { HapticFeedback.mediumImpact(); void refresh(item) }} />
                <Button title="删除订阅" systemImage="trash" tint="systemRed" action={() => { HapticFeedback.mediumImpact(); void remove(item) }} />
              </Group> }}
              leadingSwipeActions={{
                allowsFullSwipe: false,
                actions: selectionMode ? [] : [
                  <Button
                    title="更新"
                    systemImage="arrow.triangle.2.circlepath"
                    tint="systemGreen"
                    disabled={!!busyName}
                    action={() => {
                      HapticFeedback.mediumImpact()
                      void refresh(item)
                    }}
                  />,
                ],
              }}
              trailingSwipeActions={{
                allowsFullSwipe: false,
                actions: selectionMode ? [] : [
                  <Button title="编辑" systemImage="pencil" tint="systemOrange" action={() => { HapticFeedback.mediumImpact(); void edit(item) }} />,
                  <Button title="删除" systemImage="trash" tint="systemRed" action={() => { HapticFeedback.mediumImpact(); void remove(item) }} />,
                ],
              }}
            >
              <HStack spacing={12} alignment="center" padding={{ top: 8, bottom: 8, leading: 16, trailing: 16 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                {selectionMode ? <Button title="" systemImage={selectedNames.has(item.name) ? "checkmark.circle.fill" : "circle"}
                  tint="systemBlue" action={() => { HapticFeedback.mediumImpact(); toggleSelected(item.name) }} /> : null}
                <VStack
                  frame={{ width: 36, height: 36 }}
                  background="rgba(0, 122, 255, 0.12)"
                  clipShape={{ type: "rect", cornerRadius: 9 } as any}
                  alignment="center"
                >
                  <Image systemName="airplane" font={18} foregroundStyle="systemBlue" />
                </VStack>
                <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Text font="headline" lineLimit={1}>{item.name}</Text>
                  {item.nodeCount != null ? (
                    <Text font="caption2" foregroundStyle="secondaryLabel">{item.nodeCount} 节点</Text>
                  ) : null}
                </VStack>
              </HStack>
              {index < filteredItems.length - 1 ? <Divider /> : null}
            </VStack>
          )) : <Text foregroundStyle="secondaryLabel">{query ? "暂无匹配订阅" : "暂无订阅，长按底部「订阅」添加"}</Text>}
        </Section>
      </List>
  )
}
