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
  Spacer,
  Picker,
  useEffect,
  useMemo,
  useState,
  Path,
} from "scripting"

import { Runtime } from "../utils/runtime"
import {
  loadConfig,
  saveConfig,
  type AppConfig,
  type ProSchemeKey,
  type InputMethod,
} from "../utils/config"
import { removeDirSafe } from "../utils/fs"
import { detectRimeDir } from "../utils/hamster"

type AlertNode = any
type AlertState = {
  title: string
  isPresented: boolean
  message: AlertNode
  actions: AlertNode
}

const PRO_KEYS: ProSchemeKey[] = ["moqi", "flypy", "zrm", "tiger", "wubi", "hanxin", "shouyou"]
const INPUT_METHODS: { label: string; value: InputMethod }[] = [
  { label: "仓输入法", value: "hamster" },
  { label: "元书输入法", value: "hamster3" },
]

function isPromiseLike(v: any): v is Promise<any> {
  return !!v && typeof v === "object" && typeof v.then === "function"
}

async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
  try {
    const r = fn.apply(thisArg, args)
    return isPromiseLike(r) ? await r : r
  } catch {
    return undefined
  }
}

function CenterRowButton(props: {
  title: string
  role?: "cancel" | "destructive"
  disabled?: boolean
  onPress: () => void
}) {
  const haptic = () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
  }
  return (
    <Button
      role={props.role}
      action={() => {
        haptic()
        props.onPress()
      }}
      disabled={props.disabled}
    >
      <HStack frame={{ width: "100%" as any }} padding={{ top: 14, bottom: 14 }}>
        {/* ✅ 同样加 leading 锚点 */}
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
    ;(async () => {
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
            try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
            closeAlert()
          }}
        />
      ),
    })
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
        const resolved = fm?.bookmarkedPath
          ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [matched.name])) ?? matched.path)
          : matched.path
        const pathChanged = resolved !== targetPath || matched.name !== targetName
        if (pathChanged) {
          setCfg((c) => ({ ...c, hamsterRootPath: resolved, hamsterBookmarkName: matched.name }))
          try {
            const next = { ...loadConfig(), hamsterRootPath: resolved, hamsterBookmarkName: matched.name }
            saveConfig(next)
            props.onDone?.(next)
          } catch {}
        }
      } else if (!targetPath) {
        setCfg((c) => ({
          ...c,
          hamsterRootPath: cleaned[0].path,
          hamsterBookmarkName: cleaned[0].name,
        }))
      }
    } else {
      setBookmarkIdx(0)
    }
    return cleaned
  }

  // ✅ 仅从书签选择
  async function pickFolder() {
    try {
      const list = await refreshBookmarks()
      if (!list.length) {
        showInfo("未找到书签", "请先在 工具-文件书签 中添加文件夹后再选择。")
      }
    } catch (e: any) {
      showInfo("选择失败", String(e?.message ?? e))
    }
  }

  async function saveAndClose() {
    const fixed: AppConfig = {
      ...cfg,
      // base 时 proKey 也可以保留，不影响；若你想 base 时清空也可以在这里处理
      proSchemeKey: PRO_KEYS[Math.max(0, Math.min(PRO_KEYS.length - 1, proKeyIdx))],
      inputMethod: INPUT_METHODS[Math.max(0, Math.min(INPUT_METHODS.length - 1, inputIdx))].value,
    }

    try {
      saveConfig(fixed)
      const schemeChanged =
        fixed.schemeEdition !== initialSchemeEdition ||
        (fixed.schemeEdition === "pro" && fixed.proSchemeKey !== initialProSchemeKey)
      const pathChanged =
        fixed.hamsterRootPath !== initialHamsterRootPath ||
        fixed.hamsterBookmarkName !== initialHamsterBookmarkName
      if (schemeChanged && !pathChanged) {
        try {
          const { rimeDir } = await detectRimeDir(fixed)
          const installRoot = rimeDir || fixed.hamsterRootPath
          if (installRoot) {
            await removeDirSafe(Path.join(installRoot, "UpdateCache"))
          }
        } catch {}
      }
      props.onDone?.(fixed)
      dismiss()
    } catch (e: any) {
      showInfo("保存失败", String(e?.message ?? e))
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
                  try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch {}
                  setBookmarkIdx(idx)
                  const b = bookmarks[idx]
                  if (b?.path) {
                    ;(async () => {
                      const fm: any = (globalThis as any).FileManager ?? Runtime.FileManager
                      const resolved = fm?.bookmarkedPath
                        ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [b.name])) ?? b.path)
                        : b.path
                      const next: AppConfig = {
                        ...cfg,
                        hamsterRootPath: resolved,
                        hamsterBookmarkName: b.name,
                      }
                      setCfg(next)
                      try {
                        saveConfig(next)
                        props.onDone?.(next)
                      } catch {}
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
                try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch {}
                setReleaseIdx(v)
              }}
            >
              {releaseLabels.map((label, index) => (
                <Text key={label} tag={index}>
                  {label}
                </Text>
              ))}
            </Picker>

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
                try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch {}
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
                  try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch {}
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
                try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch {}
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
                try { (globalThis as any).HapticFeedback?.heavyImpact?.() } catch {}
                setCfg((c) => ({ ...c, autoCheckOnLaunch: v }))
              }}
              toggleStyle="switch"
            />
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

          <Section>
            <CenterRowButton title="保存" onPress={saveAndClose} />
            <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
