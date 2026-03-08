// File: components/HomeView.tsx
import {
  Button,
  List,
  Navigation,
  NavigationStack,
  Script,
  Section,
  Divider,
  Spacer,
  Text,
  HStack,
  VStack,
  ScrollView,
  ScrollViewReader,
  ProgressView,
  useEffect,
  useRef,
  useState,
  Markdown,
  Path,
} from "scripting"

import {
  loadConfig,
  saveConfig,
  type AppConfig,
  type HomeSectionKey,
  type ProSchemeKey,
  PRO_KEYS,
} from "../utils/config"
import { SettingsView } from "./SettingsView"
import { loadMetaAsync, type MetaBundle } from "../utils/meta"
import { detectRimeDir, verifyInstallPathAccess, collectRimeCandidates } from "../utils/hamster"
import {
  checkAllUpdates,
  updateScheme,
  updateDict,
  updateModel,
  autoUpdateAll,
  deployInputMethod,
  type AllUpdateResult,
} from "../utils/update_tasks"

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function readFraction(x: any): number | undefined {
  const toNum = (v: any) => {
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string") {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return undefined
  }

  const direct = toNum(x)
  if (direct !== undefined) return direct

  const p1 = toNum(x?.percent)
  if (p1 !== undefined) return p1

  const p2 = toNum(x?.fractionCompleted)
  if (p2 !== undefined) return p2

  const p3 = toNum(x?.progress?.fractionCompleted)
  if (p3 !== undefined) return p3

  return undefined
}

function pctFromFraction(f?: number) {
  const v = typeof f === "number" && Number.isFinite(f) ? clamp01(f) : 0
  return `${(v * 100).toFixed(2)}%`
}

function selectedSchemeFromConfig(cfg: AppConfig): string {
  return cfg.schemeEdition === "base" ? "base" : `pro (${cfg.proSchemeKey})`
}

function normalizeMetaScheme(
  metaScheme: MetaBundle["scheme"],
  fallback: AppConfig
): {
  selected: string
  schemeEdition?: AppConfig["schemeEdition"]
  proSchemeKey?: ProSchemeKey
} {
  if (!metaScheme) return { selected: selectedSchemeFromConfig(fallback) }
  const edition = metaScheme.schemeEdition
  const proKey = metaScheme.proSchemeKey
  const validProKey = proKey && (PRO_KEYS as string[]).includes(proKey) ? proKey : undefined
  const selected =
    metaScheme.selectedScheme ??
    (edition === "base"
      ? "base"
      : edition === "pro"
        ? `pro (${validProKey ?? fallback.proSchemeKey})`
        : selectedSchemeFromConfig(fallback))
  return {
    selected,
    schemeEdition: edition,
    proSchemeKey: edition === "pro" ? (validProKey ?? fallback.proSchemeKey) : undefined,
  }
}

function GridButton(props: { title: string; disabled?: boolean; onPress: () => void }) {
  const haptic = () => {
    try {
      ; (globalThis as any).HapticFeedback?.mediumImpact?.()
    } catch { }
  }
  return (
    <Button
      action={() => {
        haptic()
        props.onPress()
      }}
      disabled={props.disabled}
      buttonStyle="plain"
      tint={props.disabled ? "secondaryLabel" : "systemBlue"}
      frame={{ maxWidth: "infinity", minHeight: 60 }}
    >
      <Text
        font="headline"
        frame={{ maxWidth: "infinity" }}
        multilineTextAlignment="center"
        foregroundStyle={props.disabled ? "secondaryLabel" : "systemBlue"}
        padding={{ top: 18, bottom: 18 }}
      >
        {props.title}
      </Text>
    </Button>
  )
}

function RowKV(props: { k: string; v: string }) {
  return (
    <HStack>
      <Text>{props.k}</Text>
      <Spacer />
      <Text>{props.v}</Text>
    </HStack>
  )
}

type AlertNode = any
type AlertState = {
  title: string
  isPresented: boolean
  message: AlertNode
  actions: AlertNode
}

type LogLevel = "INFO" | "WARN" | "ERROR" | "SUCCESS"
type LogScope = "SYSTEM" | "CHECK" | "SCHEME" | "DICT" | "MODEL" | "AUTO" | "DEPLOY" | "PATH"

type LogEntry = {
  id: string
  at: string
  level: LogLevel
  scope: LogScope
  message: string
}

type HomeSessionState = {
  remoteSchemeVer: string
  remoteDictMark: string
  remoteModelMark: string
  notes: string
  lastCheck: AllUpdateResult | null
  lastCheckKey: string
  logs: LogEntry[]
}

const DEFAULT_HOME_SESSION_STATE: HomeSessionState = {
  remoteSchemeVer: "请检查更新",
  remoteDictMark: "请检查更新",
  remoteModelMark: "请检查更新",
  notes: "请检查更新",
  lastCheck: null,
  lastCheckKey: "",
  logs: [],
}

let homeSessionState: HomeSessionState = { ...DEFAULT_HOME_SESSION_STATE }
let launchAutoCheckHandled = false

function nowTimeLabel(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function makeLogEntry(level: LogLevel, scope: LogScope, message: string): LogEntry {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: nowTimeLabel(),
    level,
    scope,
    message: String(message ?? "").trim(),
  }
}

function replacePathPrefix(message: string, rootPath: string): string {
  const root = String(rootPath ?? "").trim().replace(/\/+$/, "")
  if (!root) return message
  const slash = root.lastIndexOf("/")
  const rootName = slash >= 0 ? root.slice(slash + 1) : root
  if (!rootName) return message
  const variants = new Set<string>([root])
  if (root.startsWith("/private/")) variants.add(root.slice("/private".length))
  else if (root.startsWith("/")) variants.add(`/private${root}`)
  let out = message
  for (const variant of variants) {
    out = out.split(variant).join(rootName)
  }
  return out
}

export function HomeView() {
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())
  const logProxyRef = useRef<any>()

  // 本地信息
  const [localSelectedScheme, setLocalSelectedScheme] = useState("暂无法获取")
  const [localSchemeVersion, setLocalSchemeVersion] = useState("暂无法获取")
  const [localDictMark, setLocalDictMark] = useState("暂无法获取")
  const [localModelMark, setLocalModelMark] = useState("暂无法获取")

  // 远程信息
  const [remoteSchemeVer, setRemoteSchemeVer] = useState(() => homeSessionState.remoteSchemeVer)
  const [remoteDictMark, setRemoteDictMark] = useState(() => homeSessionState.remoteDictMark)
  const [remoteModelMark, setRemoteModelMark] = useState(() => homeSessionState.remoteModelMark)
  const [notes, setNotes] = useState(() => homeSessionState.notes)
  const [lastCheck, setLastCheck] = useState<AllUpdateResult | null>(() => homeSessionState.lastCheck)
  const [lastCheckKey, setLastCheckKey] = useState(() => homeSessionState.lastCheckKey)
  const [logs, setLogs] = useState<LogEntry[]>(() => homeSessionState.logs)

  // 状态
  const [stage, setStage] = useState("就绪")
  const [progressPct, setProgressPct] = useState("0.00%")
  const [progressValue, setProgressValue] = useState<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [pathUsable, setPathUsable] = useState(false)
  const [alert, setAlert] = useState<AlertState>({
    title: "",
    isPresented: false,
    message: <Text>{" "}</Text>,
    actions: <Text>{" "}</Text>,
  })

  // ✅ 只在“真正下载”时显示进度
  const [showProgress, setShowProgress] = useState(false)

  function resetRemote() {
    setRemoteSchemeVer(DEFAULT_HOME_SESSION_STATE.remoteSchemeVer)
    setRemoteDictMark(DEFAULT_HOME_SESSION_STATE.remoteDictMark)
    setRemoteModelMark(DEFAULT_HOME_SESSION_STATE.remoteModelMark)
    setNotes(DEFAULT_HOME_SESSION_STATE.notes)
    setLastCheck(DEFAULT_HOME_SESSION_STATE.lastCheck)
    setLastCheckKey(DEFAULT_HOME_SESSION_STATE.lastCheckKey)
  }

  function checkKey(c: AppConfig) {
    return [c.releaseSource, c.schemeEdition, c.proSchemeKey, c.hamsterRootPath, c.hamsterBookmarkName].join("|")
  }

  function closeAlert() {
    setAlert((a) => ({ ...a, isPresented: false }))
  }

  function pushLog(level: LogLevel, scope: LogScope, message: string, targetCfg?: AppConfig) {
    const currentCfg = targetCfg ?? cfg
    if (!currentCfg.showVerboseLog) return
    let normalizedMessage = String(message ?? "").trim()
    normalizedMessage = replacePathPrefix(normalizedMessage, currentCfg.hamsterRootPath)
    const entry = makeLogEntry(level, scope, normalizedMessage)
    setLogs((prev) => {
      const next = prev.concat(entry)
      return next.length > 200 ? next.slice(next.length - 200) : next
    })
  }

  function setStageAndMaybeLog(message: string, scope: LogScope = "SYSTEM", level: LogLevel = "INFO", logIt = false) {
    setStage(message)
    if (logIt) pushLog(level, scope, message)
  }

  function wrapStageReporter(scope: LogScope) {
    return (message: string) => {
      setStageAndMaybeLog(message, scope, "INFO", true)
    }
  }

  function wrapDetailLogger(scope: LogScope, level: LogLevel = "INFO") {
    return (message: string) => {
      pushLog(level, scope, message)
    }
  }

  async function guardPathAccess(showPopup: boolean): Promise<boolean> {
    const current = loadConfig()
    const r = await verifyInstallPathAccess(current)
    if (r.ok) {
      setPathUsable(true)
      return true
    }
    setPathUsable(false)
    setStageAndMaybeLog("路径不可用，请在设置中添加或重新添加书签文件夹。", "PATH", "WARN", true)
    if (showPopup) {
      const msg = r.reason ? `${r.reason}\n请在设置中添加或重新添加书签文件夹。` : "请在设置中添加或重新添加书签文件夹。"
      setAlert({
        title: "路径不可用",
        isPresented: true,
        message: <Text>{msg}</Text>,
        actions: (
          <HStack>
            <Button
              title="取消"
              action={() => {
                try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
                closeAlert()
              }}
            />
            <Button
              title="确认"
              action={() => {
                try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
                closeAlert()
                Script.exit()
              }}
            />
          </HStack>
        ),
      })
    }
    return false
  }

  async function refreshLocal(current: AppConfig): Promise<boolean> {
    const normPath = (s: string) => String(s ?? "").trim().replace(/\/+$/, "")
    const pushCandidate = (arr: string[], p?: string) => {
      const x = normPath(String(p ?? ""))
      if (x) arr.push(x)
    }

    const selected = selectedSchemeFromConfig(current)
    setLocalSelectedScheme(selected)

    let installRoot = ""
    try {
      const { rimeDir } = await detectRimeDir(current)
      if (rimeDir) installRoot = rimeDir
    } catch { }
    if (!installRoot) {
      installRoot = current.hamsterRootPath
    }

    const candidates: string[] = []
    pushCandidate(candidates, installRoot)
    if (current.hamsterRootPath && normPath(current.hamsterRootPath) !== normPath(installRoot)) {
      pushCandidate(candidates, current.hamsterRootPath)
    }
    if (current.hamsterRootPath) {
      const rimeCandidates = await collectRimeCandidates(current.hamsterRootPath)
      for (const c of rimeCandidates) pushCandidate(candidates, c)
    }

    try {
      const fm: any = (globalThis as any).FileManager
      if (fm?.bookmarkedPath && (current.hamsterBookmarkName || current.hamsterRootPath)) {
        if (current.hamsterBookmarkName) {
          const p = fm.bookmarkedPath(current.hamsterBookmarkName)
          const resolved = p && typeof p.then === "function" ? await p : p
          if (resolved) pushCandidate(candidates, String(resolved))
        }
      }
      if (fm?.getAllFileBookmarks) {
        const r = fm.getAllFileBookmarks()
        const list = r && typeof r.then === "function" ? await r : r
        const arr = Array.isArray(list) ? list : []
        if (current.hamsterBookmarkName) {
          const byName = arr.find((b: any) => String(b?.name ?? "") === current.hamsterBookmarkName)
          if (byName?.path) pushCandidate(candidates, String(byName.path))
          if (byName?.name && fm?.bookmarkedPath) {
            const p = fm.bookmarkedPath(byName.name)
            const resolved = p && typeof p.then === "function" ? await p : p
            if (resolved) pushCandidate(candidates, String(resolved))
          }
        }
        if (current.hamsterRootPath) {
          const target = normPath(String(current.hamsterRootPath))
          const byPath = arr.find((b: any) => normPath(String(b?.path ?? "")) === target)
          if (byPath?.path) pushCandidate(candidates, String(byPath.path))
          if (byPath?.name && fm?.bookmarkedPath) {
            const p = fm.bookmarkedPath(byPath.name)
            const resolved = p && typeof p.then === "function" ? await p : p
            if (resolved) pushCandidate(candidates, String(resolved))
          }
        }
      }
    } catch { }

    const uniq = Array.from(new Set(candidates.map(normPath).filter(Boolean)))
    let meta: MetaBundle | undefined
    for (const root of uniq) {
      const m = await loadMetaAsync(root, current.hamsterBookmarkName)
      if (m.scheme || m.dict || m.model) {
        meta = m
        break
      }
    }
    if (!meta && current.hamsterBookmarkName) {
      try {
        const byBookmark = await loadMetaAsync("", current.hamsterBookmarkName)
        if (byBookmark.scheme || byBookmark.dict || byBookmark.model) {
          meta = byBookmark
        }
      } catch { }
    }

    if (!uniq.length || !meta) {
      setLocalSchemeVersion("暂无法获取")
      setLocalDictMark("暂无法获取")
      setLocalModelMark("暂无法获取")
      return false
    }

    const localScheme = normalizeMetaScheme(meta.scheme, current)
    setLocalSelectedScheme(localScheme.selected)
    if (
      localScheme.schemeEdition &&
      (current.schemeEdition !== localScheme.schemeEdition ||
        (localScheme.schemeEdition === "pro" &&
          localScheme.proSchemeKey &&
          current.proSchemeKey !== localScheme.proSchemeKey))
    ) {
      try {
        const next: AppConfig = {
          ...current,
          schemeEdition: localScheme.schemeEdition,
          proSchemeKey:
            localScheme.schemeEdition === "pro" && localScheme.proSchemeKey
              ? localScheme.proSchemeKey
              : current.proSchemeKey,
        }
        saveConfig(next)
        setCfg(next)
      } catch { }
    }

    setLocalSchemeVersion(meta.scheme?.remoteTagOrName ?? "暂无法获取")
    setLocalDictMark(meta.dict?.remoteIdOrSha ?? "暂无法获取")
    setLocalModelMark(meta.model?.remoteIdOrSha ?? "暂无法获取")
    return true
  }

  useEffect(() => {
    homeSessionState = {
      remoteSchemeVer,
      remoteDictMark,
      remoteModelMark,
      notes,
      lastCheck,
      lastCheckKey,
      logs,
    }
  }, [remoteSchemeVer, remoteDictMark, remoteModelMark, notes, lastCheck, lastCheckKey, logs])

  useEffect(() => {
    if (!cfg.showVerboseLog) return
    const scrollLatest = () => {
      try {
        logProxyRef.current?.scrollTo?.("log-bottom", "bottom")
      } catch { }
    }
    scrollLatest()
    const intervalId = busy ? setInterval(scrollLatest, 100) : undefined
    const finalTimer = setTimeout(scrollLatest, 120)
    return () => {
      if (intervalId !== undefined) clearInterval(intervalId)
      clearTimeout(finalTimer)
    }
  }, [cfg.showVerboseLog, busy, logs.length])

  useEffect(() => {
    const current = loadConfig()
    setCfg(current)
    void (async () => {
      await guardPathAccess(true)
      await refreshLocal(current)
    })()
  }, [cfg.schemeEdition, cfg.proSchemeKey, cfg.releaseSource, cfg.hamsterRootPath, cfg.hamsterBookmarkName])

  useEffect(() => {
    const current = loadConfig()
    if (current.autoCheckOnLaunch && !launchAutoCheckHandled) {
      launchAutoCheckHandled = true
      void (async () => {
        if (await guardPathAccess(false)) {
          await onCheckUpdate()
        }
      })()
    }
  }, [])

  async function openSettings() {
    const before = loadConfig()
    const beforeKey = checkKey(before)
    await Navigation.present({
      element: (
        <SettingsView
          initial={loadConfig()}
          onDone={(newCfg) => {
            const changed = checkKey(newCfg) !== checkKey(cfg)
            setCfg(newCfg)
            void (async () => {
              await guardPathAccess(false)
              await refreshLocal(newCfg)
            })()
            if (changed) resetRemote()
          }}
        />
      ),
    })
    const current = loadConfig()
    setCfg(current)
    await guardPathAccess(false)
    const hasLocal = await refreshLocal(current)
    const afterKey = checkKey(current)
    if (afterKey !== beforeKey) {
      resetRemote()
      const pathChanged =
        current.hamsterRootPath !== before.hamsterRootPath ||
        current.hamsterBookmarkName !== before.hamsterBookmarkName
      if (pathChanged && current.autoCheckOnLaunch && hasLocal) {
        await onCheckUpdate()
      }
    }
  }

  async function openTextEditor() {
    try {
      const current = loadConfig()
      const fm: any = (globalThis as any).FileManager
      let initialDirectory = String(current.hamsterRootPath ?? "").trim()
      if (current.hamsterBookmarkName && fm?.bookmarkedPath) {
        try {
          const canUseByName = fm?.bookmarkExists
            ? !!(await fm.bookmarkExists(current.hamsterBookmarkName))
            : true
          if (canUseByName) {
            const resolved = await fm.bookmarkedPath(current.hamsterBookmarkName)
            if (resolved) initialDirectory = String(resolved).trim()
          }
        } catch { }
      }

      const files = await DocumentPicker.pickFiles({
        types: ["public.text"],
        initialDirectory: initialDirectory || undefined,
      })
      if (!Array.isArray(files) || files.length === 0) return

      const filePath = String(files[0] ?? "")
      if (!filePath) return

      const ext = Path.extname(filePath).slice(1) || "md"
      const content = await FileManager.readAsString(filePath, "utf-8")

      const editor = new EditorController({
        ext: ext as any,
      })
      editor.content = content
      editor.onContentChanged = async (newContent: string) => {
        try {
          await FileManager.writeAsString(filePath, newContent, "utf-8")
        } catch (error: any) {
          console.error("保存文件失败：", error)
          setStageAndMaybeLog(`保存文件失败：${String(error?.message ?? error)}`, "SYSTEM", "ERROR", true)
        }
      }

      await editor.present()
      editor.dispose()
    } catch (error: any) {
      setStageAndMaybeLog(`打开编辑器失败：${String(error?.message ?? error)}`, "SYSTEM", "ERROR", true)
    }
  }

  function closeScript() {
    try {
      ; (globalThis as any).HapticFeedback?.mediumImpact?.()
    } catch { }
    Script.exit()
  }

  function applyProgress(tag: "scheme" | "dict" | "model" | "auto", p: any) {
    // ✅ HomeView 侧日志
    try {
      console.log(`[${tag}] progress:`, {
        percent: p?.percent,
        received: p?.received,
        total: p?.total,
        speedBps: p?.speedBps,
      })
    } catch { }

    const toNum = (v: any): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v
      if (typeof v === "string") {
        const n = Number(v)
        if (Number.isFinite(n)) return n
      }
      return undefined
    }
    const received = toNum(p?.received ?? p?.completedUnitCount ?? p?.progress?.completedUnitCount) ?? 0
    const f = readFraction(p?.percent ?? p?.fractionCompleted ?? p?.progress?.fractionCompleted)
    if (received > 0 || (typeof f === "number" && f > 0)) {
      setShowProgress(true)
    }
    if (typeof f === "number") {
      const v = clamp01(f)
      setProgressValue(v)
      setProgressPct(pctFromFraction(v))
    }
  }

  // ===== 操作 =====

  async function onCheckUpdate() {
    if (!(await guardPathAccess(true))) return
    setBusy(true)
    setShowProgress(false) // ✅ 检查更新不显示进度
    setStageAndMaybeLog("检查更新中…", "CHECK", "INFO", true)
    setProgressPct("0.00%")
    setProgressValue(undefined)
    setRemoteSchemeVer("检查更新中...")
    setRemoteDictMark("检查更新中...")
    setRemoteModelMark("检查更新中...")
    setNotes("检查更新中...")
    try {
      const current = loadConfig()
      await refreshLocal(current)

      const r = await checkAllUpdates(current)
      setRemoteSchemeVer(r.scheme?.tag ?? r.scheme?.name ?? "暂无法获取")
      setRemoteDictMark(r.dict?.remoteIdOrSha ?? "暂无法获取")
      setRemoteModelMark(r.model?.remoteIdOrSha ?? "暂无法获取")
      setNotes(r.scheme?.body ?? "")
      setLastCheck(r)
      setLastCheckKey(checkKey(current))

      pushLog("SUCCESS", "CHECK", `远程方案：${r.scheme?.tag ?? r.scheme?.name ?? "暂无法获取"}`)
      pushLog("SUCCESS", "CHECK", `远程词库：${r.dict?.remoteIdOrSha ?? "暂无法获取"}`)
      pushLog("SUCCESS", "CHECK", `远程模型：${r.model?.remoteIdOrSha ?? "暂无法获取"}`)
      setStageAndMaybeLog("检查完成", "CHECK", "SUCCESS", true)
    } catch (e: any) {
      setStageAndMaybeLog(`检查失败：${String(e?.message ?? e)}`, "CHECK", "ERROR", true)
    } finally {
      setBusy(false)
    }
  }

  async function onAutoUpdate() {
    if (!(await guardPathAccess(true))) return
    setBusy(true)
    setShowProgress(false) // ✅ 真正有下载进度后再显示
    setStageAndMaybeLog("自动更新中…", "AUTO", "INFO", true)
    setProgressPct("0.00%")
    setProgressValue(undefined)
    try {
      const current = loadConfig()
      await refreshLocal(current)

      const key = checkKey(current)
      let pre = lastCheck
      if (!pre || lastCheckKey !== key) {
        // 检查阶段也不显示进度（避免误导）
        setShowProgress(false)
        setStageAndMaybeLog("自动更新：检查更新中…", "AUTO", "INFO", true)
        setRemoteSchemeVer("检查更新中...")
        setRemoteDictMark("检查更新中...")
        setRemoteModelMark("检查更新中...")
        setNotes("检查更新中...")
        pre = await checkAllUpdates(current)
        setRemoteSchemeVer(pre.scheme?.tag ?? pre.scheme?.name ?? "暂无法获取")
        setRemoteDictMark(pre.dict?.remoteIdOrSha ?? "暂无法获取")
        setRemoteModelMark(pre.model?.remoteIdOrSha ?? "暂无法获取")
        setNotes(pre.scheme?.body ?? "")
        setLastCheck(pre)
        setLastCheckKey(key)
      }

      const autoResult = await autoUpdateAll(
        current,
        {
          onStage: wrapStageReporter("AUTO"),
          onLog: wrapDetailLogger("AUTO"),
          onProgress: (p) => applyProgress("auto", p),
        },
        pre
      )

      await refreshLocal(current)
      if (!autoResult.didUpdate) {
        setStageAndMaybeLog("自动更新完成（已是最新，无需更新）", "AUTO", "SUCCESS", true)
      } else if (autoResult.didDeploy) {
        setStageAndMaybeLog("自动更新完成（已部署）", "AUTO", "SUCCESS", true)
      } else {
        setStageAndMaybeLog("自动更新完成（未自动部署）", "AUTO", "SUCCESS", true)
      }
    } catch (e: any) {
      setStageAndMaybeLog(`自动更新失败：${String(e?.message ?? e)}`, "AUTO", "ERROR", true)
    } finally {
      setBusy(false)
      setShowProgress(false)
      setProgressValue(undefined)
    }
  }

  async function onUpdateScheme() {
    if (!(await guardPathAccess(true))) return
    setBusy(true)
    setShowProgress(false) // ✅ 真正有下载进度后再显示
    setStageAndMaybeLog("更新方案中…", "SCHEME", "INFO", true)
    setProgressPct("0.00%")
    setProgressValue(undefined)
    try {
      const current = loadConfig()
      await updateScheme(current, {
        autoDeploy: false,
        onStage: wrapStageReporter("SCHEME"),
        onLog: wrapDetailLogger("SCHEME"),
        onProgress: (p) => applyProgress("scheme", p),
      })
      await refreshLocal(current)
      setStageAndMaybeLog("更新方案完成", "SCHEME", "SUCCESS", true)
    } catch (e: any) {
      setStageAndMaybeLog(`更新方案失败：${String(e?.message ?? e)}`, "SCHEME", "ERROR", true)
    } finally {
      setBusy(false)
      setShowProgress(false)
      setProgressValue(undefined)
    }
  }

  async function onUpdateDict() {
    if (!(await guardPathAccess(true))) return
    setBusy(true)
    setShowProgress(false) // ✅ 真正有下载进度后再显示
    setStageAndMaybeLog("更新词库中…", "DICT", "INFO", true)
    setProgressPct("0.00%")
    setProgressValue(undefined)
    try {
      const current = loadConfig()
      await updateDict(current, {
        autoDeploy: false,
        onStage: wrapStageReporter("DICT"),
        onLog: wrapDetailLogger("DICT"),
        onProgress: (p) => applyProgress("dict", p),
      })
      await refreshLocal(current)
      setStageAndMaybeLog("更新词库完成", "DICT", "SUCCESS", true)
    } catch (e: any) {
      setStageAndMaybeLog(`更新词库失败：${String(e?.message ?? e)}`, "DICT", "ERROR", true)
    } finally {
      setBusy(false)
      setShowProgress(false)
      setProgressValue(undefined)
    }
  }

  async function onUpdateModel() {
    if (!(await guardPathAccess(true))) return
    setBusy(true)
    setShowProgress(false) // ✅ 真正有下载进度后再显示
    setStageAndMaybeLog("更新模型中…", "MODEL", "INFO", true)
    setProgressPct("0.00%")
    setProgressValue(undefined)
    try {
      const current = loadConfig()
      await updateModel(current, {
        autoDeploy: false,
        onStage: wrapStageReporter("MODEL"),
        onLog: wrapDetailLogger("MODEL"),
        onProgress: (p) => applyProgress("model", p),
      })
      await refreshLocal(current)
      setStageAndMaybeLog("更新模型完成", "MODEL", "SUCCESS", true)
    } catch (e: any) {
      setStageAndMaybeLog(`更新模型失败：${String(e?.message ?? e)}`, "MODEL", "ERROR", true)
    } finally {
      setBusy(false)
      setShowProgress(false)
      setProgressValue(undefined)
    }
  }

  async function onDeploy() {
    if (!(await guardPathAccess(true))) return
    setBusy(true)
    setShowProgress(false) // ✅ 部署不显示下载进度
    setStageAndMaybeLog("部署中…", "DEPLOY", "INFO", true)
    setProgressPct("0.00%")
    setProgressValue(undefined)
    try {
      const current = loadConfig()
      await deployInputMethod(current, wrapStageReporter("DEPLOY"))
    } catch (e: any) {
      setStageAndMaybeLog(`部署失败：${String(e?.message ?? e)}`, "DEPLOY", "ERROR", true)
    } finally {
      setBusy(false)
    }
  }

  function logLevelColor(level: LogLevel) {
    if (level === "SUCCESS") return "systemGreen"
    if (level === "WARN") return "systemOrange"
    if (level === "ERROR") return "systemRed"
    return "systemBlue"
  }

  function logScopeColor(scope: LogScope) {
    if (scope === "CHECK") return "systemBlue"
    if (scope === "AUTO") return "systemPurple"
    if (scope === "SCHEME") return "systemGreen"
    if (scope === "DICT") return "systemOrange"
    if (scope === "MODEL") return "systemPink"
    if (scope === "DEPLOY") return "systemPink"
    if (scope === "PATH") return "systemOrange"
    return "secondaryLabel"
  }

  function renderLogEntry(entry: LogEntry) {
    return (
      <VStack
        key={entry.id}
        spacing={2}
        padding={{ top: 1, bottom: 2 }}
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
      >
        <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text font="caption2" foregroundStyle="secondaryLabel" frame={{ alignment: "leading" as any }}>
            {entry.at}
          </Text>
          <Text font="caption2" foregroundStyle={logLevelColor(entry.level)} frame={{ alignment: "leading" as any }}>
            [{entry.level}]
          </Text>
          <Text font="caption2" foregroundStyle={logScopeColor(entry.scope)} frame={{ alignment: "leading" as any }}>
            [{entry.scope}]
          </Text>
          <Spacer />
        </HStack>
        <Text
          font="caption"
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          multilineTextAlignment="leading"
        >
          {entry.message}
        </Text>
      </VStack>
    )
  }

  function renderSection(key: HomeSectionKey) {
    if (key === "local") {
      return (
        <Section key={key} header={<Text>本地信息</Text>}>
          <RowKV k="当前选择的方案" v={localSelectedScheme} />
          <RowKV k="本地方案版本" v={localSchemeVersion} />
          <RowKV k="本地词库" v={localDictMark} />
          <RowKV k="本地模型" v={localModelMark} />
        </Section>
      )
    }
    if (key === "remote") {
      return (
        <Section key={key} header={<Text>远程信息</Text>}>
          <RowKV k="远程方案版本" v={remoteSchemeVer} />
          <RowKV k="远程词库" v={remoteDictMark} />
          <RowKV k="远程模型" v={remoteModelMark} />
        </Section>
      )
    }
    if (key === "notes") {
      return (
        <Section key={key} header={<Text>更新说明</Text>}>
          <ScrollView frame={{ height: 220 }} padding>
            <Markdown content={notes} />
          </ScrollView>
        </Section>
      )
    }
    if (key === "actions") {
      return (
        <Section key={key} header={<Text>操作</Text>}>
          <VStack spacing={0}>
            <HStack spacing={0} alignment="center" frame={{ minHeight: 64 }}>
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton title="更新方案" onPress={onUpdateScheme} disabled={busy || !pathUsable} />
              </VStack>
              <Divider frame={{ height: 48 }} />
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton title="部署输入法" onPress={onDeploy} disabled={busy || !pathUsable} />
              </VStack>
            </HStack>
            <Divider />
            <HStack spacing={0} alignment="center" frame={{ minHeight: 64 }}>
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton title="更新词库" onPress={onUpdateDict} disabled={busy || !pathUsable} />
              </VStack>
              <Divider frame={{ height: 48 }} />
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton title="检查更新" onPress={onCheckUpdate} disabled={busy || !pathUsable} />
              </VStack>
            </HStack>
            <Divider />
            <HStack spacing={0} alignment="center" frame={{ minHeight: 64 }}>
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton title="更新模型" onPress={onUpdateModel} disabled={busy || !pathUsable} />
              </VStack>
              <Divider frame={{ height: 48 }} />
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton title="自动更新" onPress={onAutoUpdate} disabled={busy || !pathUsable} />
              </VStack>
            </HStack>
          </VStack>
        </Section>
      )
    }
    return (
      <Section key={key} header={<Text>状态</Text>}>
        <Text>{stage}</Text>

        {busy && showProgress ? (
          <HStack alignment="center" spacing={8}>
            {typeof progressValue === "number" ? (
              <ProgressView value={progressValue} total={1} progressViewStyle="linear" frame={{ maxWidth: "infinity" }} />
            ) : (
              <ProgressView progressViewStyle="linear" frame={{ maxWidth: "infinity" }} />
            )}
            <Text>{progressPct}</Text>
          </HStack>
        ) : null}

        {cfg.showVerboseLog ? (
          <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={0}>
            <ScrollViewReader>
              {(proxy: any) => {
                logProxyRef.current = proxy
                return (
                  <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={0}>
                    <ScrollView frame={{ height: 108, maxWidth: "infinity" as any }} padding={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                      <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
                        {logs.length ? logs.map(renderLogEntry) : (
                          <Text
                            font="caption"
                            foregroundStyle="secondaryLabel"
                            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                            multilineTextAlignment="leading"
                          >
                            暂无详细日志
                          </Text>
                        )}
                        <Text key="log-bottom" opacity={0} font="caption2" frame={{ maxWidth: "infinity", alignment: "leading" as any, height: 1 }}>
                          .
                        </Text>
                      </VStack>
                    </ScrollView>
                  </VStack>
                )
              }}
            </ScrollViewReader>
          </VStack>
        ) : null}
      </Section>
    )
  }

  return (
    <NavigationStack>
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        alert={{
          title: alert.title,
          isPresented: alert.isPresented,
          onChanged: (v) => setAlert((a) => ({ ...a, isPresented: v })),
          message: alert.message,
          actions: alert.actions,
        }}
      >
        <List
          navigationTitle={"方案更新"}
          navigationBarTitleDisplayMode={"inline"}
          listStyle={"insetGroup"}
          toolbar={{
            topBarLeading: (
              <Button
                title=""
                systemImage="xmark.circle.fill"
                buttonStyle="plain"
                foregroundStyle="systemRed"
                action={closeScript}
              />
            ),
            topBarTrailing: (
              <HStack spacing={8}>
                <Button
                  title=""
                  systemImage="square.and.pencil"
                  action={() => {
                    try {
                      ; (globalThis as any).HapticFeedback?.mediumImpact?.()
                    } catch { }
                    void openTextEditor()
                  }}
                />
                <Button
                  title=""
                  systemImage="gearshape"
                  action={() => {
                    try {
                      ; (globalThis as any).HapticFeedback?.mediumImpact?.()
                    } catch { }
                    void openSettings()
                  }}
                />
              </HStack>
            ),
          }}
        >
          {cfg.homeSectionOrder.map(renderSection)}
        </List>
      </VStack>
    </NavigationStack>
  )
}
