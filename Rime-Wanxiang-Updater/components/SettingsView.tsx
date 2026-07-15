// File: components/SettingsView.tsx
import {
  Button,
  Form,
  Navigation,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  HStack,
  Toggle,
  Picker,
  Group,
  useEffect,
  useMemo,
  useState,
} from "scripting"

import { Runtime } from "../utils/runtime"
import {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
  type AppConfig,
  type HomeSectionKey,
  type ProSchemeKey,
  type InputMethod,
  PRO_KEYS,
  HOME_SECTION_LABELS,
} from "../utils/config"
import { callMaybeAsync, normalizePath, storage } from "../utils/common"
import { detectRimeDir, collectRimeCandidates, getScriptingRimePaths } from "../utils/hamster"
import { clearMetaForRoot, loadMetaAsync } from "../utils/meta"
import { clearExtractedFilesForRoot } from "../utils/extracted_cache"
import { clearWanxiangTempFiles } from "../utils/cache_cleanup"
import { HomeSectionOrderView } from "./HomeSectionOrderView"

const BUILTIN_SCRIPTING_BOOKMARK = "__builtin_scripting_rime__"
const BUILTIN_SCRIPTING_LABEL = "Scripting Rime"

type AlertNode = any
type AlertState = {
  title: string
  isPresented: boolean
  message: AlertNode
  actions: AlertNode
}

const INPUT_METHODS: { label: string; value: InputMethod }[] = [
  { label: "仓输入法", value: "hamster" },
  { label: "元书输入法", value: "hamster3" },
  { label: "Scripting", value: "scripting" },
]

const SCHEME_OPTIONS: AppConfig["schemeEdition"][] = ["base", "pro", "pure"]

const PRO_KEY_LABELS: Record<ProSchemeKey, string> = {
  moqi: "moqi-墨奇",
  flypy: "flypy-小鹤",
  zrm: "zrm-自然码",
  tiger: "tiger-虎码",
  wubi: "wubi-五笔",
  hanxin: "hanxin-汉心",
  shouyou: "shouyou-首右",
  shyplus: "shyplus-首右+",
  wx: "wx-万象",
}

const RESET_STORAGE_KEYS = [
  "wanxiang_updater_config",
  "wanxiang_meta_store",
  "wanxiang_extracted_files",
  "wanxiang_check_cache",
]

function maskToken(token: string, visible = 6): string {
  const value = String(token ?? "").trim()
  if (!value) return ""
  const head = value.slice(0, Math.min(visible, value.length))
  return `${head}${"•".repeat(Math.max(0, value.length - head.length))}`
}

function TokenField(props: {
  label: string
  value: string
  prompt: string
  onChanged: (value: string) => void
}) {
  async function openEditor() {
    try {
      try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
      const next = await Dialog.prompt({
        title: props.label,
        message: "修改后点击保存才会写入；取消不会修改当前 Token。清空内容并保存可移除 Token。",
        defaultValue: String(props.value ?? ""),
        placeholder: props.prompt,
        cancelLabel: "取消",
        confirmLabel: "保存",
        selectAll: false,
      })
      if (next != null) props.onChanged(next)
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <Button action={() => void openEditor()}>
      <HStack padding={{ top: 6, bottom: 6 }}>
        <Text>{props.label}</Text>
        <Spacer />
        <Text foregroundStyle={props.value ? "secondaryLabel" : "tertiaryLabel"}>
          {props.value ? maskToken(props.value) : "未填写"}
        </Text>
      </HStack>
    </Button>
  )
}

function normalizeSchemeFromMeta(meta: any, fallback: AppConfig): { schemeEdition: AppConfig["schemeEdition"]; proSchemeKey: ProSchemeKey } | undefined {
  const edition = meta?.scheme?.schemeEdition
  if (!SCHEME_OPTIONS.includes(edition)) return undefined
  const keyRaw = String(meta?.scheme?.proSchemeKey ?? "").toLowerCase()
  const key = (PRO_KEYS as string[]).includes(keyRaw) ? (keyRaw as ProSchemeKey) : fallback.proSchemeKey
  return {
    schemeEdition: edition,
    proSchemeKey: edition === "pro" ? key : fallback.proSchemeKey,
  }
}

function normalizeReleaseSourceFromMeta(meta: any): AppConfig["releaseSource"] | undefined {
  const source = String(
    meta?.scheme?.releaseSource ??
    meta?.dict?.releaseSource ??
    meta?.model?.releaseSource ??
    ""
  )
    .trim()
    .toLowerCase()
  if (source === "cnb" || source === "github") return source as AppConfig["releaseSource"]
  return undefined
}

function normalizeInputMethodFromMeta(meta: any, detectedEngine: string): InputMethod | undefined {
  const input = String(
    meta?.scheme?.inputMethod ??
    meta?.dict?.inputMethod ??
    meta?.model?.inputMethod ??
    ""
  )
    .trim()
    .toLowerCase()
  if (input === "hamster" || input === "hamster3" || input === "scripting") return input
  if (detectedEngine === "元书输入法") return "hamster3"
  if (detectedEngine === "仓输入法") return "hamster"
  if (detectedEngine === "Scripting") return "scripting"
  return undefined
}

function normalizePrereleaseSchemeFromMeta(meta: any): boolean | undefined {
  const value = meta?.scheme?.usePrereleaseScheme
  if (typeof value === "boolean") return value
  const raw = String(value ?? "").trim().toLowerCase()
  if (raw === "1" || raw === "true" || raw === "yes") return true
  if (raw === "0" || raw === "false" || raw === "no") return false
  if (String(meta?.scheme?.remoteTagOrName ?? "").trim().toLowerCase() === "dict-nightly") return true
  return undefined
}

async function collectMetaCandidatesAsync(base: AppConfig, detected?: string): Promise<string[]> {
  const out: string[] = []
  const push = (p?: string) => {
    const x = normalizePath(String(p ?? ""))
    if (x) out.push(x)
  }
  push(detected)
  push(base.hamsterRootPath)
  const roots = Array.from(new Set(out.filter(Boolean)))
  for (const r of roots) {
    const candidates = await collectRimeCandidates(r)
    for (const c of candidates) push(c)
  }
  return Array.from(new Set(out))
}

export function SettingsView(props: {
  initial?: AppConfig
  onDone?: (cfg: AppConfig) => void
  registerSaveAction?: (fn: (() => void) | null) => void
  leadingToolbar?: any
  trailingToolbar?: any
}) {
  const initialCfg = props.initial ?? loadConfig()
  const initialSchemeEdition = initialCfg.schemeEdition
  const initialProSchemeKey = initialCfg.proSchemeKey
  const initialHamsterRootPath = initialCfg.hamsterRootPath
  const initialHamsterBookmarkName = initialCfg.hamsterBookmarkName
  const [cfg, setCfg] = useState<AppConfig>(initialCfg)

  // ✅ 用 number 承载 Picker 值（与你示例一致）
  // 0=CNB 1=GitHub
  const [releaseIdx, setReleaseIdx] = useState<number>(initialCfg.releaseSource === "github" ? 1 : 0)
  const [schemeIdx, setSchemeIdx] = useState<number>(() => {
    const i = SCHEME_OPTIONS.indexOf(initialCfg.schemeEdition)
    return i >= 0 ? i : 0
  })
  // pro key index
  const [proKeyIdx, setProKeyIdx] = useState<number>(() => {
    const i = PRO_KEYS.indexOf(initialCfg.proSchemeKey)
    return i >= 0 ? i : 0
  })
  const [inputIdx, setInputIdx] = useState<number>(() => {
    const i = INPUT_METHODS.findIndex((m) => m.value === initialCfg.inputMethod)
    return i >= 0 ? i : 0
  })

  // 当 picker 变化时，同步回 cfg（保持 cfg 是最终保存对象）
  useEffect(() => {
    const inputMethod = INPUT_METHODS[Math.max(0, Math.min(INPUT_METHODS.length - 1, inputIdx))].value
    setCfg((c) => {
      const isBuiltinScripting = c.hamsterBookmarkName === BUILTIN_SCRIPTING_BOOKMARK
      return {
        ...c,
        releaseSource: releaseIdx === 1 ? "github" : "cnb",
        schemeEdition: SCHEME_OPTIONS[Math.max(0, Math.min(SCHEME_OPTIONS.length - 1, schemeIdx))],
        proSchemeKey: PRO_KEYS[Math.max(0, Math.min(PRO_KEYS.length - 1, proKeyIdx))],
        inputMethod: isBuiltinScripting ? "scripting" : inputMethod,
        useBuiltinScriptingPath: isBuiltinScripting ? true : (inputMethod === "scripting" ? c.useBuiltinScriptingPath : false),
      }
    })
  }, [releaseIdx, schemeIdx, proKeyIdx, inputIdx])

  const [alert, setAlert] = useState<AlertState>({
    title: "",
    isPresented: false,
    message: <Text>{" "}</Text>,
    actions: <Text>{" "}</Text>,
  })
  const [showSavedToast, setShowSavedToast] = useState(false)
  const [toastMessage, setToastMessage] = useState("已保存")
  const [bookmarks, setBookmarks] = useState<{ name: string; path: string }[]>([])
  const [bookmarkIdx, setBookmarkIdx] = useState<number>(0)

  useEffect(() => {
    const latest = props.initial ?? loadConfig()
    const normalizedLatest =
      latest.hamsterBookmarkName === BUILTIN_SCRIPTING_BOOKMARK
        ? { ...latest, inputMethod: "scripting" as const, useBuiltinScriptingPath: true }
        : latest
    setCfg(normalizedLatest)
    setReleaseIdx(normalizedLatest.releaseSource === "github" ? 1 : 0)
    const schemeIndex = SCHEME_OPTIONS.indexOf(normalizedLatest.schemeEdition)
    setSchemeIdx(schemeIndex >= 0 ? schemeIndex : 0)
    const i = PRO_KEYS.indexOf(normalizedLatest.proSchemeKey)
    setProKeyIdx(i >= 0 ? i : 0)
    const im = INPUT_METHODS.findIndex((m) => m.value === normalizedLatest.inputMethod)
    setInputIdx(im >= 0 ? im : 0)
      ; (async () => {
        await refreshBookmarks(normalizedLatest)
        if (normalizedLatest.hamsterBookmarkName === BUILTIN_SCRIPTING_BOOKMARK) {
          try {
            const scriptingPaths = await getScriptingRimePaths()
            if (scriptingPaths?.rootDir) {
              setCfg((c) => ({
                ...c,
                hamsterRootPath: scriptingPaths.rootDir,
                hamsterBookmarkName: BUILTIN_SCRIPTING_BOOKMARK,
                inputMethod: "scripting",
                useBuiltinScriptingPath: true,
              }))
            }
          } catch { }
        }
      })()
  }, [])

  useEffect(() => {
    void refreshBookmarks(cfg)
  }, [])

  function closeAlert() {
    setAlert((a) => ({ ...a, isPresented: false }))
  }

  function showInfo(title: string, msg: string) {
    setAlert({
      title,
      isPresented: true,
      message: <Text>{msg}</Text>,
      actions: (
        <Button
          title="OK"
          action={() => {
            try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
            closeAlert()
          }}
        />
      ),
    })
  }

  function presentToast(message: string) {
    setToastMessage(message)
    setShowSavedToast(true)
  }

  async function openHomeSectionOrderSettings() {
    await Navigation.present({
      element: (
        <HomeSectionOrderView
          initialOrder={cfg.homeSectionOrder}
          onDone={(order: HomeSectionKey[]) => {
            setCfg((c) => ({ ...c, homeSectionOrder: order }))
          }}
        />
      ),
    })
  }

  async function pickAndAddBookmark() {
    try {
      try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
      const picker: any =
        typeof DocumentPicker !== "undefined"
          ? DocumentPicker
          : (globalThis as any).DocumentPicker
      if (typeof picker?.pickDirectoryBookmark !== "function") {
        showInfo("当前版本不支持", "当前 Scripting 版本不支持直接选择并保存书签文件夹，请先升级 Scripting。")
        return
      }

      const result = await picker.pickDirectoryBookmark({
        preferredName: "Rime",
        initialDirectory: cfg.hamsterRootPath || undefined,
      })
      if (!result) return

      const bookmarkName = String(result.bookmarkName ?? "").trim()
      const pickedPath = normalizePath(String(result.path ?? ""))
      if (!bookmarkName || !pickedPath) {
        throw new Error("未获取到有效的书签目录")
      }

      let next: AppConfig = {
        ...cfg,
        hamsterRootPath: pickedPath,
        hamsterBookmarkName: bookmarkName,
        useBuiltinScriptingPath: false,
      }
      next = await syncSchemeFromLocal(next)
      setCfg(next)

      const updated = await refreshBookmarks(next)
      const nextIdx = updated.findIndex((b) => b.name === bookmarkName)
      if (nextIdx >= 0) setBookmarkIdx(nextIdx)
      presentToast("已添加书签文件夹")
    } catch (e: any) {
      showInfo("选择文件夹失败", String(e?.message ?? e))
    }
  }

  async function syncSchemeFromLocal(base: AppConfig): Promise<AppConfig> {
    let detected = ""
    let detectedEngine = ""
    try {
      const r = await detectRimeDir(base)
      const { rimeDir } = r
      detectedEngine = String(r?.engine ?? "")
      detected = rimeDir || ""
    } catch {
      detected = ""
      detectedEngine = ""
    }
    const candidates = await collectMetaCandidatesAsync(base, detected)
    if (!candidates.length && !base.hamsterBookmarkName) return base

    let meta: any = undefined
    for (const root of candidates) {
      try {
        const m = await loadMetaAsync(root, base.hamsterBookmarkName)
        if (m.scheme || m.dict || m.model) {
          meta = m
          break
        }
      } catch { }
    }
    if (!meta && base.hamsterBookmarkName) {
      try {
        const byBookmark = await loadMetaAsync("", base.hamsterBookmarkName)
        if (byBookmark.scheme || byBookmark.dict || byBookmark.model) {
          meta = byBookmark
        }
      } catch { }
    }
    if (!meta) return base
    const normalized = normalizeSchemeFromMeta(meta, base)
    const releaseSource = normalizeReleaseSourceFromMeta(meta)
    const inputMethod = normalizeInputMethodFromMeta(meta, detectedEngine)
    const usePrereleaseScheme = normalizePrereleaseSchemeFromMeta(meta)

    const next: AppConfig = {
      ...base,
      releaseSource: releaseSource ?? base.releaseSource,
      usePrereleaseScheme: usePrereleaseScheme ?? base.usePrereleaseScheme,
      inputMethod: inputMethod ?? base.inputMethod,
      schemeEdition: normalized?.schemeEdition ?? base.schemeEdition,
      proSchemeKey:
        normalized?.schemeEdition === "pro"
          ? normalized.proSchemeKey
          : base.proSchemeKey,
    }

    const changed =
      base.schemeEdition !== next.schemeEdition ||
      base.proSchemeKey !== next.proSchemeKey ||
      base.releaseSource !== next.releaseSource ||
      base.usePrereleaseScheme !== next.usePrereleaseScheme ||
      base.inputMethod !== next.inputMethod
    if (!changed) return base

    const schemeIndex = SCHEME_OPTIONS.indexOf(next.schemeEdition)
    setSchemeIdx(schemeIndex >= 0 ? schemeIndex : 0)
    const proIdx = PRO_KEYS.indexOf(next.proSchemeKey)
    setProKeyIdx(proIdx >= 0 ? proIdx : 0)
    setReleaseIdx(next.releaseSource === "github" ? 1 : 0)
    const inputMethodIdx = INPUT_METHODS.findIndex((m) => m.value === next.inputMethod)
    setInputIdx(inputMethodIdx >= 0 ? inputMethodIdx : 0)
    setCfg(next)
    return next
  }

  async function refreshBookmarks(current?: AppConfig): Promise<{ name: string; path: string }[]> {
    const fm: any = (globalThis as any).FileManager ?? Runtime.FileManager
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
    let combined = cleaned
    try {
      const scriptingPaths = await getScriptingRimePaths()
      if (scriptingPaths?.rootDir) {
        combined = [
          { name: BUILTIN_SCRIPTING_LABEL, path: scriptingPaths.rootDir },
          ...cleaned,
        ]
      }
    } catch { }
    setBookmarks(combined)

    const targetName = current?.hamsterBookmarkName ?? cfg.hamsterBookmarkName
    const targetPath = current?.hamsterRootPath ?? cfg.hamsterRootPath
    if (combined.length) {
      let idx = -1
      if (targetName === BUILTIN_SCRIPTING_BOOKMARK) {
        idx = combined.findIndex((b) => b.name === BUILTIN_SCRIPTING_LABEL)
      } else if (targetName) {
        idx = combined.findIndex((b) => b.name === targetName)
      }
      if (idx < 0 && targetPath) idx = combined.findIndex((b) => normalizePath(b.path) === normalizePath(targetPath))
      setBookmarkIdx(idx >= 0 ? idx : 0)
      if (idx >= 0) {
        const matched = combined[idx]
        const isBuiltinScripting = matched.name === BUILTIN_SCRIPTING_LABEL
        const canUseByName = !isBuiltinScripting && fm?.bookmarkExists
          ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [matched.name]))
          : true
        const resolved = !isBuiltinScripting && fm?.bookmarkedPath && canUseByName
          ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [matched.name])) ?? "")
          : matched.path
        const selectedPath = normalizePath(resolved || matched.path)
        const nextBookmarkName = isBuiltinScripting ? BUILTIN_SCRIPTING_BOOKMARK : matched.name
        const pathChanged = selectedPath !== normalizePath(targetPath) || nextBookmarkName !== targetName
        if (pathChanged) {
          try {
            if (isBuiltinScripting) {
              setInputIdx(INPUT_METHODS.findIndex((m) => m.value === "scripting"))
            }
            setCfg((live) => ({
              ...live,
              hamsterRootPath: selectedPath,
              hamsterBookmarkName: nextBookmarkName,
              useBuiltinScriptingPath: isBuiltinScripting,
              inputMethod: isBuiltinScripting ? "scripting" : live.inputMethod,
            }))
          } catch { }
        }
      } else if (!targetPath) {
        const first = combined[0]
        const isBuiltinScripting = first.name === BUILTIN_SCRIPTING_LABEL
        const canUseByName = !isBuiltinScripting && fm?.bookmarkExists
          ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [first.name]))
          : true
        const resolved = !isBuiltinScripting && fm?.bookmarkedPath && canUseByName
          ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [first.name])) ?? first.path)
          : first.path
        setCfg((c) => ({
          ...c,
          hamsterRootPath: resolved,
          hamsterBookmarkName: isBuiltinScripting ? BUILTIN_SCRIPTING_BOOKMARK : first.name,
          useBuiltinScriptingPath: isBuiltinScripting,
          inputMethod: isBuiltinScripting ? "scripting" : c.inputMethod,
        }))
        if (isBuiltinScripting) {
          setInputIdx(INPUT_METHODS.findIndex((m) => m.value === "scripting"))
        }
      }
    } else {
      setBookmarkIdx(0)
    }
    return combined
  }

  async function saveAndClose() {
    let fixed: AppConfig = {
      ...cfg,
      schemeEdition: SCHEME_OPTIONS[Math.max(0, Math.min(SCHEME_OPTIONS.length - 1, schemeIdx))],
      proSchemeKey: PRO_KEYS[Math.max(0, Math.min(PRO_KEYS.length - 1, proKeyIdx))],
      inputMethod:
        cfg.hamsterBookmarkName === BUILTIN_SCRIPTING_BOOKMARK
          ? "scripting"
          : INPUT_METHODS[Math.max(0, Math.min(INPUT_METHODS.length - 1, inputIdx))].value,
    }

    try {
      if (fixed.inputMethod === "scripting" && fixed.useBuiltinScriptingPath) {
        const scriptingPaths = await getScriptingRimePaths()
        if (!scriptingPaths?.rootDir) {
          throw new Error("无法获取 Scripting 内置 Rime 路径")
        }
        fixed = {
          ...fixed,
          hamsterRootPath: scriptingPaths.rootDir,
          hamsterBookmarkName: BUILTIN_SCRIPTING_BOOKMARK,
        }
      }
      const pathChanged =
        fixed.hamsterRootPath !== initialHamsterRootPath ||
        fixed.hamsterBookmarkName !== initialHamsterBookmarkName
      saveConfig(fixed)
      const schemeChanged =
        fixed.schemeEdition !== initialSchemeEdition ||
        (fixed.schemeEdition === "pro" && fixed.proSchemeKey !== initialProSchemeKey)
      if (schemeChanged && !pathChanged) {
        try {
          const { rimeDir } = await detectRimeDir(fixed)
          const installRoot = rimeDir || fixed.hamsterRootPath
          if (installRoot) {
            clearMetaForRoot(installRoot)
            clearExtractedFilesForRoot(installRoot)
          }
        } catch { }
      }
      props.onDone?.(fixed)
      presentToast("已保存")
    } catch (e: any) {
      showInfo("保存失败", String(e?.message ?? e))
    }
  }

  async function resetSettings() {
    try {
      const st = storage()
      for (const key of RESET_STORAGE_KEYS) {
        try {
          if (typeof st?.remove === "function") st.remove(key)
          else if (typeof st?.set === "function") st.set(key, "")
          else if (typeof st?.setString === "function") st.setString(key, "")
        } catch { }
      }

      const next: AppConfig = { ...DEFAULT_CONFIG }
      setCfg(next)
      setReleaseIdx(next.releaseSource === "github" ? 1 : 0)
      const schemeIndex = SCHEME_OPTIONS.indexOf(next.schemeEdition)
      setSchemeIdx(schemeIndex >= 0 ? schemeIndex : 0)
      setProKeyIdx(PRO_KEYS.indexOf(next.proSchemeKey))
      setInputIdx(INPUT_METHODS.findIndex((m) => m.value === next.inputMethod))
      props.onDone?.(next)
      showInfo("已重置设置", "已清理本地设置、更新记录和解压缓存记录。")
    } catch (e: any) {
      showInfo("重置失败", String(e?.message ?? e))
    }
  }

  async function clearCache() {
    try {
      const removedTempFiles = await clearWanxiangTempFiles()
      showInfo(
        "已清理缓存",
        `已清理临时文件 ${removedTempFiles} 个。`
      )
    } catch (e: any) {
      showInfo("清理缓存失败", String(e?.message ?? e))
    }
  }

  // 供 Picker 渲染用的文本数组（与你示例一致：Text tag={index}）
  const releaseLabels = useMemo<string[]>(() => ["CNB", "GitHub"], [])
  const schemeLabels = useMemo<string[]>(() => SCHEME_OPTIONS.slice(), [])
  const proLabels = useMemo<string[]>(() => PRO_KEYS.map((key) => PRO_KEY_LABELS[key] ?? key), [])
  const useBuiltinScriptingPath = cfg.hamsterBookmarkName === BUILTIN_SCRIPTING_BOOKMARK || (cfg.inputMethod === "scripting" && cfg.useBuiltinScriptingPath)
  const bookmarkContextMenu = {
    menuItems: (
      <Group>
        <Button
          title="选择新的文件夹"
          systemImage="folder.badge.plus"
          action={() => {
            void pickAndAddBookmark()
          }}
        />
      </Group>
    ),
  }

  useEffect(() => {
    props.registerSaveAction?.(() => {
      void saveAndClose()
    })
    return () => {
      props.registerSaveAction?.(null)
    }
  }, [cfg, releaseIdx, schemeIdx, proKeyIdx, inputIdx])

  const formContent = (
    <Form formStyle="grouped">
      <Section header={<Text>Rime 路径</Text>}>
        <TextField
          label={<Text>路径</Text>}
          value={cfg.hamsterRootPath}
          onChanged={(v: string) => {
            if (useBuiltinScriptingPath) return
            setCfg((c) => ({ ...c, hamsterRootPath: v, hamsterBookmarkName: "" }))
          }}
          prompt="粘贴或选择 Rime 根目录"
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
              try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch { }
              setBookmarkIdx(idx)
              const b = bookmarks[idx]
              if (b?.path) {
                ; (async () => {
                  const fm: any = (globalThis as any).FileManager ?? Runtime.FileManager
                  const isBuiltinScripting = b.name === BUILTIN_SCRIPTING_LABEL
                  const canUseByName = !isBuiltinScripting && fm?.bookmarkExists
                    ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [b.name]))
                    : true
                  const resolved = !isBuiltinScripting && fm?.bookmarkedPath && canUseByName
                    ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [b.name])) ?? "")
                    : b.path
                  const selectedPath = normalizePath(resolved || b.path)
                  let next: AppConfig = {
                    ...cfg,
                    hamsterRootPath: selectedPath,
                    hamsterBookmarkName: isBuiltinScripting ? BUILTIN_SCRIPTING_BOOKMARK : b.name,
                    useBuiltinScriptingPath: isBuiltinScripting,
                    inputMethod: isBuiltinScripting ? "scripting" : cfg.inputMethod,
                  }
                  if (isBuiltinScripting) {
                    setInputIdx(INPUT_METHODS.findIndex((m) => m.value === "scripting"))
                  }
                  try {
                    next = await syncSchemeFromLocal(next)
                    if (isBuiltinScripting) {
                      next = {
                        ...next,
                        inputMethod: "scripting",
                        useBuiltinScriptingPath: true,
                        hamsterBookmarkName: BUILTIN_SCRIPTING_BOOKMARK,
                      }
                    }
                    setCfg(next)
                  } catch { }
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

      <Section header={<Text>发布源</Text>}>
        <Picker
          title={"发布源"}
          pickerStyle="menu"
          value={releaseIdx}
          onChanged={(v: number) => {
            try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch { }
            setReleaseIdx(v)
          }}
        >
          {releaseLabels.map((label, index) => (
            <Text key={label} tag={index}>
              {label}
            </Text>
          ))}
        </Picker>

        <Toggle
          title={"预发布版本"}
          value={cfg.usePrereleaseScheme}
          onChanged={(v: boolean) => {
            try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch { }
            setCfg((c) => ({ ...c, usePrereleaseScheme: v }))
          }}
          toggleStyle="switch"
        />

        {releaseIdx === 1 ? (
          <TokenField
            label="GitHub Token"
            value={cfg.githubToken}
            onChanged={(v: string) => setCfg((c) => ({ ...c, githubToken: v }))}
            prompt="GitHub Token（可选）：提高请求限额"
          />
        ) : (
          <TokenField
            label="CNB Token"
            value={cfg.cnbToken}
            onChanged={(v: string) => setCfg((c) => ({ ...c, cnbToken: v }))}
            prompt="CNB Token（可选）：获取 release 哈希"
          />
        )}
      </Section>

      <Section header={<Text>方案选项</Text>}>
        <Picker
          title={"方案"}
          pickerStyle="menu"
          value={schemeIdx}
          onChanged={(v: number) => {
            try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch { }
            setSchemeIdx(v)
          }}
        >
          {schemeLabels.map((label, index) => (
            <Text key={label} tag={index}>
              {label}
            </Text>
          ))}
        </Picker>

        {SCHEME_OPTIONS[Math.max(0, Math.min(SCHEME_OPTIONS.length - 1, schemeIdx))] === "pro" ? (
          <Picker
            title={"Pro 辅助码"}
            pickerStyle="menu"
            value={proKeyIdx}
            onChanged={(v: number) => {
              try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch { }
              setProKeyIdx(v)
            }}
          >
            {proLabels.map((label, index) => (
              <Text key={label} tag={index}>
                {label}
              </Text>
            ))}
          </Picker>
        ) : null}
      </Section>

      <Section header={<Text>输入法</Text>}>
        <Picker
          title={"输入法"}
          pickerStyle="menu"
          value={inputIdx}
          onChanged={(v: number) => {
            try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch { }
            setInputIdx(v)
          }}
        >
          {INPUT_METHODS.map((m, index) => (
            <Text key={m.value} tag={index}>
              {m.label}
            </Text>
          ))}
        </Picker>
      </Section>

      <Section header={<Text>更新设置</Text>}>
        <Toggle
          title={"启动时自动检查更新"}
          value={cfg.autoCheckOnLaunch}
          onChanged={(v: boolean) => {
            try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch { }
            setCfg((c) => ({ ...c, autoCheckOnLaunch: v }))
          }}
          toggleStyle="switch"
        />
        <Toggle
          title={"更新时显示详细日志"}
          value={cfg.showVerboseLog}
          onChanged={(v: boolean) => {
            try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch { }
            setCfg((c) => ({ ...c, showVerboseLog: v }))
          }}
          toggleStyle="switch"
        />
        <Toggle
          title={"不清理部署目录(build)"}
          value={cfg.skipBuildCleanup}
          onChanged={(v: boolean) => {
            try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch { }
            setCfg((c) => ({ ...c, skipBuildCleanup: v }))
          }}
          toggleStyle="switch"
        />
      </Section>

      <Section header={<Text>页面显示设置</Text>}>
        <Button
          action={() => {
            try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
            void openHomeSectionOrderSettings()
          }}
        >
          <HStack frame={{ width: "100%" as any }} padding={{ top: 10, bottom: 10 }}>
            <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
              <Text>主页区块排序</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {cfg.homeSectionOrder.map((key) => HOME_SECTION_LABELS[key]).join(" / ")}
              </Text>
            </VStack>
          </HStack>
        </Button>
      </Section>

      <Section header={<Text>排除文件（按行）</Text>}>
        <TextField
          label={<Text>规则</Text>}
          value={cfg.excludePatternsText}
          onChanged={(v: string) => setCfg((c) => ({ ...c, excludePatternsText: v }))}
          axis="vertical"
          lineLimit={{ min: 6, max: 10 }}
          prompt={"例如：\nuser.yaml\n*.custom.yaml\ntips_show.txt"}
          textFieldStyle="roundedBorder"
        />
      </Section>

      <Section
        footer={(
          <Text font="caption" foregroundStyle="secondaryLabel">
            将主动清理临时下载文件，不会清理本地设置或缓存记录。
          </Text>
        )}
      >
        <Button
          action={() => {
            try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
            void clearCache()
          }}
        >
          <HStack frame={{ width: "100%" as any }} padding={{ top: 10, bottom: 6 }}>
            <Text
              font="headline"
              foregroundStyle="systemBlue"
              frame={{ maxWidth: "infinity", alignment: "center" as any }}
            >
              清理缓存
            </Text>
          </HStack>
        </Button>
      </Section>

      <Section
        footer={(
          <Text font="caption" foregroundStyle="secondaryLabel">
            将清理本地设置、更新记录和解压缓存记录。重置后需要重新选择路径并按需重新配置。
          </Text>
        )}
      >
        <Button
          role="destructive"
          action={() => {
            try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
            void resetSettings()
          }}
        >
          <HStack frame={{ width: "100%" as any }} padding={{ top: 10, bottom: 6 }}>
            <Text
              font="headline"
              foregroundStyle="systemRed"
              frame={{ maxWidth: "infinity", alignment: "center" as any }}
            >
              重置设置
            </Text>
          </HStack>
        </Button>
      </Section>
    </Form>
  )

  const screen = (
    <VStack
      navigationTitle={"设置"}
      navigationBarTitleDisplayMode={"inline"}
      toast={{
        isPresented: showSavedToast,
        onChanged: setShowSavedToast,
        message: toastMessage,
        duration: 1.5,
        position: "bottom",
      }}
      toolbar={
        props.leadingToolbar || props.trailingToolbar
          ? {
              topBarLeading: props.leadingToolbar,
              topBarTrailing: props.trailingToolbar,
            }
          : undefined
      }
      alert={{
        title: alert.title,
        isPresented: alert.isPresented,
        onChanged: (v) => setAlert((a) => ({ ...a, isPresented: v })),
        message: alert.message,
        actions: alert.actions,
      }}
    >
      {formContent}
    </VStack>
  )
  return screen
}
