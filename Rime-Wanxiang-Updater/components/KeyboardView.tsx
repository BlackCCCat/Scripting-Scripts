import {
  Button,
  HStack,
  Image,
  ProgressView,
  Rectangle,
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
import {
  autoUpdateAll,
  checkAllUpdates,
  deployInputMethod,
  type AllUpdateResult,
} from "../utils/update_tasks"
import { collectRimeCandidates, detectRimeDir, verifyInstallPathAccess } from "../utils/hamster"
import { Runtime } from "../utils/runtime"

type UpdateDecision = {
  scheme: boolean
  dict: boolean
  model: boolean
  predict: boolean
}

function normalizeMark(value?: string) {
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

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function readFraction(x: any): number | undefined {
  const toNum = (v: any): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string") {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return undefined
  }
  return (
    toNum(x?.percent) ??
    toNum(x?.fractionCompleted) ??
    toNum(x?.progress?.fractionCompleted) ??
    toNum(x)
  )
}

function pctFromFraction(f?: number) {
  const v = typeof f === "number" && Number.isFinite(f) ? clamp01(f) : 0
  return `${(v * 100).toFixed(0)}%`
}

function progressStageLabel(stage: string): string {
  const text = String(stage ?? "")
  if (text.includes("下载中")) return "下载中"
  if (text.includes("清理旧文件")) return "删除中"
  if (text.includes("解压") || text.includes("整理") || text.includes("写入") || text.includes("校验")) return "写入中"
  if (text.includes("部署")) return "部署中"
  if (text.includes("检查")) return "检查中"
  return text || "处理中"
}

function statusColor(status: string): any {
  const text = String(status ?? "")
  if (text.includes("失败") || text.includes("不可用")) return "systemRed"
  if (text.includes("可更新")) return "systemGreen"
  if (text.includes("最新") || text.includes("完成")) return "systemGreen"
  if (text.includes("检查") || text.includes("更新中") || text.includes("部署中") || text.includes("下载中") || text.includes("写入中")) {
    return "systemBlue"
  }
  return undefined
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
      if (meta.scheme || meta.dict || meta.model || meta.predict) return meta
    } catch { }
  }
  if (current.hamsterBookmarkName) {
    try {
      const meta = await loadMetaAsync("", current.hamsterBookmarkName)
      if (meta.scheme || meta.dict || meta.model || meta.predict) return meta
    } catch { }
  }
  return undefined
}

function SummaryButton(props: {
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
      frame={{ maxWidth: "infinity", minHeight: 46 }}
    >
      <VStack spacing={1} frame={{ maxWidth: "infinity" }} padding={{ top: 2, bottom: 2, leading: 4, trailing: 4 }}>
        <Image systemName={props.icon} font="subheadline" foregroundStyle={tint} />
        <Text font="caption" lineLimit={1} multilineTextAlignment="center" foregroundStyle={tint}>
          {props.title}
        </Text>
      </VStack>
    </Button>
  )
}

export function KeyboardView() {
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())
  const [busy, setBusy] = useState(false)
  const [progressValue, setProgressValue] = useState<number | undefined>(undefined)
  const [progressPct, setProgressPct] = useState("0%")
  const [status, setStatus] = useState("未检查")
  const [localSummary, setLocalSummary] = useState("本地：暂无法获取")
  const [remoteSummary, setRemoteSummary] = useState("远程：未检查")
  const [lastCheck, setLastCheck] = useState<AllUpdateResult | null>(null)
  const [lastDecision, setLastDecision] = useState<UpdateDecision | null>(null)
  const [lastCheckKey, setLastCheckKey] = useState("")

  function checkKey(c: AppConfig) {
    return [c.releaseSource, c.schemeEdition, c.proSchemeKey, c.usePredictDb ? "predict" : "plain", c.hamsterRootPath, c.hamsterBookmarkName].join("|")
  }

  function applyProgress(p: any) {
    const f = readFraction(p)
    if (typeof f === "number") {
      const value = clamp01(f)
      setProgressValue(value)
      setProgressPct(pctFromFraction(value))
    }
  }

  async function refreshLocalSummary(current: AppConfig): Promise<MetaBundle | undefined> {
    const meta = await findLocalMeta(current)
    if (!meta) {
      setLocalSummary("本地：暂无法获取")
      return undefined
    }
    const parts = [
      `方案 ${formatSchemeLabel(meta.scheme, current)}`,
      `词库 ${meta.dict?.remoteIdOrSha ? "已记录" : "无"}`,
      `模型 ${meta.model?.remoteIdOrSha ? "已记录" : "无"}`,
    ]
    if (current.usePredictDb) parts.push(`预测 ${meta.predict?.remoteIdOrSha ? "已记录" : "无"}`)
    setLocalSummary(parts.join(" · "))
    return meta
  }

  function refreshRemoteSummary(remote: AllUpdateResult, decision: UpdateDecision, current: AppConfig) {
    const parts: string[] = []
    parts.push(`方案${decision.scheme ? "可更新" : "最新"}`)
    parts.push(`词库${decision.dict ? "可更新" : "最新"}`)
    parts.push(`模型${decision.model ? "可更新" : "最新"}`)
    if (current.usePredictDb) parts.push(`预测${decision.predict ? "可更新" : "最新"}`)
    setRemoteSummary(parts.join(" · "))
  }

  async function guardPathAccess() {
    const current = loadConfig()
    const result = await verifyInstallPathAccess(current)
    setCfg(current)
    if (!result.ok) {
      setStatus("路径不可用，请打开主脚本检查设置")
      return false
    }
    return true
  }

  async function recalcDecision(current: AppConfig, remote?: AllUpdateResult | null) {
    const effectiveRemote = remote ?? ((lastCheckKey === checkKey(current)) ? lastCheck : null)
    if (!effectiveRemote) return
    const localMeta = await findLocalMeta(current)
    const decision = buildUpdateDecision(localMeta, effectiveRemote)
    setLastDecision(decision)
    setLastCheck(effectiveRemote)
    setLastCheckKey(checkKey(current))
    refreshRemoteSummary(effectiveRemote, decision, current)
  }

  async function onCheckUpdate() {
    if (!(await guardPathAccess())) return
    setBusy(true)
    setProgressValue(undefined)
    setStatus("检查中...")
    try {
      const current = loadConfig()
      setCfg(current)
      const localMeta = await refreshLocalSummary(current)
      const remote = await checkAllUpdates(current)
      const decision = buildUpdateDecision(localMeta, remote)
      setLastCheck(remote)
      setLastDecision(decision)
      setLastCheckKey(checkKey(current))
      refreshRemoteSummary(remote, decision, current)
      if (decision.scheme || decision.dict || decision.model || decision.predict) {
        setStatus("检测到可更新项")
      } else {
        setStatus("已是最新")
      }
    } catch (e: any) {
      setStatus(`检查失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onAutoUpdate() {
    if (!(await guardPathAccess())) return
    setBusy(true)
    setProgressValue(undefined)
    setProgressPct("0%")
    setStatus("自动更新中...")
    try {
      const current = loadConfig()
      setCfg(current)
      const localMeta = await refreshLocalSummary(current)
      const key = checkKey(current)
      let remote = lastCheck
      let decision = lastDecision
      if (!remote || lastCheckKey !== key) {
        remote = await checkAllUpdates(current)
        decision = buildUpdateDecision(localMeta, remote)
        setLastCheck(remote)
        setLastDecision(decision)
        setLastCheckKey(key)
        refreshRemoteSummary(remote, decision, current)
      }
      if (decision && !decision.scheme && !decision.dict && !decision.model && !decision.predict) {
        setStatus("已是最新，无需更新")
        return
      }
      const result = await autoUpdateAll(current, {
        onStage: (message) => setStatus(progressStageLabel(message)),
        onProgress: (p) => applyProgress(p),
      }, remote ?? undefined, decision ?? undefined)
      await refreshLocalSummary(current)
      await recalcDecision(current, result.remote)
      setProgressValue(undefined)
      setProgressPct("0%")
      if (!result.didUpdate) setStatus("已是最新，无需更新")
      else if (result.didDeploy) setStatus("更新完成，已部署")
      else setStatus("更新完成")
    } catch (e: any) {
      setStatus(`更新失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onDeploy() {
    if (!(await guardPathAccess())) return
    setBusy(true)
    setProgressValue(undefined)
    setStatus("部署中...")
    try {
      const current = loadConfig()
      setCfg(current)
      await deployInputMethod(current, (message) => setStatus(progressStageLabel(message)))
      setStatus("部署完成")
    } catch (e: any) {
      setStatus(`部署失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onOpenMainScript() {
    try {
      const url = Script.createRunSingleURLScheme("万象下载更新")
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
    }
  }

  useEffect(() => {
    const current = loadConfig()
    setCfg(current)
    void refreshLocalSummary(current)
  }, [])

  const autoUpdateReady =
    !!lastDecision &&
    lastCheckKey === checkKey(cfg) &&
    (lastDecision.scheme || lastDecision.dict || lastDecision.model || lastDecision.predict)

  return (
    <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <VStack spacing={10} padding={{ top: 12, bottom: 12, leading: 12, trailing: 12 }}>
        <VStack
          spacing={6}
          padding={{ top: 10, bottom: 10, leading: 10, trailing: 10 }}
          frame={{ maxWidth: "infinity" }}
        >
          <HStack>
            <Text font="headline">万象更新</Text>
            <Spacer />
            <Text font="caption" foregroundStyle={autoUpdateReady ? "systemGreen" : "secondaryLabel"}>
              {autoUpdateReady ? "有可更新项" : "状态正常"}
            </Text>
          </HStack>
          <Text font="caption" lineLimit={1}>
            {localSummary}
          </Text>
          <Text font="caption" lineLimit={1} foregroundStyle="secondaryLabel">
            {remoteSummary}
          </Text>
        </VStack>

        <VStack spacing={8}>
          <HStack spacing={8}>
            <SummaryButton icon="arrow.triangle.2.circlepath" title="检查更新" disabled={busy} onPress={() => { void onCheckUpdate() }} />
            <SummaryButton icon="bolt.fill" title="自动更新" color={autoUpdateReady ? "systemGreen" : "systemBlue"} disabled={busy} onPress={() => { void onAutoUpdate() }} />
          </HStack>
          <HStack spacing={8}>
            <SummaryButton icon="paperplane" title="部署输入法" disabled={busy} onPress={() => { void onDeploy() }} />
            <SummaryButton icon="play.circle" title="在App中运行" disabled={busy} onPress={() => { void onOpenMainScript() }} />
          </HStack>
        </VStack>

        <Rectangle foregroundStyle="separator" frame={{ maxWidth: "infinity", height: 1 }} />

        <VStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            当前状态
          </Text>
          <Text
            font="footnote"
            foregroundStyle={statusColor(status)}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            lineLimit={2}
          >
            {status}
          </Text>
          <VStack spacing={4} frame={{ maxWidth: "infinity", minHeight: 30 }}>
            {busy || progressValue !== undefined ? (
              <>
                {progressValue !== undefined ? (
                  <ProgressView
                    value={progressValue}
                    total={1}
                    progressViewStyle="linear"
                    frame={{ maxWidth: "infinity" }}
                  />
                ) : (
                  <ProgressView
                    progressViewStyle="linear"
                    frame={{ maxWidth: "infinity" }}
                  />
                )}
                <HStack>
                  <Spacer />
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {progressPct}
                  </Text>
                </HStack>
              </>
            ) : (
              <Rectangle foregroundStyle="clear" frame={{ maxWidth: "infinity", height: 30 }} />
            )}
          </VStack>
        </VStack>
      </VStack>
    </ScrollView>
  )
}
