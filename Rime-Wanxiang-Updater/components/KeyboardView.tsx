import {
  Button,
  HStack,
  Image,
  Rectangle,
  RoundedRectangle,
  ScrollView,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
  Script,
} from "scripting"

import { loadConfig, type AppConfig } from "../utils/config"
import { loadMetaAsync, type MetaBundle } from "../utils/meta"
import { checkAllUpdates, type AllUpdateResult } from "../utils/update_tasks"
import { collectRimeCandidates, detectRimeDir, verifyInstallPathAccess } from "../utils/hamster"
import { Runtime } from "../utils/runtime"
import { saveSharedCheckCache, getCheckCacheKey } from "../utils/check_cache"

type UpdateDecision = {
  scheme: boolean
  dict: boolean
  model: boolean
}

type RemoteItemKey = keyof UpdateDecision
type RemoteItemState = "unchecked" | "checking" | "update" | "latest" | "error"

function normalizeMark(value?: string) {
  return String(value ?? "").trim().toLowerCase()
}

function buildUpdateDecision(localMeta: MetaBundle | undefined, remote: AllUpdateResult): UpdateDecision {
  const schemeRemoteMark = normalizeMark(remote.scheme?.tag ?? remote.scheme?.name)
  const dictRemoteMark = normalizeMark(remote.dict?.remoteIdOrSha)
  const modelRemoteMark = normalizeMark(remote.model?.remoteIdOrSha)
  return {
    scheme: !!(schemeRemoteMark && normalizeMark(localMeta?.scheme?.remoteTagOrName) !== schemeRemoteMark),
    dict: !!(dictRemoteMark && normalizeMark(localMeta?.dict?.remoteIdOrSha) !== dictRemoteMark),
    model: !!(modelRemoteMark && normalizeMark(localMeta?.model?.remoteIdOrSha) !== modelRemoteMark),
  }
}

function formatSchemeLabel(metaScheme: MetaBundle["scheme"], fallback: AppConfig) {
  if (!metaScheme) return fallback.schemeEdition === "base" ? "base" : `pro(${fallback.proSchemeKey})`
  if (metaScheme.selectedScheme) return metaScheme.selectedScheme.replace(" ", "")
  return metaScheme.schemeEdition === "base"
    ? "base"
    : metaScheme.proSchemeKey
      ? `pro(${metaScheme.proSchemeKey})`
      : "pro"
}

function releaseSourceLabel(source: AppConfig["releaseSource"]) {
  return source === "cnb" ? "CNB" : "GitHub"
}

function inputMethodLabel(method: AppConfig["inputMethod"]) {
  return method === "hamster3" ? "元书输入法" : "仓输入法"
}

function countUpdates(decision: UpdateDecision | null) {
  if (!decision) return 0
  return [decision.scheme, decision.dict, decision.model].filter(Boolean).length
}

async function findLocalMeta(current: AppConfig): Promise<MetaBundle | undefined> {
  const candidates: string[] = []
  const push = (p?: string) => {
    const x = String(p ?? "").trim().replace(/\/+$/, "")
    if (x) candidates.push(x)
  }
  try {
    const detected = await detectRimeDir(current)
    push(detected.rimeDir)
  } catch { }
  push(current.hamsterRootPath)
  const roots = Array.from(new Set(candidates))
  for (const root of roots) {
    const extra = await collectRimeCandidates(root)
    for (const item of extra) push(item)
  }
  const uniq = Array.from(new Set(candidates))
  for (const root of uniq) {
    try {
      const meta = await loadMetaAsync(root, current.hamsterBookmarkName)
      if (meta.scheme || meta.dict || meta.model) return meta
    } catch { }
  }
  if (current.hamsterBookmarkName) {
    try {
      const meta = await loadMetaAsync("", current.hamsterBookmarkName)
      if (meta.scheme || meta.dict || meta.model) return meta
    } catch { }
  }
  return undefined
}

function rowStateInfo(state: RemoteItemState): {
  emoji: string
  text: string
  color?: any
  stroke: any
} {
  switch (state) {
    case "checking":
      return { emoji: "⏳", text: "检查中", color: "systemBlue", stroke: "systemBlue" }
    case "update":
      return { emoji: "🟢", text: "可更新", color: "systemGreen", stroke: "systemGreen" }
    case "latest":
      return { emoji: "✅", text: "最新", color: "systemGreen", stroke: "systemGreen" }
    case "error":
      return { emoji: "❌", text: "暂无法获取", color: "systemRed", stroke: "systemRed" }
    default:
      return { emoji: "⚪️", text: "未检查", color: "secondaryLabel", stroke: "separator" }
  }
}

function overallStateText(busy: boolean, status: string, decision: UpdateDecision | null, checked: boolean) {
  if (busy) return { text: "⏳ 检查中", color: "systemBlue" as any }
  if (status.includes("失败") || status.includes("不可用")) return { text: "❌ 需处理", color: "systemRed" as any }
  if (!checked || !decision) return { text: "⚪️ 未检查", color: "secondaryLabel" as any }
  return countUpdates(decision) > 0
    ? { text: "🟢 有更新", color: "systemGreen" as any }
    : { text: "✅ 已最新", color: "systemGreen" as any }
}

function CompactButton(props: {
  title: string
  icon: string
  disabled?: boolean
  color?: string
  onPress: () => void
}) {
  const tint: any = props.disabled ? "secondaryLabel" : (props.color ?? "systemBlue")
  return (
    <Button
      action={props.onPress}
      disabled={props.disabled}
      buttonStyle="bordered"
      tint={tint}
      frame={{ maxWidth: "infinity", minHeight: 42 }}
    >
      <HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
        <Image systemName={props.icon} font="subheadline" foregroundStyle={tint} />
        <Text font="caption" lineLimit={1} foregroundStyle={tint}>
          {props.title}
        </Text>
      </HStack>
    </Button>
  )
}

function StatusCard(props: {
  icon: string
  label: string
  state: RemoteItemState
}) {
  const info = rowStateInfo(props.state)
  const iconColor: any = undefined
  const cardFill: any = props.state === "update" ? "systemGreen" : "tertiarySystemGroupedBackground"
  const cardStroke: any = props.state === "update" ? info.stroke : "separator"
  return (
    <VStack frame={{ maxWidth: "infinity" }}>
      <RoundedRectangle
        cornerRadius={12}
        fill={cardFill}
        stroke={cardStroke}
        opacity={props.state === "update" ? 0.18 : 1}
        frame={{ maxWidth: "infinity", height: 62 }}
        overlay={
          <VStack
            spacing={4}
            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" as any }}
            padding={{ top: 8, bottom: 8, leading: 10, trailing: 10 }}
          >
            <HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Image systemName={props.icon} font="caption" foregroundStyle={iconColor} />
              <Text font="caption" lineLimit={1} foregroundStyle={iconColor}>
                {props.label}
              </Text>
            </HStack>
            <HStack spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Text font="caption" foregroundStyle={info.color} frame={{ width: 18, alignment: "leading" as any }}>
                {info.emoji}
              </Text>
              <Text font="caption" lineLimit={1} foregroundStyle={info.color}>
                {info.text}
              </Text>
            </HStack>
          </VStack>
        }
      />
    </VStack>
  )
}

export function KeyboardView() {
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("未检查")
  const [localScheme, setLocalScheme] = useState("暂无法获取")
  const [lastCheck, setLastCheck] = useState<AllUpdateResult | null>(null)
  const [lastDecision, setLastDecision] = useState<UpdateDecision | null>(null)
  const [lastCheckKey, setLastCheckKey] = useState("")

  async function refreshLocalInfo(current: AppConfig): Promise<MetaBundle | undefined> {
    const meta = await findLocalMeta(current)
    setLocalScheme(formatSchemeLabel(meta?.scheme, current))
    return meta
  }

  function remoteItemState(kind: RemoteItemKey): RemoteItemState {
    if (busy) return "checking"
    const checked = lastCheckKey === getCheckCacheKey(cfg) && !!lastDecision
    if (!checked) return "unchecked"
    if (lastDecision?.[kind]) return "update"
    const remote = kind === "scheme"
      ? lastCheck?.scheme?.tag ?? lastCheck?.scheme?.name
      : kind === "dict"
        ? lastCheck?.dict?.remoteIdOrSha
        : lastCheck?.model?.remoteIdOrSha
    return remote ? "latest" : "error"
  }

  async function onCheckUpdate(mode: "auto" | "manual" = "manual") {
    setBusy(true)
    setStatus(mode === "auto" ? "正在自动检查更新…" : "正在检查更新…")
    try {
      const current = loadConfig()
      setCfg(current)
      await refreshLocalInfo(current)
      const access = await verifyInstallPathAccess(current)
      if (!access.ok) {
        setLastCheck(null)
        setLastDecision(null)
        setLastCheckKey("")
        setStatus("书签路径不可用，请去 App 中处理")
        return
      }

      const localMeta = await findLocalMeta(current)
      const remote = await checkAllUpdates(current)
      const decision = buildUpdateDecision(localMeta, remote)
      setLastCheck(remote)
      setLastDecision(decision)
      setLastCheckKey(getCheckCacheKey(current))
      saveSharedCheckCache(current, remote, decision)
      const updates = countUpdates(decision)
      setStatus(updates > 0 ? `已检查到 ${updates} 项可更新` : "已是最新")
    } catch (e: any) {
      setStatus(`检查失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onOpenAppUpdate() {
    try {
      const url = Script.createRunSingleURLScheme("万象下载更新", {
        action: "autoUpdate",
        requestId: String(Date.now()),
      })
      const openURLFn = (globalThis as any).openURL
      if (typeof openURLFn === "function") {
        await openURLFn(url)
        return
      }
      if (typeof Runtime.Safari?.openURL === "function") {
        await Runtime.Safari.openURL(url)
      }
    } catch {
      try {
        CustomKeyboard.dismissToHome()
      } catch { }
      return
    }
    await onNextKeyboard()
  }

  async function onNextKeyboard() {
    try {
      await (globalThis as any).CustomKeyboard?.nextKeyboard?.()
    } catch { }
  }

  useEffect(() => {
    const current = loadConfig()
    setCfg(current)
    void onCheckUpdate("auto")
  }, [])

  const checked = lastCheckKey === getCheckCacheKey(cfg) && !!lastDecision
  const headerState = overallStateText(busy, status, lastDecision, checked)
  const updateAvailable = checked && countUpdates(lastDecision) > 0
  const canOpenAppUpdate = !busy && updateAvailable

  return (
    <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <VStack spacing={10} padding={{ top: 12, bottom: 12, leading: 12, trailing: 12 }}>
        <VStack
          spacing={8}
          padding={{ top: 10, bottom: 10, leading: 10, trailing: 10 }}
          frame={{ maxWidth: "infinity" }}
        >
          <HStack>
            <Button
              action={() => { void onNextKeyboard() }}
              buttonStyle="plain"
            >
              <Text font="subheadline" lineLimit={1}>
                {localScheme}
              </Text>
            </Button>
            <Spacer />
            <Text font="caption" foregroundStyle={headerState.color}>
              {headerState.text}
            </Text>
          </HStack>

          <Text font="caption2" lineLimit={1} foregroundStyle="secondaryLabel">
            {releaseSourceLabel(cfg.releaseSource)} · {inputMethodLabel(cfg.inputMethod)}
          </Text>

          <VStack spacing={8}>
            <HStack spacing={8}>
              <StatusCard icon="doc.text" label="方案" state={remoteItemState("scheme")} />
              <StatusCard icon="books.vertical" label="词库" state={remoteItemState("dict")} />
              <StatusCard icon="shippingbox" label="模型" state={remoteItemState("model")} />
            </HStack>
          </VStack>

          <Rectangle foregroundStyle="separator" frame={{ maxWidth: "infinity", height: 1 }} />
        </VStack>

        <HStack spacing={8}>
          <CompactButton
            icon="arrow.clockwise"
            title="重新检查"
            disabled={busy}
            onPress={() => { void onCheckUpdate("manual") }}
          />
          <CompactButton
            icon="play.circle"
            title="去 App 更新"
            color={updateAvailable ? "systemGreen" : "systemBlue"}
            disabled={!canOpenAppUpdate}
            onPress={() => { void onOpenAppUpdate() }}
          />
        </HStack>
      </VStack>
    </ScrollView>
  )
}
