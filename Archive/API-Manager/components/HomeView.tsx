import {
  Button,
  Chart,
  Circle,
  DonutChart,
  Group,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Section,
  Script,
  Spacer,
  Text,
  VStack,
  ZStack,
  type Color,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"

import type { ApiCheckResult, ApiEntry, CheckStatus, ManagerSettings } from "../types"
import { EditEntryView, type EditEntryResult } from "./EditEntryView"
import { ModelIdsView } from "./ModelIdsView"
import { SettingsView } from "./SettingsView"
import { checkApiEntry, runChecksConcurrently } from "../utils/checker"
import { formatDateTime, joinBaseUrl, makeId, maskApiKey, normalizeBaseUrl } from "../utils/common"
import { buildOverviewItems, buildOverviewSummary, chartColorScale } from "../utils/overview"
import { clearMinimizeRequested, markMinimizeRequested } from "../utils/runtime"
import { loadManagerState, makeEmptyCheckResult, saveManagerState } from "../utils/storage"

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
    void action()
  }
}

function statusColor(status: CheckStatus): Color {
  switch (status) {
    case "green":
      return "systemGreen"
    case "yellow":
      return "systemYellow"
    case "red":
      return "systemRed"
    case "checking":
      return "systemBlue"
    default:
      return "systemGray3"
  }
}

function statusLabel(status: CheckStatus): string {
  switch (status) {
    case "green":
      return "可用"
    case "yellow":
      return "API失效"
    case "red":
      return "失效"
    case "checking":
      return "检测中"
    default:
      return "未检测"
  }
}

function buildCheckingResult(): ApiCheckResult {
  return {
    status: "checking",
    baseAvailable: false,
    modelsAvailable: false,
    modelIds: [],
    checkedAt: null,
    message: "正在检测地址和模型列表…",
  }
}

function buildFailedResult(error: unknown): ApiCheckResult {
  return {
    status: "red",
    baseAvailable: false,
    modelsAvailable: false,
    modelIds: [],
    checkedAt: Date.now(),
    message: String((error as any)?.message ?? error ?? "检测失败"),
  }
}

function baseUrlCopyOptions(entry: ApiEntry): Array<{
  title: string
  copiedLabel: string
  suffix: string
}> {
  if (entry.compatibilityMode === "gemini") {
    return [
      { title: "复制原生地址", copiedLabel: "/v1beta", suffix: "/v1beta" },
      {
        title: "复制 OpenAI 地址",
        copiedLabel: "/v1beta/openai/chat/completions",
        suffix: "/v1beta/openai/chat/completions",
      },
    ]
  }
  if (entry.compatibilityMode === "openai") {
    return [
      { title: "复制模型地址", copiedLabel: "/v1/models", suffix: "/v1/models" },
      { title: "复制对话地址", copiedLabel: "/v1/chat/completions", suffix: "/v1/chat/completions" },
      { title: "复制响应地址", copiedLabel: "/v1/chat/responses", suffix: "/v1/chat/responses" },
    ]
  }
  return [
    { title: "复制对话地址", copiedLabel: "/v1/chat", suffix: "/v1/chat" },
    { title: "复制补全地址", copiedLabel: "/v1/chat/completions", suffix: "/v1/chat/completions" },
  ]
}

function buildMenuItems(props: {
  baseUrlOptions: Array<{
    title: string
    onCopy: () => void
  }>
  onCopyOriginalUrl: () => void
  onCopyApiKey: () => void
  onViewModels: () => void
  onCheckNow: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Group>
      <Button title="复制原链接" action={props.onCopyOriginalUrl} />
      <Button title="复制 API Key" action={props.onCopyApiKey} />
      {props.baseUrlOptions.map((item) => (
        <Button key={item.title} title={item.title} action={item.onCopy} />
      ))}
      <Button title="查看可用模型" action={props.onViewModels} />
      <Button title="立即检测" action={props.onCheckNow} />
      <Button title="编辑" action={props.onEdit} />
      <Button title="删除" role="destructive" action={props.onDelete} />
    </Group>
  )
}

export function HomeView() {
  const supportsMinimization =
    typeof Script.supportsMinimization === "function" && Script.supportsMinimization()
  const initialStateRef = useRef<ReturnType<typeof loadManagerState> | null>(null)
  if (!initialStateRef.current) {
    initialStateRef.current = loadManagerState()
  }
  const initialState = initialStateRef.current
  const [entries, setEntries] = useState<ApiEntry[]>(() => initialState.entries)
  const [autoCheckOnLaunch, setAutoCheckOnLaunch] = useState<boolean>(
    () => initialState.settings.autoCheckOnLaunch
  )
  const [autoCheckOnAdd, setAutoCheckOnAdd] = useState<boolean>(
    () => initialState.settings.autoCheckOnAdd
  )
  const [widgetRefreshHours, setWidgetRefreshHours] = useState<number>(
    () => initialState.settings.widgetRefreshHours
  )
  const [statusText, setStatusText] = useState("点击条目可打开复制菜单")
  const [checkingAll, setCheckingAll] = useState(false)
  const autoCheckedRef = useRef(false)

  useEffect(() => {
    saveManagerState({
      settings: {
        autoCheckOnLaunch,
        autoCheckOnAdd,
        widgetRefreshHours,
      },
      entries,
    })
  }, [autoCheckOnLaunch, autoCheckOnAdd, entries, widgetRefreshHours])

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.updatedAt - a.updatedAt),
    [entries]
  )

  const summary = useMemo(() => {
    return buildOverviewSummary(entries)
  }, [entries])

  const overviewItems = useMemo(
    () => buildOverviewItems(summary),
    [summary]
  )

  useEffect(() => {
    if (!autoCheckOnLaunch || !entries.length || autoCheckedRef.current) return
    autoCheckedRef.current = true
    void checkAllEntries()
  }, [autoCheckOnLaunch, entries.length])

  function updateEntry(entryId: string, updater: (entry: ApiEntry) => ApiEntry) {
    setEntries((current) => current.map((entry) => (entry.id === entryId ? updater(entry) : entry)))
  }

  async function copyText(value: string, message: string) {
    await Pasteboard.setString(value)
    setStatusText(message)
  }

  async function minimizeScript() {
    if (!supportsMinimization) return
    try {
      markMinimizeRequested()
      const ok = await Script.minimize()
      if (!ok) {
        clearMinimizeRequested()
        setStatusText("最小化未执行")
      }
    } catch (error: any) {
      clearMinimizeRequested()
      await Dialog.alert({ message: String(error?.message ?? error) })
    }
  }

  async function copyBaseUrl(entry: ApiEntry, suffix: string, label: string) {
    const value = joinBaseUrl(entry.baseUrl, suffix)
    await copyText(value, `已复制 ${entry.name} 的 ${label}`)
  }

  async function showModels(entry: ApiEntry) {
    if (!entry.check.modelIds.length) {
      await Dialog.alert({ message: `${entry.name} 当前没有可用模型` })
      return
    }

    await Navigation.present({
      element: (
        <ModelIdsView
          title={entry.name}
          modelIds={entry.check.modelIds}
          onCopy={(modelId) => copyText(modelId, `已复制模型 ID：${modelId}`)}
        />
      ),
    })
  }

  async function runCheck(entry: ApiEntry, silent = false) {
    updateEntry(entry.id, (current) => ({
      ...current,
      check: buildCheckingResult(),
      updatedAt: Date.now(),
    }))

    let result: ApiCheckResult
    try {
      result = await checkApiEntry(entry)
    } catch (error) {
      result = buildFailedResult(error)
    }
    updateEntry(entry.id, (current) => ({
      ...current,
      check: result,
      updatedAt: Date.now(),
    }))

    if (!silent) {
      setStatusText(`${entry.name}：${result.message}`)
    }
  }

  async function checkAllEntries() {
    if (!entries.length || checkingAll) return
    setCheckingAll(true)
    setStatusText("正在检测全部 API…")
    try {
      const snapshot = [...entries]
      const checkingAt = Date.now()
      const entryIds = new Set(snapshot.map((entry) => entry.id))
      setEntries((current) =>
        current.map((entry) =>
          entryIds.has(entry.id)
            ? {
                ...entry,
                check: buildCheckingResult(),
                updatedAt: checkingAt,
              }
            : entry
        )
      )

      await runChecksConcurrently(snapshot, async (entry, result, completedCount) => {
        setEntries((current) =>
          current.map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  check: result,
                  updatedAt: Date.now(),
                }
              : item
          )
        )
        if (completedCount < snapshot.length) {
          setStatusText(`正在检测全部 API… ${completedCount}/${snapshot.length}`)
        }
      })
      setStatusText(`全部检测完成，共 ${snapshot.length} 条`)
    } finally {
      setCheckingAll(false)
    }
  }

  async function addEntry() {
    const result = await Navigation.present<EditEntryResult>({
      element: <EditEntryView title="添加 API" />,
    })
    if (!result) return

    const nameExists = entries.some((entry) => entry.name === result.name)
    const urlExists = entries.some((entry) => entry.baseUrl === normalizeBaseUrl(result.baseUrl))
    if (nameExists) {
      await Dialog.alert({ message: "名称已存在" })
      return
    }
    if (urlExists) {
      await Dialog.alert({ message: "链接已存在" })
      return
    }

    const now = Date.now()
    const next: ApiEntry = {
      id: makeId(),
      name: result.name,
      compatibilityMode: result.compatibilityMode ?? "newapi",
      baseUrl: normalizeBaseUrl(result.baseUrl),
      apiKey: result.apiKey,
      updatedAt: now,
      check: makeEmptyCheckResult(),
    }
    setEntries((current) => [next, ...current])
    setStatusText(`已添加 ${next.name}`)
    if (autoCheckOnAdd) {
      void runCheck(next)
    }
  }

  async function openSettings() {
    const result = await Navigation.present<ManagerSettings>({
      element: (
        <SettingsView
          initial={{
            autoCheckOnLaunch,
            autoCheckOnAdd,
            widgetRefreshHours,
          }}
        />
      ),
    })
    if (!result) return

    const nextAutoCheck = Boolean(result.autoCheckOnLaunch)
    const nextAutoCheckOnAdd = Boolean(result.autoCheckOnAdd)
    const nextRefreshHours = Number(result.widgetRefreshHours) || widgetRefreshHours
    const shouldStartChecking = !autoCheckOnLaunch && nextAutoCheck && entries.length > 0

    setAutoCheckOnLaunch(nextAutoCheck)
    setAutoCheckOnAdd(nextAutoCheckOnAdd)
    setWidgetRefreshHours(nextRefreshHours)
    setStatusText(`已更新设置，小组件每 ${nextRefreshHours} 小时自动刷新`)

    if (shouldStartChecking) {
      autoCheckedRef.current = true
      void checkAllEntries()
    }
  }

  async function editEntry(entry: ApiEntry) {
    const result = await Navigation.present<EditEntryResult>({
      element: <EditEntryView title="编辑 API" initial={entry} />,
    })
    if (!result) return

    const fixedBaseUrl = normalizeBaseUrl(result.baseUrl)
    const nameExists = entries.some((item) => item.id !== entry.id && item.name === result.name)
    const urlExists = entries.some((item) => item.id !== entry.id && item.baseUrl === fixedBaseUrl)
    if (nameExists) {
      await Dialog.alert({ message: "名称已存在" })
      return
    }
    if (urlExists) {
      await Dialog.alert({ message: "链接已存在" })
      return
    }

    const shouldResetCheck =
      entry.baseUrl !== fixedBaseUrl ||
      entry.apiKey !== result.apiKey ||
      (result.compatibilityMode ?? entry.compatibilityMode) !== entry.compatibilityMode
    const updatedEntry: ApiEntry = {
      ...entry,
      name: result.name,
      compatibilityMode: result.compatibilityMode ?? entry.compatibilityMode,
      baseUrl: fixedBaseUrl,
      apiKey: result.apiKey,
      updatedAt: Date.now(),
      check: shouldResetCheck ? makeEmptyCheckResult() : entry.check,
    }

    setEntries((current) => current.map((item) => (item.id === entry.id ? updatedEntry : item)))
    setStatusText(`已更新 ${updatedEntry.name}`)

    if (autoCheckOnLaunch && shouldResetCheck) {
      void runCheck(updatedEntry)
    }
  }

  async function deleteEntry(entry: ApiEntry) {
    const ok = await Dialog.confirm({ message: `删除“${entry.name}”？` })
    if (!ok) return
    setEntries((current) => current.filter((item) => item.id !== entry.id))
    setStatusText(`已删除 ${entry.name}`)
  }

  async function showEntryMenu(entry: ApiEntry) {
    const copyOptions = baseUrlCopyOptions(entry)
    const index = await Dialog.actionSheet({
      title: entry.name,
      message: "选择你要执行的操作",
      actions: [
        { label: "复制原链接" },
        { label: "复制 API Key" },
        ...copyOptions.map((item) => ({ label: item.title })),
        { label: "查看可用模型" },
        { label: "立即检测" },
        { label: "编辑" },
        { label: "删除", destructive: true },
      ],
    })

    if (index == null || index < 0) return

    if (index === 0) await copyText(entry.baseUrl, `已复制 ${entry.name} 的原链接`)
    else if (index === 1) await copyText(entry.apiKey, `已复制 ${entry.name} 的 API Key`)
    else if (index >= 2 && index < 2 + copyOptions.length) {
      const target = copyOptions[index - 2]
      if (target) await copyBaseUrl(entry, target.suffix, target.copiedLabel)
    } else if (index === 2 + copyOptions.length) await showModels(entry)
    else if (index === 3 + copyOptions.length) await runCheck(entry)
    else if (index === 4 + copyOptions.length) await editEntry(entry)
    else if (index === 5 + copyOptions.length) await deleteEntry(entry)
  }

  return (
    <NavigationStack>
      <List
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{
          topBarLeading: (
            <HStack spacing={10}>
              <Button
                title=""
                systemImage="gearshape"
                action={withHaptic(openSettings)}
              />
              <Button
                title=""
                systemImage="arrow.clockwise"
                disabled={!entries.length || checkingAll}
                action={withHaptic(checkAllEntries)}
              />
            </HStack>
          ),
          topBarTrailing: (
            <HStack spacing={10}>
              <Button
                title=""
                systemImage="plus"
                action={withHaptic(addEntry)}
              />
              {supportsMinimization ? (
                <Button
                  title=""
                  systemImage="minus.circle"
                  action={withHaptic(minimizeScript)}
                />
              ) : null}
              <Button
                title=""
                systemImage="xmark.circle.fill"
                foregroundStyle="systemRed"
                action={withHaptic(() => Script.exit())}
              />
            </HStack>
          ),
        }}
      >
        <Section header={<Text>概览</Text>} footer={<Text>{statusText}</Text>}>
          <VStack
            frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
            spacing={12}
            padding={{ top: 10, bottom: 10 }}
          >
            <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={14}>
              <VStack frame={{ maxWidth: "infinity", alignment: "center" as any }} spacing={6}>
                {entries.length ? (
                  <Button
                    buttonStyle="plain"
                    disabled={checkingAll}
                    action={withHaptic(checkAllEntries)}
                  >
                    <ZStack
                      frame={{
                        width: 220,
                        height: 220,
                      }}
                      background={"rgba(0,0,0,0.001)"}
                    >
                      <Chart
                        frame={{
                          width: 220,
                          height: 220,
                        }}
                        chartXAxis="hidden"
                        chartYAxis="hidden"
                        chartLegend="hidden"
                        chartForegroundStyleScale={chartColorScale()}
                      >
                        <DonutChart
                          marks={overviewItems
                            .filter((item) => item.count > 0)
                            .map((item) => ({
                              category: item.label,
                              value: item.count,
                              innerRadius: {
                                type: "ratio",
                                value: 0.618,
                              },
                              outerRadius: {
                                type: "inset",
                                value: 10,
                              },
                              angularInset: 1,
                            }))}
                        />
                      </Chart>
                      <VStack spacing={2}>
                        <Text
                          font="largeTitle"
                          foregroundStyle="systemGreen"
                          offset={{ x: 0, y: -1 }}
                        >
                          {summary.green}
                        </Text>
                      </VStack>
                    </ZStack>
                  </Button>
                ) : (
                  <Circle
                    fill="systemGray6"
                    frame={{ width: 220, height: 220 }}
                    overlay={
                      <VStack spacing={2}>
                        <Text font="largeTitle" offset={{ x: 0, y: -1 }}>0</Text>
                      </VStack>
                    }
                  />
                )}
              </VStack>

              <VStack frame={{ width: "100%" as any, alignment: "topLeading" as any }} spacing={8}>
                {overviewItems.map((item) => (
                  <HStack key={item.key} frame={{ width: "100%" as any }} spacing={10}>
                    <Circle fill={item.color} frame={{ width: 10, height: 10 }} />
                    <Text
                      font="footnote"
                      frame={{ width: 64, alignment: "leading" as any }}
                      foregroundStyle="secondaryLabel"
                    >
                      {item.label}
                    </Text>
                    <Spacer />
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                      {item.count}
                    </Text>
                  </HStack>
                ))}
              </VStack>
            </VStack>
          </VStack>
        </Section>

        <Section
          header={<Text>API 列表</Text>}
          footer={
            <Text>
              {entries.length
                ? "点按条目打开菜单，长按可直接使用上下文菜单。"
                : "还没有保存任何 API，先添加一条。"}
            </Text>
          }
        >
          {sortedEntries.length ? (
            sortedEntries.map((entry) => {
              const copyOptions = baseUrlCopyOptions(entry)
              const checkedAtLabel = formatDateTime(entry.check.checkedAt)
              return (
                <Button
                  key={entry.id}
                  buttonStyle="plain"
                  action={withHaptic(() => showEntryMenu(entry))}
                  contextMenu={{
                    menuItems: buildMenuItems({
                      baseUrlOptions: copyOptions.map((item) => ({
                        title: item.title,
                        onCopy: () => void copyBaseUrl(entry, item.suffix, item.copiedLabel),
                      })),
                      onCopyOriginalUrl: () => void copyText(entry.baseUrl, `已复制 ${entry.name} 的原链接`),
                      onCopyApiKey: () => void copyText(entry.apiKey, `已复制 ${entry.name} 的 API Key`),
                      onViewModels: () => void showModels(entry),
                      onCheckNow: () => void runCheck(entry),
                      onEdit: () => void editEntry(entry),
                      onDelete: () => void deleteEntry(entry),
                    }),
                  }}
                >
                  <VStack
                    frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
                    spacing={8}
                    padding={{ top: 10, bottom: 10 }}
                  >
                    <HStack frame={{ width: "100%" as any }} spacing={10}>
                      <Circle fill={statusColor(entry.check.status)} frame={{ width: 12, height: 12 }} />
                      <Text font="headline">{entry.name}</Text>
                      <Spacer />
                      <Text font="footnote" foregroundStyle="secondaryLabel">
                        {statusLabel(entry.check.status)}
                      </Text>
                    </HStack>
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                      {entry.baseUrl}
                    </Text>
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                      API Key：{maskApiKey(entry.apiKey)}
                    </Text>
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                      {entry.check.message}
                    </Text>
                    <Text font="footnote" foregroundStyle="tertiaryLabel">
                      最后检测：{checkedAtLabel}
                    </Text>
                  </VStack>
                </Button>
              )
            })
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无 API 条目</Text>
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}
