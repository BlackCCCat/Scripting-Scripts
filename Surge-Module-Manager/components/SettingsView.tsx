import {
  Button,
  ForEach,
  Form,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
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

function CenterRowButton(props: {
  title: string
  role?: "cancel" | "destructive"
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Button
      role={props.role}
      action={() => {
        HapticFeedback.mediumImpact()
        props.onPress()
      }}
      disabled={props.disabled}
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

  useEffect(() => {
    setCfg(props.initial ?? loadConfig())
    void refreshBookmarks(props.initial ?? loadConfig())
    void refreshCounts(props.initial ?? loadConfig())
  }, [])

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

    const target = current?.baseDir ?? cfg.baseDir
    if (cleaned.length) {
      const idx = cleaned.findIndex((b) => b.path === target)
      setBookmarkIdx(idx >= 0 ? idx : 0)
      if (idx < 0 && !target) {
        setCfg((c) => ({ ...c, baseDir: cleaned[0].path }))
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
      props.onDone?.(cfg)
      dismiss()
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"设置"}
        navigationBarTitleDisplayMode={"inline"}
      >
        <Form formStyle="grouped">
          <Section header={<Text>存储目录</Text>}>
            <TextField
              label={<Text>路径</Text>}
              value={cfg.baseDir}
              onChanged={(v: string) => setCfg((c) => ({ ...c, baseDir: v }))}
              prompt="粘贴或选择目录"
              textFieldStyle="roundedBorder"
            />
            <Text font="caption" foregroundStyle="secondaryLabel">
              请在 工具-文件书签 中添加相应文件夹，并在此选择该文件夹
            </Text>
            {bookmarks.length ? (
              <Picker
                title={"书签文件夹"}
                pickerStyle="menu"
                value={bookmarkIdx}
                onChanged={(idx: number) => {
                  HapticFeedback.heavyImpact()
                  setBookmarkIdx(idx)
                  const b = bookmarks[idx]
                  if (b?.path) {
                    const next: AppConfig = { ...cfg, baseDir: b.path }
                    setCfg(next)
                    try {
                      saveConfig(next)
                      props.onDone?.(next)
                    } catch {}
                  }
                }}
              >
                {bookmarks.map((b, index) => (
                  <Text key={b.name} tag={index}>
                    {b.name}
                  </Text>
                ))}
              </Picker>
            ) : null}
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

          <Section>
            <CenterRowButton title="保存" onPress={saveAndClose} />
            <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
