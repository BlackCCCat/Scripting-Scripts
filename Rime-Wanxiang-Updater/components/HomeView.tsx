// File: components/HomeView.tsx
import {
  Button,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  HStack,
  ScrollView,
  useEffect,
  useState,
  Markdown,
  Path,
} from "scripting"

import { loadConfig, type AppConfig } from "../utils/config"
import { SettingsView } from "./SettingsView"
import { loadMetaAsync, type MetaBundle } from "../utils/meta"
import { detectRimeDir } from "../utils/hamster"
import { checkAllUpdates, updateScheme, updateDict, updateModel, autoUpdateAll, deployInputMethod, type AllUpdateResult } from "../utils/update_tasks"

function pct(p?: number) {
  if (typeof p !== "number") return ""
  const v = Math.max(0, Math.min(1, p))
  return `${Math.round(v * 100)}%`
}

function CenterRowButton(props: { title: string; disabled?: boolean; onPress: () => void }) {
  const haptic = () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
  }
  return (
    <Button
      action={() => {
        haptic()
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

function RowKV(props: { k: string; v: string }) {
  return (
    <HStack>
      <Text>{props.k}</Text>
      <Spacer />
      <Text>{props.v}</Text>
    </HStack>
  )
}

export function HomeView() {
  const [cfg, setCfg] = useState<AppConfig>(() => loadConfig())

  // 本地信息
  const [localSelectedScheme, setLocalSelectedScheme] = useState("暂无法获取")
  const [localSchemeVersion, setLocalSchemeVersion] = useState("暂无法获取")
  const [localDictMark, setLocalDictMark] = useState("暂无法获取")
  const [localModelMark, setLocalModelMark] = useState("暂无法获取")

  // 远程信息
  const [remoteSchemeVer, setRemoteSchemeVer] = useState("请检查更新")
  const [remoteDictMark, setRemoteDictMark] = useState("请检查更新")
  const [remoteModelMark, setRemoteModelMark] = useState("请检查更新")
  const [notes, setNotes] = useState("请检查更新")
  const [lastCheck, setLastCheck] = useState<AllUpdateResult | null>(null)
  const [lastCheckKey, setLastCheckKey] = useState("")

  // 状态
  const [stage, setStage] = useState("就绪")
  const [progressPct, setProgressPct] = useState("")
  const [busy, setBusy] = useState(false)

  function resetRemote() {
    setRemoteSchemeVer("请检查更新")
    setRemoteDictMark("请检查更新")
    setRemoteModelMark("请检查更新")
    setNotes("请检查更新")
    setLastCheck(null)
    setLastCheckKey("")
  }

  function checkKey(c: AppConfig) {
    return [c.releaseSource, c.schemeEdition, c.proSchemeKey, c.hamsterRootPath].join("|")
  }

  async function refreshLocal(current: AppConfig) {
    const selected = current.schemeEdition === "base" ? "base" : `pro (${current.proSchemeKey})`
    setLocalSelectedScheme(selected)

    let installRoot = current.hamsterRootPath
    try {
      const { rimeDir } = await detectRimeDir(current)
      if (rimeDir) installRoot = rimeDir
    } catch {}

    const candidates: string[] = []
    if (installRoot) candidates.push(installRoot)
    if (current.hamsterRootPath && current.hamsterRootPath !== installRoot) {
      candidates.push(current.hamsterRootPath)
    }
    if (current.hamsterRootPath) {
      candidates.push(
        Path.join(current.hamsterRootPath, "RimeUserData", "wanxiang"),
        Path.join(current.hamsterRootPath, "RIME", "Rime"),
        Path.join(current.hamsterRootPath, "Rime")
      )
    }

    try {
      const fm: any = (globalThis as any).FileManager
      if (fm?.getAllFileBookmarks && fm?.bookmarkedPath && current.hamsterRootPath) {
        const r = fm.getAllFileBookmarks()
        const list = r && typeof r.then === "function" ? await r : r
        const arr = Array.isArray(list) ? list : []
        const norm = (s: string) => s.replace(/\/+$/, "")
        const target = norm(String(current.hamsterRootPath))
        const match = arr.find((b: any) => {
          const p = norm(String(b?.path ?? ""))
          const n = String(b?.name ?? "")
          return (p && p === target) || (n && n === current.hamsterRootPath)
        })
        if (match?.name) {
          const p = fm.bookmarkedPath(match.name)
          const resolved = p && typeof p.then === "function" ? await p : p
          if (resolved) candidates.unshift(String(resolved))
        }
      }
    } catch {}

    const uniq = Array.from(new Set(candidates.filter(Boolean)))
    let meta: MetaBundle | undefined
    for (const root of uniq) {
      const m = await loadMetaAsync(root)
      if (m.scheme || m.dict || m.model) {
        meta = m
        break
      }
    }

    if (!uniq.length || !meta) {
      setLocalSchemeVersion("暂无法获取")
      setLocalDictMark("暂无法获取")
      setLocalModelMark("暂无法获取")
      return
    }

    setLocalSchemeVersion(meta.scheme?.remoteTagOrName ?? "暂无法获取")
    setLocalDictMark(meta.dict?.remoteIdOrSha ?? "暂无法获取")
    setLocalModelMark(meta.model?.remoteIdOrSha ?? "暂无法获取")
  }

  useEffect(() => {
    const current = loadConfig()
    setCfg(current)
    void refreshLocal(current)
  }, [cfg.schemeEdition, cfg.proSchemeKey, cfg.releaseSource, cfg.hamsterRootPath])

  useEffect(() => {
    const current = loadConfig()
    if (current.autoCheckOnLaunch) {
      void onCheckUpdate()
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
            void refreshLocal(newCfg)
            if (changed) resetRemote()
          }}
        />
      ),
    })
    const current = loadConfig()
    setCfg(current)
    await refreshLocal(current)
    if (checkKey(current) !== beforeKey) resetRemote()
  }

  async function onCheckUpdate() {
    setBusy(true)
    setStage("检查更新中…")
    setProgressPct("")
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
    setBusy(true)
    setStage("自动更新中…")
    setProgressPct("")
    try {
      const current = loadConfig()
      await refreshLocal(current)

      const key = checkKey(current)
      let pre = lastCheck
      if (!pre || lastCheckKey !== key) {
        // ✅ 未检查过或配置变更：先检查更新
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

      // ✅ 再执行自动更新（复用刚才的检查结果，避免重复请求）
      await autoUpdateAll(
        current,
        {
          onStage: setStage,
          onProgress: (p) => setProgressPct(pct(p.percent)),
        },
        pre
      )

      await refreshLocal(current)
      setStage(current.autoDeployAfterDownload === false ? "自动更新完成（未自动部署）" : "自动更新完成（已部署）")
    } catch (e: any) {
      setStage(`自动更新失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onUpdateScheme() {
    setBusy(true)
    setStage("更新方案中…")
    setProgressPct("")
    try {
      const current = loadConfig()
      await updateScheme(current, {
        autoDeploy: false,
        onStage: setStage,
        onProgress: (p) => setProgressPct(pct(p.percent)),
      })
      await refreshLocal(current)
      setStage("更新方案完成")
    } catch (e: any) {
      setStage(`更新方案失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onUpdateDict() {
    setBusy(true)
    setStage("更新词库中…")
    setProgressPct("")
    try {
      const current = loadConfig()
      await updateDict(current, {
        autoDeploy: false,
        onStage: setStage,
        onProgress: (p) => setProgressPct(pct(p.percent)),
      })
      await refreshLocal(current)
      setStage("更新词库完成")
    } catch (e: any) {
      setStage(`更新词库失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onUpdateModel() {
    setBusy(true)
    setStage("更新模型中…")
    setProgressPct("")
    try {
      const current = loadConfig()
      await updateModel(current, {
        autoDeploy: false,
        onStage: setStage,
        onProgress: (p) => setProgressPct(pct(p.percent)),
      })
      await refreshLocal(current)
      setStage("更新模型完成")
    } catch (e: any) {
      setStage(`更新模型失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onDeploy() {
    setBusy(true)
    setStage("部署中…")
    setProgressPct("")
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
      <List
        navigationTitle={"方案更新"}
        navigationBarTitleDisplayMode={"inline"}
        listStyle={"insetGroup"}
        toolbar={{
          topBarTrailing: (
            <Button
              title=""
              systemImage="gearshape"
              action={() => {
                try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
                void openSettings()
              }}
            />
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
          <CenterRowButton title="检查更新" onPress={onCheckUpdate} disabled={busy} />
          <CenterRowButton title="自动更新" onPress={onAutoUpdate} disabled={busy} />

          <CenterRowButton title="更新方案" onPress={onUpdateScheme} disabled={busy} />
          <CenterRowButton title="更新词库" onPress={onUpdateDict} disabled={busy} />
          <CenterRowButton title="更新模型" onPress={onUpdateModel} disabled={busy} />
          <CenterRowButton title="部署输入法" onPress={onDeploy} disabled={busy} />
        </Section>

        <Section header={<Text>状态</Text>}>
          <Text>
            {stage}
            {stage.includes("UpdateCache") && stage.includes("权限")
              ? " 请在设置中重新选择Hamster路径"
              : ""}
          </Text>
          {progressPct ? <Text>下载进度：{progressPct}</Text> : null}
        </Section>
      </List>
    </NavigationStack>
  )
}
