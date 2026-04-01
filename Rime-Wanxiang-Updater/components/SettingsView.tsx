// File: components/SettingsView.tsx
import {
  Button,
  Form,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  VStack,
  HStack,
  Toggle,
  Picker,
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
import { detectRimeDir, collectRimeCandidates } from "../utils/hamster"
import { clearMetaForRoot, loadMetaAsync } from "../utils/meta"
import { clearExtractedFilesForRoot } from "../utils/extracted_cache"
import { clearWanxiangTempFiles } from "../utils/cache_cleanup"
import { HomeSectionOrderView } from "./HomeSectionOrderView"

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
]

const RESET_STORAGE_KEYS = [
  "wanxiang_updater_config",
  "wanxiang_meta_store",
  "wanxiang_extracted_files",
  "wanxiang_check_cache",
]

function normalizeSchemeFromMeta(meta: any, fallback: AppConfig): { schemeEdition: AppConfig["schemeEdition"]; proSchemeKey: ProSchemeKey } | undefined {
  const edition = meta?.scheme?.schemeEdition
  if (edition !== "base" && edition !== "pro") return undefined
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
  if (input === "hamster" || input === "hamster3") return input
  if (detectedEngine === "元书输入法") return "hamster3"
  if (detectedEngine === "仓输入法") return "hamster"
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
}) {
  const dismiss = Navigation.useDismiss()

  const initialCfg = props.initial ?? loadConfig()
  const initialSchemeEdition = initialCfg.schemeEdition
  const initialProSchemeKey = initialCfg.proSchemeKey
  const initialHamsterRootPath = initialCfg.hamsterRootPath
  const initialHamsterBookmarkName = initialCfg.hamsterBookmarkName
  const [cfg, setCfg] = useState<AppConfig>(initialCfg)

  // ✅ 用 number 承载 Picker 值（与你示例一致）
  // 0=CNB 1=GitHub
  const [releaseIdx, setReleaseIdx] = useState<number>(initialCfg.releaseSource === "github" ? 1 : 0)
  // 0=base 1=pro
  const [schemeIdx, setSchemeIdx] = useState<number>(initialCfg.schemeEdition === "pro" ? 1 : 0)
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
    setCfg((c) => ({
      ...c,
      releaseSource: releaseIdx === 1 ? "github" : "cnb",
      schemeEdition: schemeIdx === 1 ? "pro" : "base",
      proSchemeKey: PRO_KEYS[Math.max(0, Math.min(PRO_KEYS.length - 1, proKeyIdx))],
      inputMethod: INPUT_METHODS[Math.max(0, Math.min(INPUT_METHODS.length - 1, inputIdx))].value,
    }))
  }, [releaseIdx, schemeIdx, proKeyIdx, inputIdx])

  const [alert, setAlert] = useState<AlertState>({
    title: "",
    isPresented: false,
    message: <Text>{" "}</Text>,
    actions: <Text>{" "}</Text>,
  })
  const [bookmarks, setBookmarks] = useState<{ name: string; path: string }[]>([])
  const [bookmarkIdx, setBookmarkIdx] = useState<number>(0)

  useEffect(() => {
    const latest = props.initial ?? loadConfig()
    setCfg(latest)
    setReleaseIdx(latest.releaseSource === "github" ? 1 : 0)
    setSchemeIdx(latest.schemeEdition === "pro" ? 1 : 0)
    const i = PRO_KEYS.indexOf(latest.proSchemeKey)
    setProKeyIdx(i >= 0 ? i : 0)
    const im = INPUT_METHODS.findIndex((m) => m.value === latest.inputMethod)
    setInputIdx(im >= 0 ? im : 0)
      ; (async () => {
        await refreshBookmarks(latest)
      })()
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

    setSchemeIdx(next.schemeEdition === "pro" ? 1 : 0)
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
    setBookmarks(cleaned)

    const targetName = current?.hamsterBookmarkName ?? cfg.hamsterBookmarkName
    const targetPath = current?.hamsterRootPath ?? cfg.hamsterRootPath
    if (cleaned.length) {
      let idx = -1
      if (targetName) idx = cleaned.findIndex((b) => b.name === targetName)
      if (idx < 0 && targetPath) idx = cleaned.findIndex((b) => b.path === targetPath)
      setBookmarkIdx(idx >= 0 ? idx : 0)
      if (idx >= 0) {
        const matched = cleaned[idx]
        const canUseByName = fm?.bookmarkExists
          ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [matched.name]))
          : true
        const resolved = fm?.bookmarkedPath && canUseByName
          ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [matched.name])) ?? "")
          : (matched.name ? "" : matched.path)
        const selectedPath = normalizePath(resolved || matched.path)
        const pathChanged = selectedPath !== normalizePath(targetPath) || matched.name !== targetName
        if (pathChanged) {
          try {
            let next = { ...loadConfig(), hamsterRootPath: selectedPath, hamsterBookmarkName: matched.name }
            next = await syncSchemeFromLocal(next)
            setCfg(next)
          } catch { }
        }
      } else if (!targetPath) {
        const first = cleaned[0]
        const canUseByName = fm?.bookmarkExists
          ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [first.name]))
          : true
        const resolved = fm?.bookmarkedPath && canUseByName
          ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [first.name])) ?? first.path)
          : first.path
        setCfg((c) => ({
          ...c,
          hamsterRootPath: resolved,
          hamsterBookmarkName: first.name,
        }))
      }
    } else {
      setBookmarkIdx(0)
    }
    return cleaned
  }

  async function saveAndClose() {
    let fixed: AppConfig = {
      ...cfg,
      // base 时 proKey 也可以保留，不影响；若你想 base 时清空也可以在这里处理
      proSchemeKey: PRO_KEYS[Math.max(0, Math.min(PRO_KEYS.length - 1, proKeyIdx))],
      inputMethod: INPUT_METHODS[Math.max(0, Math.min(INPUT_METHODS.length - 1, inputIdx))].value,
    }

    try {
      const pathChanged =
        fixed.hamsterRootPath !== initialHamsterRootPath ||
        fixed.hamsterBookmarkName !== initialHamsterBookmarkName
      if (pathChanged) {
        fixed = await syncSchemeFromLocal(fixed)
      }
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
      dismiss()
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
      setSchemeIdx(next.schemeEdition === "pro" ? 1 : 0)
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
  const schemeLabels = useMemo<string[]>(() => ["base", "pro"], [])
  const proLabels = useMemo<string[]>(() => PRO_KEYS.slice(), [])

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
                try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
                void saveAndClose()
              }}
            />
          ),
        }}
        alert={{
          title: alert.title,
          isPresented: alert.isPresented,
          onChanged: (v) => setAlert((a) => ({ ...a, isPresented: v })),
          message: alert.message,
          actions: alert.actions,
        }}
      >
        <Form formStyle="grouped">
          <Section header={<Text>Hamster 路径</Text>}>
            <TextField
              label={<Text>路径</Text>}
              value={cfg.hamsterRootPath}
              onChanged={(v: string) => setCfg((c) => ({ ...c, hamsterRootPath: v, hamsterBookmarkName: "" }))}
              prompt="粘贴或选择 Hamster 根目录"
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
                  try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch { }
                  setBookmarkIdx(idx)
                  const b = bookmarks[idx]
                  if (b?.path) {
                    ; (async () => {
                      const fm: any = (globalThis as any).FileManager ?? Runtime.FileManager
                      const canUseByName = fm?.bookmarkExists
                        ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [b.name]))
                        : true
                      const resolved = fm?.bookmarkedPath && canUseByName
                        ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [b.name])) ?? "")
                        : (b.name ? "" : b.path)
                      const selectedPath = normalizePath(resolved || b.path)
                      let next: AppConfig = {
                        ...cfg,
                        hamsterRootPath: selectedPath,
                        hamsterBookmarkName: b.name,
                      }
                      try {
                        next = await syncSchemeFromLocal(next)
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
            ) : null}
          </Section>

          <Section header={<Text>发布源</Text>}>
            {/* ✅ 参考你示例：必须有 title；menu 样式 */}
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
              <TextField
                label={<Text>GitHub Token</Text>}
                value={cfg.githubToken}
                onChanged={(v: string) => setCfg((c) => ({ ...c, githubToken: v }))}
                prompt="GitHub Token（可选）：提高请求限额"
                textFieldStyle="roundedBorder"
              />
            ) : null}
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

            {schemeIdx === 1 ? (
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
      </VStack>
    </NavigationStack>
  )
}
