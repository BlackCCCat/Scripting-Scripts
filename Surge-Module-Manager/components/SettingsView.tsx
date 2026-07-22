import {
  Button,
  ForEach,
  Form,
  Group,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  Toggle,
  VStack,
  HStack,
  Spacer,
  Picker,
  useEffect,
  useState,
} from "scripting"

import {
  addCategory,
  loadConfig,
  saveConfig,
  type AppConfig,
} from "../utils/config"
import { countModulesByCategory, loadCategoriesFromModules, renameCategoryInModules } from "../utils/storage"
import {
  exportMetadataToICloud,
  exportMetadataWithDocumentPicker,
  importMetadataFromFile,
  iCloudMetadataAvailable,
  removeICloudMetadataFile,
} from "../utils/metadata_sync"

function PlainRowButton(props: { title: string; onPress: () => void }) {
  return (
    <Button
      action={() => {
        HapticFeedback.mediumImpact()
        props.onPress()
      }}
    >
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

export function SettingsView(props: {
  initial?: AppConfig
  onDone?: (cfg: AppConfig) => void
}) {
  const dismiss = Navigation.useDismiss()
  const initialCfg = props.initial ?? loadConfig()
  const [cfg, setCfg] = useState<AppConfig>(initialCfg)

  const [bookmarks, setBookmarks] = useState<{ name: string; path: string }[]>([])
  const [bookmarkIdx, setBookmarkIdx] = useState<number>(0)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [metadataAction, setMetadataAction] = useState<"" | "export" | "import">("")
  const concurrencyOptions = Array.from({ length: 10 }, (_, idx) => idx + 1)

  useEffect(() => {
    setCfg(props.initial ?? loadConfig())
    void refreshBookmarks(props.initial ?? loadConfig())
    void refreshCounts(props.initial ?? loadConfig())
  }, [])

  function isPromiseLike(v: any): v is Promise<any> {
    return !!v && typeof v === "object" && typeof v.then === "function"
  }

  function normalizeBookmarkPath(path: string): string {
    return String(path ?? "").trim().replace(/\/+$/, "")
  }

  async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
    try {
      const r = fn.apply(thisArg, args)
      return isPromiseLike(r) ? await r : r
    } catch {
      return undefined
    }
  }

  async function refreshBookmarks(current?: AppConfig): Promise<{ name: string; path: string }[]> {
    const fm: any = (globalThis as any).FileManager
    let list: any = []
    if (fm?.getAllFileBookmarks) {
      try {
        const r = fm.getAllFileBookmarks()
        list = r && typeof r.then === "function" ? await r : r
      } catch {
        list = []
      }
    }
    const arr = Array.isArray(list) ? list : []
    const cleaned = arr
      .map((x: any) => ({ name: String(x?.name ?? ""), path: String(x?.path ?? "") }))
      .filter((x: any) => x.name && x.path)
    setBookmarks(cleaned)

    const targetName = current?.baseBookmarkName ?? cfg.baseBookmarkName
    const targetPath = current?.baseDir ?? cfg.baseDir
    if (cleaned.length) {
      let idx = -1
      if (targetName) idx = cleaned.findIndex((b) => b.name === targetName)
      if (idx < 0 && targetPath) {
        idx = cleaned.findIndex((b) => normalizeBookmarkPath(b.path) === normalizeBookmarkPath(targetPath))
      }
      setBookmarkIdx(idx >= 0 ? idx : 0)
      if (idx >= 0) {
        const matched = cleaned[idx]
        const canUseByName = fm?.bookmarkExists
          ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [matched.name]))
          : true
        const resolved = fm?.bookmarkedPath && canUseByName
          ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [matched.name])) ?? matched.path)
          : matched.path
        const selectedPath = normalizeBookmarkPath(resolved || matched.path)
        const pathChanged = selectedPath !== normalizeBookmarkPath(targetPath) || matched.name !== targetName
        if (pathChanged) {
          setCfg((c) => ({ ...c, baseDir: selectedPath, baseBookmarkName: matched.name }))
          try {
            const next = { ...loadConfig(), baseDir: selectedPath, baseBookmarkName: matched.name }
            saveConfig(next)
            props.onDone?.(next)
          } catch {}
        }
      } else if (!targetPath) {
        const first = cleaned[0]
        const canUseByName = fm?.bookmarkExists
          ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [first.name]))
          : true
        const resolved = fm?.bookmarkedPath && canUseByName
          ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [first.name])) ?? first.path)
          : first.path
        setCfg((c) => ({ ...c, baseDir: normalizeBookmarkPath(resolved || first.path), baseBookmarkName: first.name }))
      }
    } else {
      setBookmarkIdx(0)
    }
    return cleaned
  }

  async function refreshCounts(current?: AppConfig) {
    try {
      const counts = await countModulesByCategory(current?.baseDir ?? cfg.baseDir)
      setCategoryCounts(counts)
    } catch {
      setCategoryCounts({})
    }
  }

  async function pickAndSaveBookmarkFolder() {
    try {
      HapticFeedback.mediumImpact()
      const picker: any = (globalThis as any).DocumentPicker
      if (typeof picker?.pickDirectoryBookmark !== "function") {
        await Dialog.alert({
          title: "当前版本不支持",
          message: "当前 Scripting 版本不支持直接选择并保存书签文件夹，请先升级 Scripting。",
        })
        return
      }

      const result = await picker.pickDirectoryBookmark({
        preferredName: "Surge模块管理",
        initialDirectory: cfg.baseDir || undefined,
      })
      if (!result) return

      const bookmarkName = String(result.bookmarkName ?? "").trim()
      const pickedPath = normalizeBookmarkPath(String(result.path ?? ""))
      if (!bookmarkName || !pickedPath) {
        throw new Error("未获取到有效的书签目录")
      }

      const next: AppConfig = { ...cfg, baseDir: pickedPath, baseBookmarkName: bookmarkName }
      setCfg(next)
      saveConfig(next)
      props.onDone?.(next)
      const updated = await refreshBookmarks(next)
      const idx = updated.findIndex((b) => b.name === bookmarkName)
      if (idx >= 0) setBookmarkIdx(idx)
      await refreshCounts(next)
      await Dialog.alert({ message: "已选择并保存书签文件夹" })
    } catch (e: any) {
      await Dialog.alert({ title: "选择文件夹失败", message: String(e?.message ?? e) })
    }
  }

  async function addCategoryAction() {
    const name = (await Dialog.prompt({
      title: "添加分类",
      message: "请输入分类名称",
      placeholder: "分类名称",
    }))?.trim()
    if (!name) return
    if (cfg.categories.includes(name)) {
      await Dialog.alert({ message: "分类已存在" })
      return
    }
    setCfg((c) => addCategory(c, name))
    await refreshCounts()
  }

  async function importCategories() {
    if (!cfg.baseDir) {
      await Dialog.alert({ message: "请先选择书签文件夹" })
      return
    }
    const result = await loadCategoriesFromModules(cfg.baseDir)
    const list = result.categories
    const existing = new Set(cfg.categories ?? [])
    const toAdd = list.filter((c) => !existing.has(c))
    if (!list.length) {
      await Dialog.alert({
        message: `未找到任何分类（扫描 ${result.scanned} 个模块文件）\n仅识别 #!category=xxx 或 #!cagegory=xxx`,
      })
      return
    }
    if (!toAdd.length) {
      await Dialog.alert({
        message: `导入完成：扫描 ${result.scanned} 个模块文件，新增 0 个分类`,
      })
      return
    }
    setCfg((c) => ({ ...c, categories: [...(c.categories ?? []), ...toAdd] }))
    await Dialog.alert({
      message: `导入完成：扫描 ${result.scanned} 个模块文件，新增 ${toAdd.length} 个分类`,
    })
    await refreshCounts()
  }

  async function editCategory(oldName: string) {
    const nextName = (await Dialog.prompt({
      title: "编辑分类",
      message: "请输入新的分类名称",
      defaultValue: oldName,
      placeholder: "分类名称",
    }))?.trim()
    if (!nextName || nextName === oldName) return
    if (cfg.categories.includes(nextName)) {
      await Dialog.alert({ message: "分类已存在" })
      return
    }
    setCfg((c) => {
      const list = (c.categories ?? []).map((n) => (n === oldName ? nextName : n))
      return { ...c, categories: list }
    })
    await renameCategoryInModules(oldName, nextName, cfg.baseDir)
    await refreshCounts()
  }

function deleteCategoryAt(indices: number[]) {
    if (!indices.length) return
    HapticFeedback.heavyImpact()
    setCfg((c) => {
      const next = [...(c.categories ?? [])]
      const sorted = [...indices].sort((a, b) => b - a)
      for (const i of sorted) {
        if (i >= 0 && i < next.length) next.splice(i, 1)
      }
      return { ...c, categories: next }
    })
    void refreshCounts()
  }

  async function saveAndClose() {
    try {
      saveConfig(cfg)
      if (cfg.iCloudMetadataSync) {
        await exportMetadataToICloud()
      }
      props.onDone?.(cfg)
      dismiss()
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function exportMetadataAction() {
    if (metadataAction) return
    setMetadataAction("export")
    try {
      if (cfg.iCloudMetadataSync && !iCloudMetadataAvailable()) {
        await Dialog.alert({ message: "iCloud 不可用，请先确认已登录 iCloud 并允许 Scripting 使用 iCloud" })
        return
      }
      saveConfig(cfg)
      const result = cfg.iCloudMetadataSync
        ? await exportMetadataToICloud()
        : await exportMetadataWithDocumentPicker()
      await Dialog.alert({
        title: "导出完成",
        message: `已导出 ${result.count} 个远程模块元数据\n${result.path}`,
      })
    } catch (e: any) {
      if (String(e?.message ?? e) === "未选择导出位置") return
      await Dialog.alert({ title: "导出失败", message: String(e?.message ?? e) })
    } finally {
      setMetadataAction("")
    }
  }

  async function setICloudMetadataSync(value: boolean) {
    HapticFeedback.heavyImpact()
    setCfg((c) => ({ ...c, iCloudMetadataSync: value }))
    if (value) return

    try {
      await removeICloudMetadataFile()
    } catch (e: any) {
      await Dialog.alert({
        title: "清理 iCloud 元数据失败",
        message: String(e?.message ?? e),
      })
    }
  }

  async function importMetadataAction() {
    if (metadataAction) return
    setMetadataAction("import")
    try {
      const picker: any = (globalThis as any).DocumentPicker
      if (!picker?.pickFiles) {
        await Dialog.alert({ message: "DocumentPicker.pickFiles 不可用，无法选择元数据文件" })
        return
      }
      const files = await picker.pickFiles({
        types: ["public.json", "public.text", "public.plain-text"],
        allowsMultipleSelection: false,
        shouldShowFileExtensions: true,
      })
      const filePath = Array.isArray(files) ? files[0] : undefined
      if (!filePath) return

      const result = await importMetadataFromFile(filePath, cfg)
      setCfg(result.config)
      props.onDone?.(result.config)
      await refreshCounts(result.config)
      await Dialog.alert({
        title: "导入完成",
        message:
          `扫描 ${result.scanned} 个模块元数据\n` +
          `新建 ${result.created} 个，更新 ${result.updated} 个，跳过 ${result.skipped} 个\n` +
          `新增分类 ${result.categoriesAdded} 个\n` +
          `${result.path}`,
      })
    } catch (e: any) {
      await Dialog.alert({ title: "导入失败", message: String(e?.message ?? e) })
    } finally {
      setMetadataAction("")
    }
  }

  const bookmarkContextMenu = {
    menuItems: (
      <Group>
        <Button
          title="选择新的文件夹"
          systemImage="folder.badge.plus"
          action={() => void pickAndSaveBookmarkFolder()}
        />
      </Group>
    ),
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"设置"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarTrailing: (
            <Button
              title="保存"
              action={() => {
                HapticFeedback.mediumImpact()
                void saveAndClose()
              }}
            />
          ),
        }}
      >
        <Form formStyle="grouped">
          <Section header={<Text>存储目录</Text>}>
            <TextField
              label={<Text>路径</Text>}
              value={cfg.baseDir}
              onChanged={(v: string) => setCfg((c) => ({ ...c, baseDir: v, baseBookmarkName: "" }))}
              prompt="粘贴或选择目录"
              textFieldStyle="roundedBorder"
            />
            <Text font="caption" foregroundStyle="secondaryLabel">
              可长按书签文件夹选择新的文件夹，并自动保存为书签
            </Text>
            {bookmarks.length ? (
              <Picker
                title={"书签文件夹"}
                pickerStyle="menu"
                contextMenu={bookmarkContextMenu}
                value={bookmarkIdx}
                onChanged={(idx: number) => {
                  HapticFeedback.heavyImpact()
                  setBookmarkIdx(idx)
                  const b = bookmarks[idx]
                  if (b?.path) {
                    void (async () => {
                      const fm: any = (globalThis as any).FileManager
                      const canUseByName = fm?.bookmarkExists
                        ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [b.name]))
                        : true
                      const resolved = fm?.bookmarkedPath && canUseByName
                        ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [b.name])) ?? b.path)
                        : b.path
                      const next: AppConfig = { ...cfg, baseDir: normalizeBookmarkPath(resolved || b.path), baseBookmarkName: b.name }
                      setCfg(next)
                      try {
                        saveConfig(next)
                        props.onDone?.(next)
                        await refreshCounts(next)
                      } catch {}
                    })()
                  }
                }}
              >
                {bookmarks.map((b, index) => (
                  <Text key={b.name} tag={index}>
                    {b.name}
                  </Text>
                ))}
              </Picker>
            ) : (
              <Text
                foregroundStyle="secondaryLabel"
                contextMenu={bookmarkContextMenu}
              >
                暂无可用书签，长按此处选择新的文件夹
              </Text>
            )}
          </Section>

          <Section header={<Text>链接格式</Text>}>
            <TextField
              label={<Text>前缀</Text>}
              value={cfg.linkPatternsText}
              onChanged={(v: string) => setCfg((c) => ({ ...c, linkPatternsText: v }))}
              axis="vertical"
              lineLimit={{ min: 3, max: 6 }}
              prompt={"例如：\n#!url=\n#SUBSCRIBED \n每行一个，按顺序优先匹配"}
              textFieldStyle="roundedBorder"
            />
          </Section>

          <Section header={<Text>下载设置</Text>}>
            <Picker
              title={"并发下载数"}
              pickerStyle="menu"
              value={Math.max(0, concurrencyOptions.indexOf(cfg.downloadConcurrency))}
              onChanged={(idx: number) => {
                HapticFeedback.heavyImpact()
                const next = concurrencyOptions[idx] ?? 3
                setCfg((c) => ({ ...c, downloadConcurrency: next }))
              }}
            >
              {concurrencyOptions.map((num, idx) => (
                <Text key={`${num}`} tag={idx}>
                  {num}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section
            header={<Text>iCloud 元数据同步</Text>}
            footer={(
              <Text font="caption" foregroundStyle="secondaryLabel">
                开启自动同步时，导出会写入 iCloud 默认元数据文件；关闭时，导出会让你选择保存位置，并清理 iCloud 默认元数据文件。导入时可从 Files 选择 JSON 文件。仅同步模块名称、链接、分类、相对目录和链接格式。
              </Text>
            )}
          >
            <Toggle
              title="自动同步"
              value={cfg.iCloudMetadataSync}
              onChanged={(value: boolean) => void setICloudMetadataSync(value)}
            />
            <PlainRowButton title={metadataAction === "export" ? "导出中…" : "导出模块信息"} onPress={exportMetadataAction} />
            <PlainRowButton title={metadataAction === "import" ? "导入中…" : "导入模块信息"} onPress={importMetadataAction} />
          </Section>

          <Section header={<Text>分类列表</Text>}>
            {cfg.categories.length === 0 ? (
              <Text>暂无分类</Text>
            ) : (
              <ForEach
                count={cfg.categories.length}
                onDelete={(indices) => deleteCategoryAt(indices)}
                  itemBuilder={(index) => {
                    const cat = cfg.categories[index]
                    const count = categoryCounts[cat] ?? 0
                    return (
                      <HStack
                        key={cat}
                        leadingSwipeActions={{
                          allowsFullSwipe: false,
                          actions: [
                            <Button
                              title="编辑"
                              action={() => {
                                HapticFeedback.mediumImpact()
                                editCategory(cat)
                              }}
                            />,
                          ],
                        }}
                      >
                        <Text>{cat}</Text>
                        <Spacer />
                        <Text>{count}</Text>
                      </HStack>
                    )
                  }}
              />
            )}
          </Section>

          <Section>
            <PlainRowButton title="导入分类" onPress={importCategories} />
            <PlainRowButton title="添加分类" onPress={addCategoryAction} />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
