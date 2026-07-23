import {
  Button,
  Divider,
  EmptyView,
  Grid,
  GridRow,
  Group,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  NavigationStack,
  ProgressView,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
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
  removeModuleFile,
  sortModules,
  type ModuleInfo,
  updateModuleMetadata,
  listDirectSubDirs,
  saveLocalModule,
  getModulesDirResolved,
  moveModuleFile,
} from "../utils/storage"
import { loadConfig, type AppConfig } from "../utils/config"
import { downloadModule } from "../utils/downloader"
import { EditModuleView } from "./EditModuleView"
import { RemoteControlView } from "./RemoteControlView"
import { SettingsView } from "./SettingsView"
import { useMarkdownReleaseNotesSheet } from "./ReleaseNotesSheet"
import {
  fetchEnabledModuleNames,
  getModuleRemoteName,
  setRemoteModuleEnabled,
} from "../utils/remote_control"
import { autoExportMetadataToICloud } from "../utils/metadata_sync"

function ModuleIcon(props: { module: ModuleInfo }) {
  const [failed, setFailed] = useState(false)
  const isRemote = !!props.module.link
  const fallbackName = isRemote ? "icloud.and.arrow.down.fill" : "puzzlepiece.extension.fill"
  const fallbackColor = isRemote ? "systemBlue" : "systemOrange"
  const frame = { width: 30, height: 30 }
  const iconShape = { type: "rect", cornerRadius: 7 } as any

  const fallback = (
    <Image
      systemName={fallbackName}
      font={24}
      foregroundStyle={fallbackColor}
      frame={frame}
    />
  )

  if (props.module.icon && !failed) {
    return (
      <Image
        imageUrl={props.module.icon}
        placeholder={fallback}
        onError={() => setFailed(true)}
        resizable
        interpolation="high"
        clipShape={iconShape}
        frame={frame}
      />
    )
  }

  return fallback
}

function FilterMenu(props: {
  value: string
  options: string[]
  onSelect: (value: string) => void
}) {
  return (
    <Menu
      label={(
        <HStack spacing={3} frame={{ width: 96, alignment: "trailing" }}>
          <Text lineLimit={1} truncationMode="tail" foregroundStyle="accentColor">
            {props.value}
          </Text>
          <Image systemName="chevron.down" font={10} foregroundStyle="accentColor" />
        </HStack>
      )}
    >
      {props.options.map((item, idx) => (
        <Button
          key={`${item}-${idx}`}
          title={item}
          action={() => {
            HapticFeedback.heavyImpact()
            props.onSelect(item)
          }}
        />
      ))}
    </Menu>
  )
}

function BatchMoveMenu(props: {
  disabled: boolean
  targets: { label: string; path: string }[]
  onMove: (path: string) => void | Promise<void>
}) {
  const foreground = props.disabled ? "secondaryLabel" : "systemBlue"

  return (
    <Menu
      label={(
        <VStack
          frame={{ maxWidth: "infinity", minHeight: 46, alignment: "center" }}
          padding={{ top: 3, bottom: 3 }}
          spacing={2}
        >
          <Image systemName="folder" font={15} foregroundStyle={foreground} />
          <Text font="caption2" foregroundStyle={foreground} lineLimit={1}>
            移动
          </Text>
        </VStack>
      )}
      disabled={props.disabled}
      buttonStyle="borderless"
      glassEffect
      buttonBorderShape="roundedRectangle"
      tint="systemBlue"
      frame={{ maxWidth: "infinity", minHeight: 46 }}
      listRowBackground={<EmptyView />}
      listRowSeparator="hidden"
    >
      {props.targets.map((target) => (
        <Button
          key={target.path}
          title={target.label}
          action={() => {
            HapticFeedback.mediumImpact()
            void props.onMove(target.path)
          }}
        />
      ))}
    </Menu>
  )
}

function BatchCompactButton(props: {
  title: string
  systemImage: string
  tint?: "systemBlue" | "systemGreen" | "systemRed"
  disabled?: boolean
  onPress: () => void | Promise<void>
}) {
  const foreground = props.disabled ? "secondaryLabel" : (props.tint ?? "systemBlue")

  return (
    <Button
      action={() => {
        HapticFeedback.mediumImpact()
        void props.onPress()
      }}
      disabled={props.disabled}
      buttonStyle="borderless"
      glassEffect
      buttonBorderShape="roundedRectangle"
      tint={props.tint ?? "systemBlue"}
      frame={{ maxWidth: "infinity", minHeight: 46 }}
      listRowBackground={<EmptyView />}
      listRowSeparator="hidden"
    >
      <VStack
        frame={{ maxWidth: "infinity", minHeight: 46, alignment: "center" }}
        padding={{ top: 3, bottom: 3 }}
        spacing={2}
      >
        <Image systemName={props.systemImage} font={15} foregroundStyle={foreground} />
        <Text font="caption2" foregroundStyle={foreground} lineLimit={1}>
          {props.title}
        </Text>
      </VStack>
    </Button>
  )
}

export function HomeView() {
  const releaseNotesSheet = useMarkdownReleaseNotesSheet({
    markdownFile: "release-notes.md",
    storageKey: "surge-modules-manager:release-notes:last-seen-hash",
    title: "更新内容",
  })

  const withButtonHaptic = (action: () => void | Promise<void>) => () => {
    HapticFeedback.mediumImpact()
    void action()
  }
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [stage, setStage] = useState("就绪")
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [resolvedBaseDir, setResolvedBaseDir] = useState("")
  const [filterCategory, setFilterCategory] = useState("全部")
  const [searchText, setSearchText] = useState("")
  const [searchVisible, setSearchVisible] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [moveTargets, setMoveTargets] = useState<{ label: string; path: string }[]>([])
  const [lastFailureDetails, setLastFailureDetails] = useState("")
  const [statusCardVisible, setStatusCardVisible] = useState(false)
  const [enabledModuleNames, setEnabledModuleNames] = useState<Set<string>>(new Set())
  const [togglingModuleNames, setTogglingModuleNames] = useState<Set<string>>(new Set())
  const categories = cfg.categories ?? []
  const filterOptions = ["全部", ...categories]
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

  function matchSearch(m: ModuleInfo): boolean {
    const key = searchText.trim().toLowerCase()
    if (!key) return true
    return [
      m.name,
      m.surgeName,
      m.category,
      m.link,
      m.content,
    ].some((value) => String(value ?? "").toLowerCase().includes(key))
  }

  const filteredModules = modules.filter((m) => {
    return matchFilters(m) && matchSearch(m)
  })
  const selectedModules = filteredModules.filter((m) => selectedKeys.has(moduleKey(m)))
  const selectedDownloadableCount = selectedModules.filter((m) => !!m.link).length
  const onlyLocalFiltered =
    filteredModules.length > 0 && filteredModules.every((m) => m.isLocal || !m.link)
  const remoteControlReady = !!String(cfg.remotePort ?? "").trim()

  function moduleKey(m: ModuleInfo): string {
    return m.filePath || `${m.name}-${m.link}`
  }

  function dirName(path: string): string {
    const normalized = String(path ?? "").replace(/\/+$/, "")
    return normalized.split("/").pop() || normalized || "根目录"
  }

  function inferSaveDir(m: ModuleInfo): string | undefined {
    if (!m.filePath) return undefined
    const idx = String(m.filePath).lastIndexOf("/")
    return idx > 0 ? String(m.filePath).slice(0, idx) : undefined
  }

  async function refreshModules(resetStageOnSuccess = false) {
    try {
      await ensureStorage()
      const resolved = await getModulesDirResolved()
      setResolvedBaseDir(resolved)
      const list = sortModules(await loadModules())
      setModules(list)
      try {
        const subDirs = await listDirectSubDirs(resolved)
        setMoveTargets([
          { label: "根目录", path: resolved },
          ...subDirs.map((path) => ({ label: dirName(path), path })),
        ])
      } catch {
        setMoveTargets(resolved ? [{ label: "根目录", path: resolved }] : [])
      }
      if (resetStageOnSuccess) {
        setStage("就绪")
        setProgress(null)
      }
    } catch (e: any) {
      setModules([])
      setMoveTargets([])
      setStage(String(e?.message ?? e))
    }
  }

  async function syncMetadataIfNeeded() {
    await autoExportMetadataToICloud(loadConfig())
  }

  useEffect(() => {
    void refreshModules()
  }, [])

  useEffect(() => {
    void refreshRemoteModules(true)
  }, [cfg.remotePort, cfg.remotePassword])

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

  useEffect(() => {
    const hasStatus = stage !== "就绪" || progress !== null || !!lastFailureDetails
    if (!hasStatus) {
      setStatusCardVisible(false)
      return
    }

    setStatusCardVisible(true)
    const timer = setTimeout(() => {
      setStatusCardVisible(false)
    }, 3000)

    return () => clearTimeout(timer)
  }, [stage, progress, lastFailureDetails])

  function toggleSelection(target: ModuleInfo) {
    const key = moduleKey(target)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function clearSelection() {
    setSelectedKeys(new Set())
  }

  function exitSelectionMode() {
    setSelectionMode(false)
    clearSelection()
  }

  function selectAllFiltered() {
    if (
      filteredModules.length > 0 &&
      filteredModules.every((m) => selectedKeys.has(moduleKey(m)))
    ) {
      clearSelection()
      return
    }
    setSelectedKeys(new Set(filteredModules.map((m) => moduleKey(m))))
  }

  function invertFilteredSelection() {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      for (const item of filteredModules) {
        const key = moduleKey(item)
        if (next.has(key)) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }

  async function openSettings() {
    await Navigation.present({
      element: (
        <SettingsView
          initial={loadConfig()}
          onDone={(next) => {
            setCfg(next)
            void refreshModules(true)
          }}
        />
      ),
    })
    setCfg(loadConfig())
    await refreshModules(true)
  }

  async function openRemoteSettings() {
    await Navigation.present({
      element: (
        <RemoteControlView
          initial={loadConfig()}
          onDone={(next) => {
            setCfg(next)
            void refreshRemoteModules(true, next)
          }}
        />
      ),
    })
    const next = loadConfig()
    setCfg(next)
    await refreshRemoteModules(true, next)
  }

  async function refreshRemoteModules(silent = false, nextCfg: AppConfig = cfg) {
    if (!String(nextCfg.remotePort ?? "").trim()) {
      setEnabledModuleNames(new Set())
      return
    }
    try {
      const enabled = await fetchEnabledModuleNames(nextCfg)
      setEnabledModuleNames(enabled)
    } catch (e: any) {
      setEnabledModuleNames(new Set())
      if (!silent) setStage(`远程状态获取失败：${String(e?.message ?? e)}`)
    }
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
    setProgress(null)
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
      await syncMetadataIfNeeded()
    } catch (e: any) {
      setStage(`添加失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function modifyModuleFor(target: ModuleInfo) {
    const current = await loadModules()
    const subDirs = await listDirectSubDirs()
    const originalSaveDir = inferSaveDir(target)
    const updated = await Navigation.present<ModuleInfo>({
      element: (
        <EditModuleView
          title="编辑模块"
          categories={categories}
          initial={{ ...target, saveDir: originalSaveDir }}
          saveDirs={subDirs}
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
    setProgress(null)
    try {
      next[idx] = merged
      const finalName = merged.name || target.name
      const finalSaveDir = merged.saveDir ?? originalSaveDir
      const needMove =
        finalName !== target.name ||
        String(finalSaveDir ?? "") !== String(originalSaveDir ?? "")
      const finalFilePath = needMove
        ? await moveModuleFile(target, finalSaveDir, finalName)
        : (target.filePath ?? moduleFilePath(finalName, finalSaveDir))

      if (merged.isLocal || !merged.link) {
        await saveLocalModule(
          { ...merged, name: finalName, saveDir: finalSaveDir, filePath: finalFilePath },
          merged.content ?? ""
        )
      } else {
        await updateModuleMetadata({ ...merged, name: finalName, filePath: finalFilePath }, {
          link: merged.link,
          category: merged.category,
          local: false,
        })
      }
      await refreshModules()
      await syncMetadataIfNeeded()
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
    setProgress(null)
    try {
      await removeModuleFile(target)
      await refreshModules()
      await syncMetadataIfNeeded()
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

  async function copyFailureDetails() {
    if (!lastFailureDetails) return
    try {
      await Pasteboard.setString(lastFailureDetails)
      await Dialog.alert({ message: "失败详情已复制" })
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
    setProgress(null)
    setLastFailureDetails("")
    const errors: string[] = []
    let okCount = 0
    try {
      const total = downloadable.length
      let nextIndex = 0
      let completed = 0
      const concurrency = Math.max(1, Math.min(cfg.downloadConcurrency || 3, total))

      const updateOverallProgress = () => {
        setStage(`下载中：已完成 ${completed}/${total}`)
        setProgress(completed / total)
      }

      updateOverallProgress()

      async function worker() {
        for (;;) {
          const idx = nextIndex
          nextIndex += 1
          if (idx >= total) return

          const m = downloadable[idx]
          const linkPrefix = await detectLinkPrefix(m)
          const res = await downloadModule({ ...m, saveDir: inferSaveDir(m), linkPrefix })
          if (res.ok) okCount += 1
          else errors.push(`${m.name}: ${res.message ?? "下载失败"}`)

          completed += 1
          updateOverallProgress()
        }
      }

      const workers = Array.from({ length: concurrency }, () => worker())
      await Promise.all(workers)

      if (errors.length) {
        const details = errors.join("\n")
        setLastFailureDetails(details)
        setStage(`下载完成：成功 ${okCount}/${total}`)
        await Dialog.alert({
          title: "部分下载失败",
          message: `${errors.slice(0, 8).join("\n")}${errors.length > 8 ? `\n其余 ${errors.length - 8} 个失败已省略` : ""}\n\n可在状态区域复制完整失败详情。`,
        })
      } else {
        setLastFailureDetails("")
        setStage(`下载完成：${okCount}/${total}`)
      }
      if (okCount > 0) {
        await syncMetadataIfNeeded()
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      setLastFailureDetails(msg)
      setStage(`下载失败：${msg}`)
      await Dialog.alert({ title: "下载失败", message: msg })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function downloadAll() {
    const current = await loadModules()
    const list = current.filter((m) => {
      const catOk = filterCategory === "全部" ? true : m.category === filterCategory
      const dirOk = filterDir === "全部" ? true : getTopDir(m) === filterDir
      return catOk && dirOk && matchSearch(m)
    })
    await downloadBatch(list, "下载全部模块…")
  }

  async function downloadSelected() {
    if (!selectedModules.length) {
      await Dialog.alert({ message: "请先选择模块" })
      return
    }
    await downloadBatch(selectedModules, `批量更新：${selectedModules.length} 个模块…`)
  }

  async function deleteSelected() {
    if (!selectedModules.length) {
      await Dialog.alert({ message: "请先选择模块" })
      return
    }
    const ok = await Dialog.confirm({
      title: "批量删除",
      message: `确定删除已选的 ${selectedModules.length} 个模块？`,
    })
    if (!ok) return

    setBusy(true)
    setStage("批量删除中…")
    setProgress(null)
    try {
      for (const item of selectedModules) {
        await removeModuleFile(item)
      }
      exitSelectionMode()
      await refreshModules()
      await syncMetadataIfNeeded()
      setStage("批量删除完成")
    } catch (e: any) {
      setStage(`批量删除失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function moveSelectedTo(targetDir: string) {
    if (!selectedModules.length) {
      await Dialog.alert({ message: "请先选择模块" })
      return
    }

    setBusy(true)
    setStage("批量移动中…")
    setProgress(null)
    try {
      const finalDir = targetDir || (await getModulesDirResolved())
      for (const item of selectedModules) {
        await moveModuleFile(item, finalDir, item.name)
      }
      exitSelectionMode()
      await refreshModules()
      await syncMetadataIfNeeded()
      setStage("批量移动完成")
    } catch (e: any) {
      setStage(`批量移动失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleRemoteModule(target: ModuleInfo, nextValue: boolean) {
    const remoteName = getModuleRemoteName(target)
    if (!remoteControlReady) {
      await Dialog.alert({ message: "请先配置 HTTP 远程控制端口" })
      return
    }
    if (!remoteName) {
      await Dialog.alert({ message: "未找到模块远程名称" })
      return
    }

    HapticFeedback.heavyImpact()
    setTogglingModuleNames((prev) => new Set([...prev, remoteName]))
    setEnabledModuleNames((prev) => {
      const next = new Set(prev)
      if (nextValue) next.add(remoteName)
      else next.delete(remoteName)
      return next
    })

    try {
      await setRemoteModuleEnabled(cfg, remoteName, nextValue)
    } catch (e: any) {
      setEnabledModuleNames((prev) => {
        const next = new Set(prev)
        if (nextValue) next.delete(remoteName)
        else next.add(remoteName)
        return next
      })
      await Dialog.alert({
        title: "远程控制失败",
        message: `${remoteName}\n${String(e?.message ?? e)}`,
      })
    } finally {
      setTogglingModuleNames((prev) => {
        const next = new Set(prev)
        next.delete(remoteName)
        return next
      })
    }
  }

  const fixedStatusPanel = (
    <VStack
      spacing={6}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack>
        <Text font="headline">状态</Text>
        <Spacer />
      </HStack>
      <Text>{stage}</Text>
      {progress !== null ? (
        <ProgressView
          value={progress}
          total={1}
          progressViewStyle="linear"
          frame={{ maxWidth: "infinity" }}
        />
      ) : null}
      {lastFailureDetails ? (
        <VStack alignment="leading" spacing={8}>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={4}>
            {lastFailureDetails}
          </Text>
          <Button
            title="复制失败详情"
            systemImage="doc.on.doc"
            action={withButtonHaptic(copyFailureDetails)}
          />
        </VStack>
      ) : null}
    </VStack>
  )

  const fixedBatchPanel = selectionMode ? (
    <VStack
      spacing={8}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack>
        <Text font="headline">批量操作</Text>
        <Spacer />
        <Text foregroundStyle="secondaryLabel">已选 {selectedModules.length}</Text>
      </HStack>
      <Grid
        horizontalSpacing={6}
        verticalSpacing={0}
        listRowBackground={<EmptyView />}
        listRowSeparator="hidden"
        frame={{ maxWidth: "infinity", alignment: "center" }}
        padding={{ top: 2, bottom: 2 }}
      >
        <GridRow>
          <BatchCompactButton
            title="全选"
            systemImage="checkmark.circle"
            tint="systemBlue"
            onPress={selectAllFiltered}
          />
          <BatchCompactButton
            title="反选"
            systemImage="circle.lefthalf.filled"
            tint="systemBlue"
            onPress={invertFilteredSelection}
          />
          <BatchCompactButton
            title="更新"
            systemImage="arrow.triangle.2.circlepath"
            tint="systemGreen"
            disabled={busy || selectedDownloadableCount === 0}
            onPress={downloadSelected}
          />
          <BatchMoveMenu
            disabled={busy || selectedModules.length === 0}
            targets={moveTargets}
            onMove={moveSelectedTo}
          />
          <BatchCompactButton
            title="删除"
            systemImage="trash"
            tint="systemRed"
            disabled={busy || selectedModules.length === 0}
            onPress={deleteSelected}
          />
          <BatchCompactButton
            title="完成"
            systemImage="checkmark"
            tint="systemBlue"
            onPress={exitSelectionMode}
          />
        </GridRow>
      </Grid>
    </VStack>
  ) : null

  const showStatusPanel = statusCardVisible && (stage !== "就绪" || progress !== null || !!lastFailureDetails)
  const showTopCard = showStatusPanel || selectionMode
  const showSearchPanel = searchVisible || !!searchText.trim()
  const showTopInset = showSearchPanel || showTopCard

  return (
    <NavigationStack>
      <List
        sheet={releaseNotesSheet}
        navigationTitle={"Surge 模块管理"}
        navigationBarTitleDisplayMode={"inline"}
        listStyle={"insetGroup"}
        toolbar={{
          topBarLeading: (
            <HStack>
              <Button title="" systemImage="switch.2" action={withButtonHaptic(openRemoteSettings)} />
              <Button
                title=""
                systemImage={searchVisible || searchText.trim() ? "magnifyingglass.circle.fill" : "magnifyingglass"}
                action={withButtonHaptic(() => setSearchVisible((value) => !value))}
              />
            </HStack>
          ),
          topBarTrailing: (
            <HStack>
              <Button
                title=""
                systemImage={selectionMode ? "checkmark.circle.fill" : "checklist"}
                action={withButtonHaptic(() => {
                  if (selectionMode) exitSelectionMode()
                  else setSelectionMode(true)
                })}
              />
              <Button title="" systemImage="gearshape" action={withButtonHaptic(openSettings)} />
            </HStack>
          ),
        }}
        ignoresSafeArea={{ regions: "keyboard" }}
        safeAreaInset={{
          top: {
            alignment: "center",
            spacing: 0,
            content: (
              showTopInset ? (
                <VStack
                  spacing={showSearchPanel && showTopCard ? 8 : 0}
                  padding={{ top: 8, bottom: 8, leading: 18, trailing: 18 }}
                  frame={{ maxWidth: "infinity" }}
                >
                  {showSearchPanel ? (
                    <HStack
                      spacing={8}
                      padding={{ top: 10, bottom: 10, leading: 14, trailing: 14 }}
                      frame={{ maxWidth: "infinity" }}
                      glassEffect={{ type: "rect", cornerRadius: 20 } as any}
                    >
                      <TextField
                        title="搜索"
                        value={searchText}
                        onChanged={(value: string) => setSearchText(value)}
                        prompt="搜索模块名称或内容"
                      />
                      {searchText.trim() ? (
                        <Button
                          title=""
                          systemImage="xmark.circle.fill"
                          action={withButtonHaptic(() => setSearchText(""))}
                        />
                      ) : null}
                    </HStack>
                  ) : null}
                  {showTopCard ? (
                    <VStack
                      spacing={showStatusPanel && selectionMode ? 10 : 0}
                      padding={{ top: 13, bottom: 12, leading: 18, trailing: 18 }}
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                      glassEffect={{ type: "rect", cornerRadius: 28 } as any}
                    >
                      {showStatusPanel ? fixedStatusPanel : null}
                      {showStatusPanel && selectionMode ? <Divider /> : null}
                      {fixedBatchPanel}
                    </VStack>
                  ) : null}
                </VStack>
              ) : <VStack />
            ),
          },
          bottom: {
            alignment: "trailing",
            spacing: 0,
            content: (
              selectionMode ? <VStack /> : <VStack spacing={18} padding={{ bottom: 18, trailing: 16 }}>
                <Button
                  action={withButtonHaptic(addModule)}
                  buttonStyle="glass"
                  buttonBorderShape="circle"
                  controlSize="extraLarge"
                  tint="systemBlue"
                  disabled={busy}
                  frame={{ width: 76, height: 76 }}
                >
                  <VStack frame={{ width: 56, height: 56, alignment: "center" }}>
                    <Image systemName="plus" font={30} foregroundStyle="systemBlue" />
                  </VStack>
                </Button>
                <Button
                  action={withButtonHaptic(downloadAll)}
                  buttonStyle="glass"
                  buttonBorderShape="circle"
                  controlSize="extraLarge"
                  tint="systemGreen"
                  disabled={busy || onlyLocalFiltered}
                  frame={{ width: 76, height: 76 }}
                >
                  <VStack frame={{ width: 56, height: 56, alignment: "center" }}>
                    <Image systemName="arrow.triangle.2.circlepath" font={28} foregroundStyle="systemGreen" />
                  </VStack>
                </Button>
              </VStack>
            ),
          },
        }}
      >
        <Section
          header={(
            <HStack frame={{ maxWidth: "infinity" }}>
              <Text lineLimit={1} truncationMode="tail" layoutPriority={1}>
                {filteredModules.length > 0
                  ? `模块列表(${filteredModules.length})`
                  : "模块列表"}
              </Text>
              <Spacer />
              {dirOptions.length > 1 ? (
                <FilterMenu
                  value={filterDir}
                  options={dirOptions}
                  onSelect={(value) => setFilterDir(value)}
                />
              ) : null}
              <FilterMenu
                value={filterCategory}
                options={filterOptions}
                onSelect={(value) => setFilterCategory(value)}
              />
            </HStack>
          )}
        >
          {filteredModules.length === 0 ? (
            <Text>{searchText.trim() ? "暂无匹配模块" : "暂无模块"}</Text>
          ) : (
            filteredModules.map((m) => (
              (() => {
                const remoteName = getModuleRemoteName(m)
                return (
                  <VStack
                    key={`${m.name}-${m.link}`}
                    contextMenu={selectionMode ? undefined : {
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
                      actions: selectionMode ? [] : [
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
                      actions: selectionMode ? [] : [
                        <Button title="编辑" tint="systemOrange" action={withButtonHaptic(() => modifyModuleFor(m))} />,
                      ],
                    }}
                  >
                    <HStack spacing={10}>
                      {selectionMode ? (
                        <Button
                          title=""
                          systemImage={selectedKeys.has(moduleKey(m)) ? "checkmark.circle.fill" : "circle"}
                          action={withButtonHaptic(() => toggleSelection(m))}
                        />
                      ) : null}
                      <ModuleIcon module={m} />
                      <VStack alignment="leading" spacing={3}>
                        <Text font="headline">{m.name}</Text>
                        {m.category ? (
                          <Text font="caption" foregroundStyle="secondaryLabel">
                            {m.category}
                          </Text>
                        ) : null}
                      </VStack>
                      <Spacer />
                      {!selectionMode ? (
                        <Toggle
                          title=""
                          value={enabledModuleNames.has(remoteName)}
                          disabled={!remoteControlReady || togglingModuleNames.has(remoteName)}
                          toggleStyle="switch"
                          onChanged={(value: boolean) => {
                            void toggleRemoteModule(m, value)
                          }}
                        />
                      ) : null}
                    </HStack>
                  </VStack>
                )
              })()
            ))
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}
