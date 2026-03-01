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
  ProgressView,
  useEffect,
  useState,
  Markdown,
  Path,
} from "scripting"

import { loadConfig, saveConfig, type AppConfig, type ProSchemeKey, PRO_KEYS } from "../utils/config"
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

type RemoteSessionState = {
  remoteSchemeVer: string
  remoteDictMark: string
  remoteModelMark: string
  notes: string
  lastCheck: AllUpdateResult | null
  lastCheckKey: string
}

const DEFAULT_REMOTE_SESSION_STATE: RemoteSessionState = {
  remoteSchemeVer: "请检查更新",
  remoteDictMark: "请检查更新",
  remoteModelMark: "请检查更新",
  notes: "请检查更新",
  lastCheck: null,
  lastCheckKey: "",
}

let remoteSessionState: RemoteSessionState = { ...DEFAULT_REMOTE_SESSION_STATE }
let launchAutoCheckHandled = false

export function HomeView() {
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())

  // 本地信息
  const [localSelectedScheme, setLocalSelectedScheme] = useState("暂无法获取")
  const [localSchemeVersion, setLocalSchemeVersion] = useState("暂无法获取")
  const [localDictMark, setLocalDictMark] = useState("暂无法获取")
  const [localModelMark, setLocalModelMark] = useState("暂无法获取")

  // 远程信息
  const [remoteSchemeVer, setRemoteSchemeVer] = useState(() => remoteSessionState.remoteSchemeVer)
  const [remoteDictMark, setRemoteDictMark] = useState(() => remoteSessionState.remoteDictMark)
  const [remoteModelMark, setRemoteModelMark] = useState(() => remoteSessionState.remoteModelMark)
  const [notes, setNotes] = useState(() => remoteSessionState.notes)
  const [lastCheck, setLastCheck] = useState<AllUpdateResult | null>(() => remoteSessionState.lastCheck)
  const [lastCheckKey, setLastCheckKey] = useState(() => remoteSessionState.lastCheckKey)

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
    setRemoteSchemeVer(DEFAULT_REMOTE_SESSION_STATE.remoteSchemeVer)
    setRemoteDictMark(DEFAULT_REMOTE_SESSION_STATE.remoteDictMark)
    setRemoteModelMark(DEFAULT_REMOTE_SESSION_STATE.remoteModelMark)
    setNotes(DEFAULT_REMOTE_SESSION_STATE.notes)
    setLastCheck(DEFAULT_REMOTE_SESSION_STATE.lastCheck)
    setLastCheckKey(DEFAULT_REMOTE_SESSION_STATE.lastCheckKey)
  }

  function checkKey(c: AppConfig) {
    return [c.releaseSource, c.schemeEdition, c.proSchemeKey, c.hamsterRootPath, c.hamsterBookmarkName].join("|")
  }

  function closeAlert() {
    setAlert((a) => ({ ...a, isPresented: false }))
  }

  async function guardPathAccess(showPopup: boolean): Promise<boolean> {
    const current = loadConfig()
    const r = await verifyInstallPathAccess(current)
    if (r.ok) {
      setPathUsable(true)
      return true
    }
    setPathUsable(false)
    setStage("路径不可用，请在设置中添加或重新添加书签文件夹。")
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
    remoteSessionState = {
      remoteSchemeVer,
      remoteDictMark,
      remoteModelMark,
      notes,
      lastCheck,
      lastCheckKey,
    }
  }, [remoteSchemeVer, remoteDictMark, remoteModelMark, notes, lastCheck, lastCheckKey])

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
          setStage(`保存文件失败：${String(error?.message ?? error)}`)
        }
      }

      await editor.present()
      editor.dispose()
    } catch (error: any) {
      setStage(`打开编辑器失败：${String(error?.message ?? error)}`)
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
    setStage("检查更新中…")
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

      setStage("检查完成")
    } catch (e: any) {
      setStage(`检查失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onAutoUpdate() {
    if (!(await guardPathAccess(true))) return
    setBusy(true)
    setShowProgress(false) // ✅ 真正有下载进度后再显示
    setStage("自动更新中…")
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
        setStage("自动更新：检查更新中…")
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
          onStage: setStage,
          onProgress: (p) => applyProgress("auto", p),
        },
        pre
      )

      await refreshLocal(current)
      if (!autoResult.didUpdate) {
        setStage("自动更新完成（已是最新，无需更新）")
      } else if (autoResult.didDeploy) {
        setStage("自动更新完成（已部署）")
      } else {
        setStage("自动更新完成（未自动部署）")
      }
    } catch (e: any) {
      setStage(`自动更新失败：${String(e?.message ?? e)}`)
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
    setStage("更新方案中…")
    setProgressPct("0.00%")
    setProgressValue(undefined)
    try {
      const current = loadConfig()
      await updateScheme(current, {
        autoDeploy: false,
        onStage: setStage,
        onProgress: (p) => applyProgress("scheme", p),
      })
      await refreshLocal(current)
      setStage("更新方案完成")
    } catch (e: any) {
      setStage(`更新方案失败：${String(e?.message ?? e)}`)
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
    setStage("更新词库中…")
    setProgressPct("0.00%")
    setProgressValue(undefined)
    try {
      const current = loadConfig()
      await updateDict(current, {
        autoDeploy: false,
        onStage: setStage,
        onProgress: (p) => applyProgress("dict", p),
      })
      await refreshLocal(current)
      setStage("更新词库完成")
    } catch (e: any) {
      setStage(`更新词库失败：${String(e?.message ?? e)}`)
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
    setStage("更新模型中…")
    setProgressPct("0.00%")
    setProgressValue(undefined)
    try {
      const current = loadConfig()
      await updateModel(current, {
        autoDeploy: false,
        onStage: setStage,
        onProgress: (p) => applyProgress("model", p),
      })
      await refreshLocal(current)
      setStage("更新模型完成")
    } catch (e: any) {
      setStage(`更新模型失败：${String(e?.message ?? e)}`)
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
    setStage("部署中…")
    setProgressPct("0.00%")
    setProgressValue(undefined)
    try {
      const current = loadConfig()
      await deployInputMethod(current, setStage)
    } catch (e: any) {
      setStage(`部署失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
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
          <Section header={<Text>本地信息</Text>}>
            <RowKV k="当前选择的方案" v={localSelectedScheme} />
            <RowKV k="本地方案版本" v={localSchemeVersion} />
            <RowKV k="本地词库" v={localDictMark} />
            <RowKV k="本地模型" v={localModelMark} />
          </Section>

          <Section header={<Text>远程信息</Text>}>
            <RowKV k="远程方案版本" v={remoteSchemeVer} />
            <RowKV k="远程词库" v={remoteDictMark} />
            <RowKV k="远程模型" v={remoteModelMark} />
          </Section>

          <Section header={<Text>更新说明</Text>}>
            <ScrollView frame={{ height: 220 }} padding>
              <Markdown content={notes} />
            </ScrollView>
          </Section>

          <Section header={<Text>操作</Text>}>
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

          <Section header={<Text>状态</Text>}>
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
          </Section>
        </List>
      </VStack>
    </NavigationStack>
  )
}
