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
  useMemo,
  useState,
} from "scripting"

import {
  ensureStorage,
  loadModules,
  moduleFilePath,
  detectLinkPrefix,
  renameModuleFile,
  removeModuleFile,
  sortModules,
  type ModuleInfo,
  updateModuleMetadata,
  listDirectSubDirs,
  saveLocalModule,
  getModulesDirResolved,
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
  const withButtonHaptic = (action: () => void | Promise<void>) => () => {
    HapticFeedback.mediumImpact()
    void action()
  }
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [stage, setStage] = useState("就绪")
  const [progress, setProgress] = useState("")
  const [busy, setBusy] = useState(false)
  const [resolvedBaseDir, setResolvedBaseDir] = useState("")
  const [filterCategory, setFilterCategory] = useState("全部")
  const categories = cfg.categories ?? []
  const filterOptions = ["全部", ...categories]
  const filterIdx = Math.max(0, filterOptions.indexOf(filterCategory))
  const baseDir = resolvedBaseDir || cfg.baseDir
  const dirOptions = useMemo(() => {
    const set = new Set<string>()
    for (const m of modules) {
      const p = m.filePath ? String(m.filePath) : ""
      if (!p) continue
      const rel = baseDir ? p.replace(baseDir, "").replace(/^\/+/, "") : p
      const dir = rel.includes("/") ? rel.split("/")[0] : ""
      if (dir) set.add(dir)
    }
    return ["全部", ...Array.from(set)]
  }, [modules, baseDir])
  const [filterDir, setFilterDir] = useState("全部")

  function getTopDir(m: ModuleInfo): string {
    const p = m.filePath ? String(m.filePath) : ""
    if (!p) return ""
    const rel = baseDir ? p.replace(baseDir, "").replace(/^\/+/, "") : p
    return rel.includes("/") ? rel.split("/")[0] : ""
  }

  function matchFilters(m: ModuleInfo): boolean {
    const catOk = filterCategory === "全部" ? true : m.category === filterCategory
    const dirOk = filterDir === "全部" ? true : getTopDir(m) === filterDir
    return catOk && dirOk
  }

  const filteredModules = modules.filter((m) => {
    return matchFilters(m)
  })
  const onlyLocalFiltered =
    filteredModules.length > 0 && filteredModules.every((m) => m.isLocal || !m.link)

  function inferSaveDir(m: ModuleInfo): string | undefined {
    if (!m.filePath) return undefined
    const idx = String(m.filePath).lastIndexOf("/")
    return idx > 0 ? String(m.filePath).slice(0, idx) : undefined
  }

  async function refreshModules() {
    await ensureStorage()
    const resolved = await getModulesDirResolved()
    setResolvedBaseDir(resolved)
    const list = sortModules(await loadModules())
    setModules(list)
  }

  useEffect(() => {
    void refreshModules()
  }, [])

  useEffect(() => {
    if (filterDir !== "全部" && !dirOptions.includes(filterDir)) {
      setFilterDir("全部")
    }
  }, [dirOptions, filterDir])

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
    const subDirs = await listDirectSubDirs()
    const info = await Navigation.present<ModuleInfo>({
      element: <EditModuleView title="添加模块" categories={categories} saveDirs={subDirs} />,
    })
    if (!info) return

    const current = await loadModules()
    const nameExists = current.some((m) => m.name === info.name)
    const linkExists = info.link ? current.some((m) => m.link === info.link) : false
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
      if (info.isLocal) {
        setStage(`保存模块：${info.name}`)
        await saveLocalModule(info, info.content ?? "")
        setStage("添加完成（已保存）")
      } else {
        setStage(`下载模块：${info.name}`)
        const res = await downloadModule(info)
        if (!res.ok) {
          await Dialog.alert({ message: res.message ?? "下载失败" })
          setStage("添加完成（下载失败）")
        } else {
          setStage("添加完成（已下载）")
        }
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
    const merged: ModuleInfo = { ...target, ...updated }

    if (merged.name) {
      const nameExists = current.some((m, i) => i !== idx && m.name === merged.name)
      if (nameExists) {
        await Dialog.alert({ message: "模块名称已存在" })
        return
      }
    }

    if (merged.link) {
      const linkExists = current.some((m, i) => i !== idx && m.link === merged.link)
      if (linkExists) {
        await Dialog.alert({ message: "下载链接已存在" })
        return
      }
    }

    setBusy(true)
    setStage("修改模块中…")
    setProgress("")
    try {
      next[idx] = merged
      if (merged.name && merged.name !== target.name) {
        await renameModuleFile(target, merged.name)
      }
      if (merged.isLocal || !merged.link) {
        await saveLocalModule(
          { ...merged, saveDir: inferSaveDir(merged) },
          merged.content ?? ""
        )
      } else {
        await updateModuleMetadata(merged, {
          link: merged.link,
          category: merged.category,
          local: false,
        })
      }
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
      const path = target.filePath ?? moduleFilePath(target.name)
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
      await removeModuleFile(target)
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
    if (!target.link) {
      await Dialog.alert({ message: "本地模块无下载链接，无法更新" })
      return
    }
    await downloadBatch([target], `下载模块：${target.name}`)
  }

  async function downloadBatch(list: ModuleInfo[], title: string) {
    const downloadable = list.filter((m) => !!m.link)
    if (!downloadable.length) {
      await Dialog.alert({ message: "暂无可下载模块" })
      return
    }

    setBusy(true)
    setStage(title)
    setProgress("")
    const errors: string[] = []
    let okCount = 0
    try {
      for (let i = 0; i < downloadable.length; i += 1) {
        const m = downloadable[i]
        setStage(`下载中 (${i + 1}/${downloadable.length})：${m.name}`)
        const pct = Math.round(((i + 1) / downloadable.length) * 100)
        setProgress(`${pct}%`)
        const linkPrefix = await detectLinkPrefix(m)
        const res = await downloadModule({ ...m, saveDir: inferSaveDir(m), linkPrefix })
        if (res.ok) okCount += 1
        else errors.push(`${m.name}: ${res.message ?? "下载失败"}`)
      }
      if (errors.length) {
        setStage(`下载完成：成功 ${okCount}/${downloadable.length}`)
        await Dialog.alert({
          title: "部分下载失败",
          message: errors.slice(0, 6).join("\n"),
        })
      } else {
        setStage(`下载完成：${okCount}/${downloadable.length}`)
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      setStage(`下载失败：${msg}`)
      await Dialog.alert({ title: "下载失败", message: msg })
    } finally {
      setBusy(false)
      setProgress("")
    }
  }

  async function downloadAll() {
    const current = await loadModules()
    const list = current.filter((m) => {
      const catOk = filterCategory === "全部" ? true : m.category === filterCategory
      const dirOk = filterDir === "全部" ? true : getTopDir(m) === filterDir
      return catOk && dirOk
    })
    await downloadBatch(list, "下载全部模块…")
  }


  return (
    <NavigationStack>
      <List
        navigationTitle={"Surge 模块管理"}
        navigationBarTitleDisplayMode={"inline"}
        listStyle={"insetGroup"}
        toolbar={{
          topBarTrailing: <Button title="" systemImage="gearshape" action={withButtonHaptic(openSettings)} />,
        }}
      >
        <Section header={<Text>操作</Text>}>
          <CenterRowButton title="添加模块" onPress={withButtonHaptic(addModule)} disabled={busy} />
          <CenterRowButton
            title="全部更新"
            onPress={withButtonHaptic(downloadAll)}
            disabled={busy || onlyLocalFiltered}
          />
        </Section>

        <Section header={<Text>状态</Text>}>
          <Text>{stage}</Text>
          {progress ? <Text>进度：{progress}</Text> : null}
        </Section>

        <Section
          header={(
            <HStack>
              <Text>
                {filteredModules.length > 0
                  ? `模块列表(${filteredModules.length})`
                  : "模块列表"}
              </Text>
              <Spacer />
              {dirOptions.length > 1 ? (
                <Picker
                  title="子文件夹"
                  pickerStyle="menu"
                  value={Math.max(0, dirOptions.indexOf(filterDir))}
                  onChanged={(idx: number) => {
                    HapticFeedback.heavyImpact()
                    setFilterDir(dirOptions[idx] ?? "全部")
                  }}
                >
                  {dirOptions.map((d, idx) => (
                    <Text key={`${d}-${idx}`} tag={idx}>
                      {d}
                    </Text>
                  ))}
                </Picker>
              ) : null}
              <Picker
                title="筛选分类"
                pickerStyle="menu"
                value={filterIdx}
                onChanged={(idx: number) => {
                  HapticFeedback.heavyImpact()
                  setFilterCategory(filterOptions[idx] ?? "全部")
                }}
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
                      <Button title="查看模块" action={withButtonHaptic(() => viewModuleContent(m))} />
                      <Button title="复制链接" action={withButtonHaptic(() => copyModuleLink(m))} />
                      <Button title="删除" role="destructive" action={withButtonHaptic(() => deleteModuleFor(m))} />
                    </Group>
                  ),
                }}
                leadingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button
                      title="更新"
                      tint={m.link ? "systemGreen" : "systemGray"}
                      disabled={!m.link}
                      action={withButtonHaptic(() => downloadSingle(m))}
                    />,
                  ],
                }}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button title="编辑" tint="systemOrange" action={withButtonHaptic(() => modifyModuleFor(m))} />,
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
