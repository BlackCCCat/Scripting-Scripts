import {
  Button,
  Group,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"

import {
  ensureStorage,
  loadModules,
  moduleFilePath,
  renameModuleFile,
  removeModuleFile,
  sortModules,
  type ModuleInfo,
  updateModuleMetadata,
} from "../utils/storage"
import { loadConfig, type AppConfig } from "../utils/config"
import { downloadModule } from "../utils/downloader"
import { EditModuleView } from "./EditModuleView"
import { SettingsView } from "./SettingsView"

function CenterRowButton(props: { title: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Button action={props.onPress} disabled={props.disabled}>
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



export function HomeView() {
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [stage, setStage] = useState("就绪")
  const [progress, setProgress] = useState("")
  const [busy, setBusy] = useState(false)
  const [filterCategory, setFilterCategory] = useState("全部")
  const categories = cfg.categories ?? []
  const filterOptions = ["全部", ...categories]
  const filterIdx = Math.max(0, filterOptions.indexOf(filterCategory))
  const filteredModules =
    filterCategory === "全部"
      ? modules
      : modules.filter((m) => m.category === filterCategory)

  async function refreshModules() {
    await ensureStorage()
    const list = sortModules(await loadModules())
    setModules(list)
  }

  useEffect(() => {
    void refreshModules()
  }, [])

  useEffect(() => {
    if (filterCategory === "全部") return
    if (!categories.includes(filterCategory)) {
      setFilterCategory("全部")
    }
  }, [categories, filterCategory])

  async function openSettings() {
    await Navigation.present({
      element: (
        <SettingsView
          initial={loadConfig()}
          onDone={(next) => {
            setCfg(next)
            void refreshModules()
          }}
        />
      ),
    })
    setCfg(loadConfig())
    await refreshModules()
  }

  async function addModule() {
    if (!categories.length) {
      await Dialog.alert({ message: "请先在设置页添加分类" })
      return
    }
    const info = await Navigation.present<ModuleInfo>({
      element: <EditModuleView title="添加模块" categories={categories} />,
    })
    if (!info) return

    const current = await loadModules()
    const nameExists = current.some((m) => m.name === info.name)
    const linkExists = current.some((m) => m.link === info.link)
    if (nameExists) {
      await Dialog.alert({ message: "模块名称已存在" })
      return
    }
    if (linkExists) {
      await Dialog.alert({ message: "下载链接已存在" })
      return
    }

    setBusy(true)
    setStage("添加模块中…")
    setProgress("")
    try {
      setStage(`下载模块：${info.name}`)
      const res = await downloadModule(info)
      if (!res.ok) {
        await Dialog.alert({ message: res.message ?? "下载失败" })
        setStage("添加完成（下载失败）")
      } else {
        setStage("添加完成（已下载）")
      }
      await refreshModules()
    } catch (e: any) {
      setStage(`添加失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function modifyModuleFor(target: ModuleInfo) {
    const current = await loadModules()
    const updated = await Navigation.present<ModuleInfo>({
      element: (
        <EditModuleView
          title="编辑模块"
          categories={categories}
          initial={target}
        />
      ),
    })
    if (!updated) return

    const idx = current.findIndex((m) => m.name === target.name && m.link === target.link)
    if (idx < 0) return

    const next = [...current]

    if (updated.name) {
      const nameExists = current.some((m, i) => i !== idx && m.name === updated.name)
      if (nameExists) {
        await Dialog.alert({ message: "模块名称已存在" })
        return
      }
    }

    if (updated.link) {
      const linkExists = current.some((m, i) => i !== idx && m.link === updated.link)
      if (linkExists) {
        await Dialog.alert({ message: "下载链接已存在" })
        return
      }
    }

    setBusy(true)
    setStage("修改模块中…")
    setProgress("")
    try {
      next[idx] = updated
      if (updated.name && updated.name !== target.name) {
        await renameModuleFile(target.name, updated.name)
      }
      await updateModuleMetadata(updated.name, {
        link: updated.link,
        category: updated.category,
      })
      await refreshModules()
      setStage("修改完成")
    } catch (e: any) {
      setStage(`修改失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function viewModuleContent(target: ModuleInfo) {
    try {
      const fm: any = (globalThis as any).FileManager
      if (!fm?.readAsString) throw new Error("FileManager.readAsString 不可用")
      const path = moduleFilePath(target.name)
      const text = await fm.readAsString(path)
      if (!text) {
        await Dialog.alert({ message: "模块内容为空或读取失败" })
        return
      }
      const controller = new (globalThis as any).EditorController({
        content: String(text),
        ext: "txt",
        readOnly: true,
      })
      try {
        await controller.present({ navigationTitle: target.name, fullscreen: true })
      } finally {
        controller.dispose()
      }
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function deleteModuleFor(target: ModuleInfo) {
    const ok = await Dialog.confirm({
      title: "删除模块",
      message: `确定删除模块：${target.name}？`,
    })
    if (!ok) return

    setBusy(true)
    setStage("删除模块中…")
    setProgress("")
    try {
      await removeModuleFile(target.name)
      await refreshModules()
      setStage("删除完成")
    } catch (e: any) {
      setStage(`删除失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function copyModuleLink(target: ModuleInfo) {
    try {
      await Pasteboard.setString(target.link)
      await Dialog.alert({ message: "链接已复制" })
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function downloadSingle(target: ModuleInfo) {
    await downloadBatch([target], `下载模块：${target.name}`)
  }

  async function downloadBatch(list: ModuleInfo[], title: string) {
    if (!list.length) {
      await Dialog.alert({ message: "暂无可下载模块" })
      return
    }

    setBusy(true)
    setStage(title)
    setProgress("")
    const errors: string[] = []
    let okCount = 0
    try {
      for (let i = 0; i < list.length; i += 1) {
        const m = list[i]
        setStage(`下载中 (${i + 1}/${list.length})：${m.name}`)
        const pct = Math.round(((i + 1) / list.length) * 100)
        setProgress(`${pct}%`)
        const res = await downloadModule(m)
        if (res.ok) okCount += 1
        else errors.push(res.message ?? `${m.name} 下载失败`)
      }
      if (errors.length) {
        setStage(`下载完成：成功 ${okCount}/${list.length}`)
        await Dialog.alert({
          title: "部分下载失败",
          message: errors.slice(0, 6).join("\n"),
        })
      } else {
        setStage(`下载完成：${okCount}/${list.length}`)
      }
    } catch (e: any) {
      setStage(`下载失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
      setProgress("")
    }
  }

  async function downloadAll() {
    const current = await loadModules()
    const list =
      filterCategory === "全部"
        ? current
        : current.filter((m) => m.category === filterCategory)
    await downloadBatch(list, "下载全部模块…")
  }


  return (
    <NavigationStack>
      <List
        navigationTitle={"Surge 模块管理"}
        navigationBarTitleDisplayMode={"inline"}
        listStyle={"insetGroup"}
        toolbar={{
          topBarTrailing: <Button title="" systemImage="gearshape" action={openSettings} />,
        }}
      >
        <Section header={<Text>操作</Text>}>
          <CenterRowButton title="添加模块" onPress={addModule} disabled={busy} />
          <CenterRowButton title="全部更新" onPress={downloadAll} disabled={busy} />
        </Section>

        <Section header={<Text>状态</Text>}>
          <Text>{stage}</Text>
          {progress ? <Text>进度：{progress}</Text> : null}
        </Section>

        <Section
          header={(
            <HStack>
              <Text>
                {filteredModules.length > 0 ? `模块列表(${filteredModules.length})` : "模块列表"}
              </Text>
              <Spacer />
              <Picker
                title="筛选分类"
                pickerStyle="menu"
                value={filterIdx}
                onChanged={(idx: number) => setFilterCategory(filterOptions[idx] ?? "全部")}
              >
                {filterOptions.map((c, idx) => (
                  <Text key={`${c}-${idx}`} tag={idx}>
                    {c}
                  </Text>
                ))}
              </Picker>
            </HStack>
          )}
        >
          {filteredModules.length === 0 ? (
            <Text>暂无模块</Text>
          ) : (
            filteredModules.map((m) => (
              <VStack
                key={`${m.name}-${m.link}`}
                contextMenu={{
                  menuItems: (
                    <Group>
                      <Button title="查看模块" action={() => viewModuleContent(m)} />
                      <Button title="复制链接" action={() => copyModuleLink(m)} />
                      <Button title="删除" role="destructive" action={() => deleteModuleFor(m)} />
                    </Group>
                  ),
                }}
                leadingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button title="更新" tint="systemGreen" action={() => downloadSingle(m)} />,
                  ],
                }}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button title="编辑" tint="systemOrange" action={() => modifyModuleFor(m)} />,
                  ],
                }}
              >
                <HStack>
                  <Text font="headline">{m.name}</Text>
                  <Spacer />
                  {m.category ? <Text>{m.category}</Text> : null}
                </HStack>
              </VStack>
            ))
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}
