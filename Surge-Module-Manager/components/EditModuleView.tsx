import {
  Button,
  Group,
  Form,
  Navigation,
  NavigationStack,
  EmptyView,
  List,
  Section,
  Text,
  TextField,
  VStack,
  HStack,
  Spacer,
  Picker,
  useEffect,
  useMemo,
  useState,
} from "scripting"

import { loadModules, type ModuleInfo } from "../utils/storage"

let cachedLibraryItems: ModuleInfo[] | null = null
let cachedLibraryError: string | null = null
let cachedLibraryPromise: Promise<ModuleInfo[]> | null = null

function CenterRowButton(props: {
  title: string
  role?: "cancel" | "destructive"
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Button role={props.role} action={props.onPress} disabled={props.disabled}>
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

export function EditModuleView(props: {
  title: string
  categories: string[]
  initial?: ModuleInfo
}) {
  const dismiss = Navigation.useDismiss()

  const initial = props.initial
  const [name, setName] = useState<string>(initial?.name ?? "")
  const [link, setLink] = useState<string>(initial?.link ?? "")
  const [libraryItems, setLibraryItems] = useState<ModuleInfo[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState("")
  const [existingLinks, setExistingLinks] = useState<Set<string>>(new Set())
  const [filterText, setFilterText] = useState("")
  const showLibrary = !initial

  const categoryOptions = useMemo<string[]>(() => ["不设置分类", ...props.categories], [props.categories])
  const initialIdx = Math.max(
    0,
    categoryOptions.findIndex((c) => c === (initial?.category ?? ""))
  )
  const [categoryIdx, setCategoryIdx] = useState<number>(initialIdx >= 0 ? initialIdx : 0)

  useEffect(() => {
    if (!showLibrary) return
    void loadLibrary()
    void loadExistingLinks()
  }, [showLibrary])

  async function loadExistingLinks() {
    try {
      const list = await loadModules()
      setExistingLinks(new Set(list.map((m) => m.link).filter(Boolean)))
    } catch {
      setExistingLinks(new Set())
    }
  }

  function decodeHtml(s: string): string {
    return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
  }

  function stripTags(s: string): string {
    const cleaned = decodeHtml(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    return cleaned.replace(/\.sgmodule\s*$/i, "").trim()
  }

  function extractLinks(html: string): ModuleInfo[] {
    const re = /<a\s+[^>]*href=["'](https:\/\/raw\.githubusercontent\.com[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    const list: ModuleInfo[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      const link = m[1]?.trim()
      const name = stripTags(m[2] ?? "")
      if (name && link) list.push({ name, link })
    }
    return list
  }

  function uniqueByLink(list: ModuleInfo[]): ModuleInfo[] {
    const seen = new Set<string>()
    const out: ModuleInfo[] = []
    for (const item of list) {
      if (seen.has(item.link)) continue
      seen.add(item.link)
      out.push(item)
    }
    return out
  }

  function pickSection(html: string, marker: string, endMarkers: string[]): string | null {
    const idx = html.indexOf(marker)
    if (idx < 0) return null
    let end = html.length
    for (const e of endMarkers) {
      const i = html.indexOf(e, idx + marker.length)
      if (i >= 0 && i < end) end = i
    }
    return html.slice(idx, end)
  }

  async function loadLibrary() {
    try {
      if (cachedLibraryItems) {
        setLibraryItems(cachedLibraryItems)
        setLibraryError(cachedLibraryError ?? "")
        return
      }
      if (cachedLibraryPromise) {
        setLibraryLoading(true)
        const list = await cachedLibraryPromise
        setLibraryItems(list)
        setLibraryError(cachedLibraryError ?? "")
        return
      }
      setLibraryLoading(true)
      setLibraryError("")
      cachedLibraryPromise = (async () => {
        const fetchFn: any = (globalThis as any).fetch
        if (typeof fetchFn !== "function") throw new Error("fetch 不可用")
        const res = await fetchFn("https://surge.qingr.moe/", {
          headers: { "User-Agent": "Mozilla/5.0" },
        })
        if (!res?.ok) throw new Error(`请求失败：${res?.status ?? "unknown"}`)
        const html = await res.text()

        const all = extractLinks(html)
        const preSection = pickSection(html, "前置依赖", ["Official", "Beta", "Others", "官方", "测试"]) ?? ""
        const pre = preSection ? extractLinks(preSection) : all.slice(0, 2)
        const preSet = new Set(pre.map((i) => i.link))
        const official = all.filter((i) => i.link.includes(".official.") && !preSet.has(i.link))
        const beta = all.filter((i) => i.link.includes(".beta.") && !preSet.has(i.link))
        const others = all.filter(
          (i) =>
            i.link.includes(".sgmodule") &&
            !i.link.includes(".official.") &&
            !i.link.includes(".beta.") &&
            !preSet.has(i.link)
        )
        return uniqueByLink([...pre, ...official, ...beta, ...others])
      })()

      const combined = await cachedLibraryPromise
      cachedLibraryItems = combined
      cachedLibraryError = null
      setLibraryItems(combined)
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      cachedLibraryError = msg
      setLibraryError(msg)
    } finally {
      setLibraryLoading(false)
    }
  }

  async function onSave() {
    const trimmedName = name.trim()
    const trimmedLink = link.trim()
    const cat = categoryOptions[categoryIdx] === "不设置分类" ? undefined : categoryOptions[categoryIdx]

    if (!trimmedName || !trimmedLink) {
      await Dialog.alert({ message: "名称和链接不能为空" })
      return
    }

    const result: ModuleInfo = {
      name: trimmedName,
      link: trimmedLink,
      category: cat,
    }
    dismiss(result)
  }

  async function openLink(url: string) {
    try {
      const Safari = (globalThis as any).Safari
      if (Safari?.openURL) {
        const ok = await Safari.openURL(url)
        if (!ok) throw new Error("打开 URL 失败")
        return
      }
      if (Safari?.open) {
        const ok = await Safari.open(url)
        if (ok === false) throw new Error("打开 URL 失败")
        return
      }
      const openURL = (globalThis as any).openURL
      if (typeof openURL === "function") {
        const ok = await openURL(url)
        if (ok === false) throw new Error("打开 URL 失败")
        return
      }
      throw new Error("无法打开 URL scheme：Safari.openURL/open/openURL 都不存在")
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function onSearch() {
    const input = await Dialog.prompt({
      title: "筛选模块",
      message: "输入关键字（留空清除筛选）",
      defaultValue: filterText,
      placeholder: "名称关键词",
    })
    if (input == null) return
    setFilterText(input.trim())
  }

  const shownItems = useMemo(() => {
    if (!filterText) return libraryItems
    const key = filterText.toLowerCase()
    return libraryItems.filter((m) => m.name.toLowerCase().includes(key))
  }, [libraryItems, filterText])

  return (
    <NavigationStack>
      <VStack navigationTitle={props.title} navigationBarTitleDisplayMode={"inline"}>
        <Form formStyle="grouped">
          <Section header={<Text>模块信息</Text>}>
            <TextField
              label={<Text>名称</Text>}
              value={name}
              onChanged={(v: string) => setName(v)}
              prompt="模块名称"
            />
            <TextField
              label={<Text>链接</Text>}
              value={link}
              onChanged={(v: string) => setLink(v)}
              prompt="https://"
            />
          </Section>

          <Section header={<Text>分类</Text>}>
            <Picker
              title={"模块分类"}
              pickerStyle="menu"
              value={categoryIdx}
              onChanged={(idx: number) => setCategoryIdx(idx)}
            >
              {categoryOptions.map((c, idx) => (
                <Text key={`${c}-${idx}`} tag={idx}>
                  {c}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section>
            <CenterRowButton title="保存" onPress={onSave} />
            <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
          </Section>

          {showLibrary ? (
            <Section
              header={(
                <HStack>
                  <Text>在线模块(来自</Text>
                  <Button title="LoonKissSurge" action={() => openLink("https://github.com/QingRex/LoonKissSurge/")} />
                  <Text>)</Text>
                  <Spacer />
                  <Button title="" systemImage="magnifyingglass" action={onSearch} />
                </HStack>
              )}
            >
              {libraryLoading ? <Text>加载中...</Text> : null}
              {libraryError ? <Text>{libraryError}</Text> : null}
              {filterText ? (
                <HStack>
                  <Text>筛选：{filterText}</Text>
                  <Spacer />
                  <Button title="清除" action={() => setFilterText("")} />
                </HStack>
              ) : null}
              <List listStyle="plain" frame={{ height: 360 }}>
                {shownItems.map((item) => {
                  const existed = existingLinks.has(item.link)
                  return (
                    <VStack
                      key={item.link}
                      listRowBackground={<EmptyView />}
                      contextMenu={{
                        menuItems: (
                          <Group>
                            <Button title="复制名称" action={() => Pasteboard.setString(item.name)} />
                            <Button title="复制链接" action={() => Pasteboard.setString(item.link)} />
                            <Button title="打开链接" action={() => openLink(item.link)} />
                          </Group>
                        ),
                      }}
                    >
                      <HStack padding={{ top: 8, bottom: 8 }}>
                        <Text>{item.name}</Text>
                        <Spacer />
                        {existed ? (
                          <Text foregroundStyle="secondaryLabel">已添加</Text>
                        ) : (
                          <Button
                            title="添加"
                            buttonStyle="borderedProminent"
                            tint="systemGreen"
                            action={() => {
                              setName(item.name)
                              setLink(item.link)
                            }}
                          />
                        )}
                      </HStack>
                    </VStack>
                  )
                })}
              </List>
            </Section>
          ) : null}
        </Form>
      </VStack>
    </NavigationStack>
  )
}
