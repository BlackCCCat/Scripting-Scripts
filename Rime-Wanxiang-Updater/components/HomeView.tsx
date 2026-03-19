// File: components/HomeView.tsx
import {
  Button,
  Image,
  List,
  Navigation,
  NavigationStack,
  Script,
  Rectangle,
  RoundedRectangle,
  Section,
  Divider,
  Spacer,
  Text,
  HStack,
  VStack,
  ZStack,
  ScrollView,
  ScrollViewReader,
  ProgressView,
  useColorScheme,
  useEffect,
  useRef,
  useState,
  Markdown,
  Path,
} from "scripting"

import {
  loadConfig,
  type AppConfig,
  type HomeSectionKey,
  type ProSchemeKey,
  PRO_KEYS,
} from "../utils/config"
import { SettingsView } from "./SettingsView"
import { loadMetaAsync, type MetaBundle } from "../utils/meta"
import { detectRimeDir, verifyInstallPathAccess, collectRimeCandidates } from "../utils/hamster"
import { getCheckCacheKey, loadSharedCheckCache, saveSharedCheckCache } from "../utils/check_cache"
import {
  checkAllUpdates,
  updateScheme,
  updateDict,
  updateModel,
  autoUpdateAll,
  deployInputMethod,
  type AllUpdateResult,
} from "../utils/update_tasks"

const FULLSCREEN_SYMBOL = "arrow.up.left.and.down.right.and.arrow.up.right.and.down.left"

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

function GridButton(props: {
  title: string
  icon: string
  disabled?: boolean
  color?: string
  onPress: () => void
}) {
  const colorScheme = useColorScheme()
  const haptic = () => {
    try {
      ; (globalThis as any).HapticFeedback?.mediumImpact?.()
    } catch { }
  }
  const tintColor: any = props.disabled ? "secondaryLabel" : (props.color ?? "systemBlue")
  const darkCardFill: any = props.disabled ? "rgba(58,58,60,0.72)" : "rgba(58,58,60,0.96)"
  return (
    <Button
      action={() => {
        haptic()
        props.onPress()
      }}
      disabled={props.disabled}
      buttonStyle="plain"
      tint={tintColor}
      frame={{ maxWidth: "infinity", minHeight: 62 }}
    >
      {colorScheme === "dark" ? (
        <ZStack
          frame={{ maxWidth: "infinity", minHeight: 62, maxHeight: "infinity" }}
          background={"rgba(0,0,0,0.001)"}
        >
          <RoundedRectangle
            cornerRadius={16}
            fill={darkCardFill}
            stroke={"separator"}
            frame={{ maxWidth: "infinity", minHeight: 62, maxHeight: "infinity" }}
          />
          <VStack
            spacing={3}
            frame={{ maxWidth: "infinity", minHeight: 62, maxHeight: "infinity" }}
            padding={{ top: 6, bottom: 6, leading: 6, trailing: 6 }}
          >
            <Spacer />
            <Image
              systemName={props.icon}
              font="title2"
              frame={{ height: 22 }}
              foregroundStyle={tintColor}
            />
            <Text
              font="footnote"
              frame={{ maxWidth: "infinity", minHeight: 16, alignment: "center" as any }}
              lineLimit={1}
              multilineTextAlignment="center"
              foregroundStyle={tintColor}
            >
              {props.title}
            </Text>
            <Spacer />
          </VStack>
        </ZStack>
      ) : (
        <VStack
          spacing={0}
          frame={{ maxWidth: "infinity", minHeight: 62, maxHeight: "infinity" }}
          background={{ style: "secondarySystemBackground", shape: { type: "rect", cornerRadius: 16 } }}
        >
          <VStack
            spacing={3}
            frame={{ maxWidth: "infinity", minHeight: 62, maxHeight: "infinity" }}
            padding={{ top: 6, bottom: 6, leading: 6, trailing: 6 }}
            background={"rgba(0,0,0,0.001)"}
          >
            <Spacer />
            <Image
              systemName={props.icon}
              font="title2"
              frame={{ height: 22 }}
              foregroundStyle={tintColor}
            />
            <Text
              font="footnote"
              frame={{ maxWidth: "infinity", minHeight: 16, alignment: "center" as any }}
              lineLimit={1}
              multilineTextAlignment="center"
              foregroundStyle={tintColor}
            >
              {props.title}
            </Text>
            <Spacer />
          </VStack>
        </VStack>
      )}
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
type LogScope = "SYSTEM" | "CHECK" | "SCHEME" | "DICT" | "MODEL" | "PREDICT" | "AUTO" | "DEPLOY" | "PATH"

type LogEntry = {
  id: string
  at: string
  level: LogLevel
  scope: LogScope
  message: string
}

type UpdateDecision = {
  scheme: boolean
  dict: boolean
  model: boolean
  predict: boolean
}

type HomeSessionState = {
  remoteSchemeVer: string
  remoteDictMark: string
  remoteModelMark: string
  remotePredictMark: string
  notes: string
  lastCheck: AllUpdateResult | null
  lastCheckDecision: UpdateDecision | null
  lastCheckKey: string
  logs: LogEntry[]
}

const DEFAULT_HOME_SESSION_STATE: HomeSessionState = {
  remoteSchemeVer: "请检查更新",
  remoteDictMark: "请检查更新",
  remoteModelMark: "请检查更新",
  remotePredictMark: "请检查更新",
  notes: "请检查更新",
  lastCheck: null,
  lastCheckDecision: null,
  lastCheckKey: "",
  logs: [],
}

let homeSessionState: HomeSessionState = { ...DEFAULT_HOME_SESSION_STATE }
let launchAutoCheckHandled = false
let lastHandledLaunchActionKey = ""

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

function formatLogEntry(entry: LogEntry): string {
  return `${entry.at} [${entry.level}] [${entry.scope}] ${entry.message}`
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

function normalizeMark(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase()
}

function buildUpdateDecision(localMeta: MetaBundle | undefined, remote: AllUpdateResult): UpdateDecision {
  const schemeRemoteMark = normalizeMark(remote.scheme?.tag ?? remote.scheme?.name)
  const dictRemoteMark = normalizeMark(remote.dict?.remoteIdOrSha)
  const modelRemoteMark = normalizeMark(remote.model?.remoteIdOrSha)
  const predictRemoteMark = normalizeMark(remote.predict?.remoteIdOrSha)
  return {
    scheme: !!(schemeRemoteMark && normalizeMark(localMeta?.scheme?.remoteTagOrName) !== schemeRemoteMark),
    dict: !!(dictRemoteMark && normalizeMark(localMeta?.dict?.remoteIdOrSha) !== dictRemoteMark),
    model: !!(modelRemoteMark && normalizeMark(localMeta?.model?.remoteIdOrSha) !== modelRemoteMark),
    predict: !!(predictRemoteMark && normalizeMark(localMeta?.predict?.remoteIdOrSha) !== predictRemoteMark),
  }
}

function decorateLogMessage(message: string): string {
  const text = String(message ?? "").trim()
  if (!text) return text
  if (/^(🟢|🌐|⬇️|🗑️|📝|⏭️|🚀|⏱️|❌|✅|🔎|ℹ️)\s/u.test(text)) return text
  if (text.includes("可更新") || text.includes("有可用更新")) return `🟢 ${text}`
  if (text.includes("远程")) return `🌐 ${text}`
  if (text.includes("下载地址") || text.includes("下载中") || text.includes("资产")) return `⬇️ ${text}`
  if (text.includes("删除") || text.includes("清理")) return `🗑️ ${text}`
  if (text.includes("写入") || text.includes("整理")) return `📝 ${text}`
  if (text.includes("跳过排除文件")) return `⏭️ ${text}`
  if (text.includes("部署")) return `🚀 ${text}`
  if (text.includes("超时")) return `⏱️ ${text}`
  if (text.includes("失败") || text.includes("错误")) return `❌ ${text}`
  if (text.includes("完成")) return `✅ ${text}`
  if (text.includes("检查")) return `🔎 ${text}`
  return `ℹ️ ${text}`
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
  if (scope === "PREDICT") return "systemTeal"
  if (scope === "DEPLOY") return "systemPink"
  if (scope === "PATH") return "systemOrange"
  return "secondaryLabel"
}

function LogEntryRow(props: { entry: LogEntry; insetLeft?: number }) {
  const insetLeft = Math.max(0, Number(props.insetLeft ?? 0))
  const highlightUpdate = props.entry.message.endsWith("可更新")
  const updatePrefix = highlightUpdate ? props.entry.message.slice(0, -3).trimEnd() : props.entry.message
  return (
    <HStack key={props.entry.id} spacing={0} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
      {insetLeft > 0 ? (
        <Rectangle foregroundStyle="clear" frame={{ width: insetLeft, height: 1 }} />
      ) : null}
      <VStack
        spacing={2}
        padding={{ top: 1, bottom: 2 }}
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
      >
        <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ alignment: "leading" as any }}>
            {props.entry.at}
          </Text>
          <Text font="footnote" foregroundStyle={logLevelColor(props.entry.level)} frame={{ alignment: "leading" as any }}>
            [{props.entry.level}]
          </Text>
          <Text font="footnote" foregroundStyle={logScopeColor(props.entry.scope)} frame={{ alignment: "leading" as any }}>
            [{props.entry.scope}]
          </Text>
          <Spacer />
        </HStack>
        {highlightUpdate ? (
          <HStack spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Text
              font="body"
              frame={{ alignment: "leading" as any }}
              multilineTextAlignment="leading"
              selectionDisabled={false}
            >
              {updatePrefix}
            </Text>
            <Text
              font="body"
              foregroundStyle="systemGreen"
              frame={{ alignment: "leading" as any }}
            >
              可更新
            </Text>
            <Spacer />
          </HStack>
        ) : (
          <Text
            font="body"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
            selectionDisabled={false}
          >
            {props.entry.message}
          </Text>
        )}
      </VStack>
    </HStack>
  )
}

function FullscreenLogView(props: { logs: LogEntry[] }) {
  const dismiss = Navigation.useDismiss()
  const [visibleLogs, setVisibleLogs] = useState<LogEntry[] | null>(null)
  const copyAllLogs = () => {
    try {
      ;(globalThis as any).Clipboard?.copyText?.(props.logs.map(formatLogEntry).join("\n"))
      ;(globalThis as any).HapticFeedback?.mediumImpact?.()
    } catch { }
  }

  useEffect(() => {
    setVisibleLogs(null)
    const timer = setTimeout(() => {
      setVisibleLogs(props.logs)
    }, 80)
    return () => clearTimeout(timer)
  }, [props.logs])

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"详细日志"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarLeading: (
            <Button
              title=""
              systemImage="xmark"
              action={() => {
                try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
                dismiss()
              }}
            />
          ),
          topBarTrailing: (
            <Button
              title=""
              systemImage="doc.on.doc"
              action={copyAllLogs}
            />
          ),
        }}
      >
        <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ top: 8, bottom: 8, leading: 18, trailing: 14 }}>
          <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
            {visibleLogs == null ? (
              <VStack
                spacing={10}
                frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
                padding={{ top: 20, bottom: 20 }}
              >
                <ProgressView />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                  加载日志中...
                </Text>
              </VStack>
            ) : visibleLogs.length ? visibleLogs.map((entry) => <LogEntryRow key={entry.id} entry={entry} insetLeft={18} />) : (
              <HStack spacing={0} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
                <Rectangle foregroundStyle="clear" frame={{ width: 18, height: 1 }} />
                <Text
                  font="footnote"
                  foregroundStyle="secondaryLabel"
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  multilineTextAlignment="leading"
                  selectionDisabled={false}
                >
                  暂无详细日志
                </Text>
              </HStack>
            )}
          </VStack>
        </ScrollView>
      </VStack>
    </NavigationStack>
  )
}

function FullscreenNotesView(props: { content: string }) {
  const dismiss = Navigation.useDismiss()
  const [visibleContent, setVisibleContent] = useState<string | null>(null)

  useEffect(() => {
    setVisibleContent(null)
    const timer = setTimeout(() => {
      setVisibleContent(props.content)
    }, 80)
    return () => clearTimeout(timer)
  }, [props.content])

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"更新说明"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarLeading: (
            <Button
              title=""
              systemImage="xmark"
              action={() => {
                try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
                dismiss()
              }}
            />
          ),
        }}
      >
        <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding>
          {visibleContent == null ? (
            <VStack
              spacing={10}
              frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
              padding={{ top: 20, bottom: 20 }}
            >
              <ProgressView />
              <Text font="footnote" foregroundStyle="secondaryLabel">
                加载更新说明中...
              </Text>
            </VStack>
          ) : (
            <Markdown content={visibleContent} />
          )}
        </ScrollView>
      </VStack>
    </NavigationStack>
  )
}

function progressStageLabel(stage: string): string {
  const text = String(stage ?? "")
  if (text.includes("预测库：")) return text.replace(/^预测库：/, "").trim() || "处理中"
  if (text.includes("下载中")) return "下载中"
  if (text.includes("清理旧文件")) return "删除中"
  if (text.includes("解压") || text.includes("整理") || text.includes("写入") || text.includes("校验")) return "写入中"
  return "处理中"
}

export function HomeView() {
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())
  const logProxyRef = useRef<any>()

  // 本地信息
  const [localSelectedScheme, setLocalSelectedScheme] = useState("暂无法获取")
  const [localSchemeVersion, setLocalSchemeVersion] = useState("暂无法获取")
  const [localDictMark, setLocalDictMark] = useState("暂无法获取")
  const [localModelMark, setLocalModelMark] = useState("暂无法获取")
  const [localPredictMark, setLocalPredictMark] = useState("暂无法获取")

  // 远程信息
  const [remoteSchemeVer, setRemoteSchemeVer] = useState(() => homeSessionState.remoteSchemeVer)
  const [remoteDictMark, setRemoteDictMark] = useState(() => homeSessionState.remoteDictMark)
  const [remoteModelMark, setRemoteModelMark] = useState(() => homeSessionState.remoteModelMark)
  const [remotePredictMark, setRemotePredictMark] = useState(() => homeSessionState.remotePredictMark)
  const [notes, setNotes] = useState(() => homeSessionState.notes)
  const [lastCheck, setLastCheck] = useState<AllUpdateResult | null>(() => homeSessionState.lastCheck)
  const [lastCheckDecision, setLastCheckDecision] = useState<UpdateDecision | null>(() => homeSessionState.lastCheckDecision)
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
    setRemotePredictMark(DEFAULT_HOME_SESSION_STATE.remotePredictMark)
    setNotes(DEFAULT_HOME_SESSION_STATE.notes)
    setLastCheck(DEFAULT_HOME_SESSION_STATE.lastCheck)
    setLastCheckDecision(DEFAULT_HOME_SESSION_STATE.lastCheckDecision)
    setLastCheckKey(DEFAULT_HOME_SESSION_STATE.lastCheckKey)
  }

  function checkKey(c: AppConfig) {
    return getCheckCacheKey(c)
  }

  function closeAlert() {
    setAlert((a) => ({ ...a, isPresented: false }))
  }

  function pushLog(level: LogLevel, scope: LogScope, message: string, targetCfg?: AppConfig) {
    const currentCfg = targetCfg ?? cfg
    if (!currentCfg.showVerboseLog) return
    let normalizedMessage = String(message ?? "").trim()
    normalizedMessage = replacePathPrefix(normalizedMessage, currentCfg.hamsterRootPath)
    normalizedMessage = decorateLogMessage(normalizedMessage)
    const entry = makeLogEntry(level, scope, normalizedMessage)
    setLogs((prev) => {
      const next = prev.concat(entry)
      const trimmed = next.length > 200 ? next.slice(next.length - 200) : next
      homeSessionState = {
        ...homeSessionState,
        logs: trimmed,
      }
      return trimmed
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

  function pushCheckResultLog(label: string, remoteMark: string, needUpdate: boolean) {
    pushLog(needUpdate ? "SUCCESS" : "INFO", "CHECK", `远程${label}：${remoteMark}${needUpdate ? "  可更新" : ""}`)
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

  async function findLocalMeta(current: AppConfig): Promise<{ meta?: MetaBundle; candidates: string[] }> {
    const normPath = (s: string) => String(s ?? "").trim().replace(/\/+$/, "")
    const pushCandidate = (arr: string[], p?: string) => {
      const x = normPath(String(p ?? ""))
      if (x) arr.push(x)
    }

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
    for (const root of uniq) {
      const m = await loadMetaAsync(root, current.hamsterBookmarkName)
      if (m.scheme || m.dict || m.model || m.predict) {
        return { meta: m, candidates: uniq }
      }
    }
    if (current.hamsterBookmarkName) {
      try {
        const byBookmark = await loadMetaAsync("", current.hamsterBookmarkName)
        if (byBookmark.scheme || byBookmark.dict || byBookmark.model || byBookmark.predict) {
          return { meta: byBookmark, candidates: uniq }
        }
      } catch { }
    }
    return { meta: undefined, candidates: uniq }
  }

  async function refreshLocal(current: AppConfig): Promise<boolean> {
    const selected = selectedSchemeFromConfig(current)
    setLocalSelectedScheme(selected)

    const { meta, candidates } = await findLocalMeta(current)
    if (!candidates.length || !meta) {
      setLocalSchemeVersion("暂无法获取")
      setLocalDictMark("暂无法获取")
      setLocalModelMark("暂无法获取")
      setLocalPredictMark("暂无法获取")
      return false
    }

    const localScheme = normalizeMetaScheme(meta.scheme, current)
    setLocalSelectedScheme(localScheme.selected)

    setLocalSchemeVersion(meta.scheme?.remoteTagOrName ?? "暂无法获取")
    setLocalDictMark(meta.dict?.remoteIdOrSha ?? "暂无法获取")
    setLocalModelMark(meta.model?.remoteIdOrSha ?? "暂无法获取")
    setLocalPredictMark(meta.predict?.remoteIdOrSha ?? "暂无法获取")
    return true
  }

  async function refreshLastCheckDecision(current: AppConfig, remoteOverride?: AllUpdateResult | null) {
    const remote = remoteOverride ?? ((lastCheckKey === checkKey(current)) ? lastCheck : null)
    if (!remote) return
    const { meta } = await findLocalMeta(current)
    const nextDecision = buildUpdateDecision(meta, remote)
    setLastCheck(remote)
    setLastCheckDecision(nextDecision)
    setLastCheckKey(checkKey(current))
    saveSharedCheckCache(current, remote, nextDecision)
  }

  function applySharedCheckCache(current: AppConfig) {
    const cache = loadSharedCheckCache()
    if (!cache || cache.key !== checkKey(current)) return false
    setRemoteSchemeVer(cache.remote.scheme?.tag ?? cache.remote.scheme?.name ?? "暂无法获取")
    setRemoteDictMark(cache.remote.dict?.remoteIdOrSha ?? "暂无法获取")
    setRemoteModelMark(cache.remote.model?.remoteIdOrSha ?? "暂无法获取")
    setRemotePredictMark(cache.remote.predict?.remoteIdOrSha ?? "暂无法获取")
    setNotes(cache.remote.scheme?.body ?? "")
    setLastCheck(cache.remote)
    setLastCheckDecision(cache.decision)
    setLastCheckKey(cache.key)
    return true
  }

  useEffect(() => {
    homeSessionState = {
      remoteSchemeVer,
      remoteDictMark,
      remoteModelMark,
      remotePredictMark,
      notes,
      lastCheck,
      lastCheckDecision,
      lastCheckKey,
      logs,
    }
  }, [remoteSchemeVer, remoteDictMark, remoteModelMark, remotePredictMark, notes, lastCheck, lastCheckDecision, lastCheckKey, logs])

  useEffect(() => {
    if (!cfg.showVerboseLog) return
    const scrollLatest = () => {
      try {
        logProxyRef.current?.scrollTo?.("bottomView", "bottom")
      } catch { }
    }
    scrollLatest()
    const intervalId = busy ? (globalThis as any).setInterval?.(scrollLatest, 100) : undefined
    const finalTimer = setTimeout(scrollLatest, 120)
    return () => {
      if (intervalId !== undefined) (globalThis as any).clearInterval?.(intervalId)
      clearTimeout(finalTimer)
    }
  }, [cfg.showVerboseLog, busy, logs.length])

  useEffect(() => {
    const current = loadConfig()
    setCfg(current)
    void (async () => {
      await guardPathAccess(true)
      await refreshLocal(current)
      applySharedCheckCache(current)
    })()
  }, [cfg.schemeEdition, cfg.proSchemeKey, cfg.releaseSource, cfg.usePredictDb, cfg.hamsterRootPath, cfg.hamsterBookmarkName])

  useEffect(() => {
    const current = loadConfig()
    if (String(Script.queryParameters?.action ?? "") === "autoUpdate") return
    if (current.autoCheckOnLaunch && !launchAutoCheckHandled) {
      launchAutoCheckHandled = true
      void (async () => {
        if (await guardPathAccess(false)) {
          await onCheckUpdate()
        }
      })()
    }
  }, [])

  useEffect(() => {
    const action = String(Script.queryParameters?.action ?? "")
    const requestId = String(Script.queryParameters?.requestId ?? "")
    const actionKey = `${action}:${requestId}`
    if (action !== "autoUpdate" || !requestId || lastHandledLaunchActionKey === actionKey) return
    lastHandledLaunchActionKey = actionKey
    launchAutoCheckHandled = true
    void (async () => {
      if (await guardPathAccess(true)) {
        await onAutoUpdate()
      }
    })()
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

  async function openFullscreenLogs() {
    await Navigation.present({
      element: <FullscreenLogView logs={logs} />,
    })
  }

  async function openFullscreenNotes() {
    await Navigation.present({
      element: <FullscreenNotesView content={notes} />,
    })
  }

  function applyProgress(p: any) {
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
    setRemotePredictMark("检查更新中...")
    setNotes("检查更新中...")
    try {
      const current = loadConfig()
      const { meta: localMeta } = await findLocalMeta(current)
      await refreshLocal(current)
      const effective = loadConfig()

      const r = await checkAllUpdates(effective)
      const decision = buildUpdateDecision(localMeta, r)
      setRemoteSchemeVer(r.scheme?.tag ?? r.scheme?.name ?? "暂无法获取")
      setRemoteDictMark(r.dict?.remoteIdOrSha ?? "暂无法获取")
      setRemoteModelMark(r.model?.remoteIdOrSha ?? "暂无法获取")
      setRemotePredictMark(r.predict?.remoteIdOrSha ?? "暂无法获取")
      setNotes(r.scheme?.body ?? "")
      setLastCheck(r)
      setLastCheckDecision(decision)
      setLastCheckKey(checkKey(effective))
      saveSharedCheckCache(effective, r, decision)

      pushCheckResultLog("方案", r.scheme?.tag ?? r.scheme?.name ?? "暂无法获取", decision.scheme)
      pushCheckResultLog("词库", r.dict?.remoteIdOrSha ?? "暂无法获取", decision.dict)
      pushCheckResultLog("模型", r.model?.remoteIdOrSha ?? "暂无法获取", decision.model)
      if (effective.usePredictDb) {
        pushCheckResultLog("预测库", r.predict?.remoteIdOrSha ?? "暂无法获取", decision.predict)
      }
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
      const { meta: localMeta } = await findLocalMeta(current)
      await refreshLocal(current)
      const effective = loadConfig()

      const key = checkKey(effective)
      let pre = lastCheck
      let decision = lastCheckDecision
      let resolvedKey = lastCheckKey
      const shared = loadSharedCheckCache()
      if ((!pre || lastCheckKey !== key) && shared && shared.key === key) {
        pre = shared.remote
        decision = shared.decision
        resolvedKey = key
        setRemoteSchemeVer(shared.remote.scheme?.tag ?? shared.remote.scheme?.name ?? "暂无法获取")
        setRemoteDictMark(shared.remote.dict?.remoteIdOrSha ?? "暂无法获取")
        setRemoteModelMark(shared.remote.model?.remoteIdOrSha ?? "暂无法获取")
        setRemotePredictMark(shared.remote.predict?.remoteIdOrSha ?? "暂无法获取")
        setNotes(shared.remote.scheme?.body ?? "")
        setLastCheck(shared.remote)
        setLastCheckDecision(shared.decision)
        setLastCheckKey(key)
      }
      if (!pre || resolvedKey !== key) {
        // 检查阶段也不显示进度（避免误导）
        setShowProgress(false)
        setStageAndMaybeLog("自动更新：检查更新中…", "AUTO", "INFO", true)
        setRemoteSchemeVer("检查更新中...")
        setRemoteDictMark("检查更新中...")
        setRemoteModelMark("检查更新中...")
        setRemotePredictMark("检查更新中...")
        setNotes("检查更新中...")
        pre = await checkAllUpdates(effective)
        setRemoteSchemeVer(pre.scheme?.tag ?? pre.scheme?.name ?? "暂无法获取")
        setRemoteDictMark(pre.dict?.remoteIdOrSha ?? "暂无法获取")
        setRemoteModelMark(pre.model?.remoteIdOrSha ?? "暂无法获取")
        setRemotePredictMark(pre.predict?.remoteIdOrSha ?? "暂无法获取")
        setNotes(pre.scheme?.body ?? "")
        setLastCheck(pre)
        decision = buildUpdateDecision(localMeta, pre)
        setLastCheckDecision(decision)
        setLastCheckKey(key)
      }
      if (pre && !decision) {
        decision = buildUpdateDecision(localMeta, pre)
        setLastCheckDecision(decision)
      }

      if (decision?.scheme) pushLog("SUCCESS", "AUTO", "方案有可用更新")
      if (decision?.dict) pushLog("SUCCESS", "AUTO", "词库有可用更新")
      if (decision?.model) pushLog("SUCCESS", "AUTO", "模型有可用更新")
      if (decision?.predict) pushLog("SUCCESS", "AUTO", "预测库有可用更新")
      if (decision && !decision.scheme && !decision.dict && !decision.model && !decision.predict) {
        setStageAndMaybeLog("自动更新完成（已是最新，无需更新）", "AUTO", "SUCCESS", true)
        return
      }

      const autoResult = await autoUpdateAll(
        effective,
        {
          onStage: wrapStageReporter("AUTO"),
          onLog: wrapDetailLogger("AUTO"),
          onProgress: (p) => applyProgress(p),
        },
        pre,
        decision ?? undefined
      )

      await refreshLocal(effective)
      await refreshLastCheckDecision(effective, autoResult.remote)
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
        onProgress: (p) => applyProgress(p),
      })
      await refreshLocal(current)
      await refreshLastCheckDecision(current)
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
        onProgress: (p) => applyProgress(p),
      })
      await refreshLocal(current)
      await refreshLastCheckDecision(current)
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
    setStageAndMaybeLog(cfg.usePredictDb ? "更新模型及预测库中…" : "更新模型中…", "MODEL", "INFO", true)
    setProgressPct("0.00%")
    setProgressValue(undefined)
    try {
      const current = loadConfig()
      await updateModel(current, {
        autoDeploy: false,
        onStage: (message) => {
          const scope: LogScope = String(message ?? "").includes("预测库：") ? "PREDICT" : "MODEL"
          setStageAndMaybeLog(message, scope, "INFO", true)
        },
        onLog: (message) => {
          const scope: LogScope = String(message ?? "").includes("预测库") ? "PREDICT" : "MODEL"
          pushLog("INFO", scope, message)
        },
        onProgress: (p) => applyProgress(p),
      })
      await refreshLocal(current)
      await refreshLastCheckDecision(current)
      setStageAndMaybeLog(current.usePredictDb ? "更新模型及预测库完成" : "更新模型完成", "MODEL", "SUCCESS", true)
    } catch (e: any) {
      setStageAndMaybeLog(`${cfg.usePredictDb ? "更新模型及预测库" : "更新模型"}失败：${String(e?.message ?? e)}`, "MODEL", "ERROR", true)
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
      await deployInputMethod(current, wrapStageReporter("DEPLOY"), wrapDetailLogger("DEPLOY"))
    } catch (e: any) {
      setStageAndMaybeLog(`部署失败：${String(e?.message ?? e)}`, "DEPLOY", "ERROR", true)
    } finally {
      setBusy(false)
    }
  }

  function renderLogEntry(entry: LogEntry) {
    return <LogEntryRow key={entry.id} entry={entry} />
  }

  function renderSection(key: HomeSectionKey) {
    if (key === "local") {
      return (
        <Section key={key} header={<Text>本地信息</Text>}>
          <RowKV k="当前选择的方案" v={localSelectedScheme} />
          <RowKV k="本地方案版本" v={localSchemeVersion} />
          <RowKV k="本地词库" v={localDictMark} />
          <RowKV k="本地模型" v={localModelMark} />
          {cfg.usePredictDb ? <RowKV k="本地预测库" v={localPredictMark} /> : null}
        </Section>
      )
    }
    if (key === "remote") {
      return (
        <Section key={key} header={<Text>远程信息</Text>}>
          <RowKV k="远程方案版本" v={remoteSchemeVer} />
          <RowKV k="远程词库" v={remoteDictMark} />
          <RowKV k="远程模型" v={remoteModelMark} />
          {cfg.usePredictDb ? <RowKV k="远程预测库" v={remotePredictMark} /> : null}
        </Section>
      )
    }
    if (key === "notes") {
      return (
        <Section
          key={key}
          header={(
            <HStack frame={{ maxWidth: "infinity", alignment: "center" as any }}>
              <Text>更新说明</Text>
              <Spacer />
              <Button
                buttonStyle="plain"
                action={() => {
                  try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
                  void openFullscreenNotes()
                }}
              >
                <Image systemName={FULLSCREEN_SYMBOL} foregroundStyle="systemBlue" />
              </Button>
            </HStack>
          )}
        >
          <ScrollView frame={{ height: 220 }} padding>
            <Markdown content={notes} />
          </ScrollView>
        </Section>
      )
    }
    if (key === "actions") {
      const autoUpdateReady =
        lastCheckKey === checkKey(cfg) &&
        !!lastCheckDecision &&
        (lastCheckDecision.scheme || lastCheckDecision.dict || lastCheckDecision.model || lastCheckDecision.predict)
      const autoUpdateColor = autoUpdateReady ? "systemGreen" : "systemBlue"
      return (
        <Section key={key} header={<Text>操作</Text>}>
          <VStack spacing={6} padding={{ top: 1, bottom: 1 }}>
            <HStack spacing={10} alignment="center">
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton icon="doc.text" title="方案" onPress={onUpdateScheme} disabled={busy || !pathUsable} />
              </VStack>
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton icon="books.vertical" title="词库" onPress={onUpdateDict} disabled={busy || !pathUsable} />
              </VStack>
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton
                  icon="shippingbox"
                  title={cfg.usePredictDb ? "模型/预测库" : "模型"}
                  onPress={onUpdateModel}
                  disabled={busy || !pathUsable}
                />
              </VStack>
            </HStack>
            <HStack spacing={10} alignment="center">
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton icon="paperplane" title="部署" onPress={onDeploy} disabled={busy || !pathUsable} />
              </VStack>
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton icon="arrow.triangle.2.circlepath" title="检查更新" onPress={onCheckUpdate} disabled={busy || !pathUsable} />
              </VStack>
              <VStack frame={{ maxWidth: "infinity" }}>
                <GridButton icon="bolt.fill" title="自动更新" color={autoUpdateColor} onPress={onAutoUpdate} disabled={busy || !pathUsable} />
              </VStack>
            </HStack>
          </VStack>
        </Section>
      )
    }
    return (
      <Section
        key={key}
        header={(
          <HStack frame={{ maxWidth: "infinity", alignment: "center" as any }}>
            <Text>状态</Text>
            <Spacer />
            {cfg.showVerboseLog ? (
              <Button
                buttonStyle="plain"
                disabled={busy}
                action={() => {
                  try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch { }
                  void openFullscreenLogs()
                }}
              >
                <Image systemName={FULLSCREEN_SYMBOL} foregroundStyle={busy ? "secondaryLabel" : "systemBlue"} />
              </Button>
            ) : null}
          </HStack>
        )}
      >
        {cfg.showVerboseLog ? (
          <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={0}>
            <ScrollViewReader>
              {(proxy: any) => {
                logProxyRef.current = proxy
                return (
                  <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={0}>
                    <ScrollView frame={{ height: 152, maxWidth: "infinity" as any }} padding={{ top: 2, bottom: 2, leading: 0, trailing: 0 }}>
                      <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
                        {logs.length ? logs.map(renderLogEntry) : (
                          <Text
                            font="footnote"
                            foregroundStyle="secondaryLabel"
                            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                            multilineTextAlignment="leading"
                          >
                            暂无详细日志
                          </Text>
                        )}
                        <Rectangle
                          key="bottomView"
                          foregroundStyle="clear"
                          frame={{ maxWidth: "infinity", alignment: "leading" as any, height: 1 }}
                        />
                      </VStack>
                    </ScrollView>
                  </VStack>
                )
              }}
            </ScrollViewReader>

            {busy && showProgress ? (
              <VStack spacing={8} padding={{ top: 8 }}>
                <Divider />
                <HStack alignment="center" spacing={8}>
                  <Text frame={{ alignment: "leading" as any }}>
                    {progressStageLabel(stage)}
                  </Text>
                  {typeof progressValue === "number" ? (
                    <ProgressView value={progressValue} total={1} progressViewStyle="linear" frame={{ maxWidth: "infinity" }} />
                  ) : (
                    <ProgressView progressViewStyle="linear" frame={{ maxWidth: "infinity" }} />
                  )}
                  <Text>{progressPct}</Text>
                </HStack>
              </VStack>
            ) : null}
          </VStack>
        ) : (
          <VStack spacing={8}>
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
          </VStack>
        )}
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
