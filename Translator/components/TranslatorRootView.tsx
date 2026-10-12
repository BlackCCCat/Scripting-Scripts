import { Tab, TabView, useColorScheme, useEffect, useEffectEvent, useObservable, useRef, useState } from "scripting"

import { LivePipView } from "./LivePipView"
import { LiveTranslationView } from "./LiveTranslationView"
import { ScriptTranslationView } from "./ScriptTranslationView"
import { TranslatorSettingsView } from "./TranslatorSettingsView"
import { createTranslationEngine } from "../utils/translation_engine"
import { createSystemTranslationEngine } from "../utils/system_translation_engine"
import { isLiveEngineAvailable, translateLiveClipboardText } from "../utils/live_translation"
import { useTranslatorReleaseNotesSheet } from "../utils/release_notes_sheet"
import { getExecutableEngines, loadTranslatorSettings } from "../utils/translator_settings"

const TRANSLATE_TAB = 0
const LIVE_TAB = 1
const SETTINGS_TAB = 2

export function TranslatorRootView() {
  const colorScheme = useColorScheme()
  const selection = useObservable<number>(() => TRANSLATE_TAB)
  const pipPresented = useObservable(false)
  const preview = useObservable("复制文本后，译文将在这里显示。")
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0)
  const [settings, setSettings] = useState(() => loadTranslatorSettings())
  const [sourceLanguageCode, setSourceLanguageCode] = useState(() => settings.defaultSourceLanguageCode)
  const [targetLanguageCode, setTargetLanguageCode] = useState(() =>
    settings.defaultTargetLanguageCode === "zh-Hans" ? "auto" : settings.defaultTargetLanguageCode
  )
  const [engineId, setEngineId] = useState("")
  const [sizeIndex, setSizeIndex] = useState(3)
  const [active, setActive] = useState(false)
  const [systemTranslationHost] = useState(() => new Translation())
  const [appleEngine] = useState(() => createTranslationEngine())
  const [systemEngine] = useState(() => createSystemTranslationEngine(systemTranslationHost))
  const timerRef = useRef<number | null>(null)
  const lastClipboardChangeCountRef = useRef<number | null>(null)
  const lastClipboardCheckAtRef = useRef(0)
  const pollingGenerationRef = useRef<number | null>(null)
  const monitorRunningRef = useRef(false)
  const generationRef = useRef(0)
  const releaseNotesSheet = useTranslatorReleaseNotesSheet({
    title: "更新内容",
  })
  const engines = getExecutableEngines(settings).filter(isLiveEngineAvailable)
  const selectedEngine = engines.find((engine) => engine.id === engineId) ?? engines[0]

  const checkClipboard = useEffectEvent(async (generation: number) => {
    if (pollingGenerationRef.current === generation || generation !== generationRef.current) return
    if (Date.now() - lastClipboardCheckAtRef.current < 750) return
    lastClipboardCheckAtRef.current = Date.now()
    pollingGenerationRef.current = generation
    try {
      const changeCount = await Pasteboard.changeCount
      if (generation !== generationRef.current || changeCount === lastClipboardChangeCountRef.current) return
      lastClipboardChangeCountRef.current = changeCount
      const hasStrings = await Pasteboard.hasStrings
      const hasURLs = await Pasteboard.hasURLs
      let sourceText = hasStrings
        ? (await Pasteboard.getStrings())?.find((text) => text.trim())?.trim()
        : undefined
      if (!sourceText && hasURLs) sourceText = (await Pasteboard.getURLs())?.find((url) => url.trim())?.trim()
      if (generation !== generationRef.current) return
      if (!sourceText) {
        if (hasStrings || hasURLs) {
          const message = "剪贴板包含内容，但读取结果为空。请查看控制台中的剪贴板状态。"
          if (preview.value !== message) {
            console.warn("[Translator] 剪贴板内容无法读取", { hasStrings, hasURLs })
            preview.setValue(message)
          }
        }
        return
      }
      const isCurrent = () => generation === generationRef.current && lastClipboardChangeCountRef.current === changeCount
      const engine = selectedEngine
      if (!engine) {
        preview.setValue("当前没有可用的翻译引擎。")
        return
      }

      preview.setValue("正在翻译…")
      console.log("[Translator] 实时翻译读取到新剪贴板文本", { length: sourceText.length, engine: engine.label })
      void translateLiveClipboardText({
        engine,
        sourceText,
        sourceLanguageCode,
        targetLanguageCode,
        localEngine: appleEngine,
        systemEngine,
        isCurrent,
        onText: (text) => preview.setValue(text),
      }).catch((error) => {
        if (isCurrent()) preview.setValue(`翻译失败：${error instanceof Error ? error.message : String(error)}`)
      })
    } catch (error) {
      if (generation === generationRef.current) {
        console.error("[Translator] 读取剪贴板失败", error)
        preview.setValue(`读取剪贴板失败：${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      if (pollingGenerationRef.current === generation) pollingGenerationRef.current = null
    }
  })

  function stopMonitor() {
    generationRef.current += 1
    monitorRunningRef.current = false
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    lastClipboardChangeCountRef.current = null
    lastClipboardCheckAtRef.current = 0
    console.log("[Translator] 实时翻译监听已停止")
    setActive(false)
    pipPresented.setValue(false)
  }

  function startMonitor() {
    if (monitorRunningRef.current) return
    monitorRunningRef.current = true
    const generation = ++generationRef.current
    lastClipboardChangeCountRef.current = null
    lastClipboardCheckAtRef.current = 0
    setActive(true)
    preview.setValue("等待复制文本…")
    console.log("[Translator] 实时翻译监听已启动")
    function scheduleNextCheck() {
      if (generation !== generationRef.current) return
      timerRef.current = setTimeout(() => {
        scheduleNextCheck()
        void checkClipboard(generation)
      }, 900)
    }
    void Pasteboard.changeCount.then((changeCount) => {
      if (generation !== generationRef.current) return
      lastClipboardChangeCountRef.current = changeCount
      scheduleNextCheck()
    }).catch((error) => {
      if (generation !== generationRef.current) return
      console.warn("[Translator] 无法读取剪贴板变化次数，尝试直接监听", error)
      scheduleNextCheck()
    })
  }

  useEffect(() => () => {
    generationRef.current += 1
    monitorRunningRef.current = false
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    appleEngine.dispose()
  }, [appleEngine])

  return (
    <TabView
      selection={selection}
      preferredColorScheme={colorScheme}
      tint="systemBlue"
      tabViewStyle="sidebarAdaptable"
      tabBarMinimizeBehavior="onScrollDown"
      sheet={releaseNotesSheet}
      translationHost={systemTranslationHost}
      pip={{
        isPresented: pipPresented,
        maximumUpdatesPerSecond: 12,
        content: (
          <LivePipView
            text={preview}
            sizeIndex={sizeIndex}
            colorScheme={colorScheme}
            onStart={() => {
              if (pipPresented.value) startMonitor()
            }}
            onStop={stopMonitor}
            onClipboardTick={() => {
              if (timerRef.current !== null) void checkClipboard(generationRef.current)
            }}
          />
        ),
      }}
    >
      <Tab title="翻译" systemImage="character.bubble" value={TRANSLATE_TAB}>
        <ScriptTranslationView
          settingsRefreshKey={settingsRefreshKey}
        />
      </Tab>

      <Tab title="实时翻译" systemImage="pip.enter" value={LIVE_TAB}>
        <LiveTranslationView
          engines={engines}
          engineId={selectedEngine?.id ?? ""}
          onEngineChanged={setEngineId}
          sourceLanguageCode={sourceLanguageCode}
          onSourceChanged={setSourceLanguageCode}
          targetLanguageCode={targetLanguageCode}
          onTargetChanged={setTargetLanguageCode}
          sizeIndex={sizeIndex}
          onSizeChanged={setSizeIndex}
          preview={preview}
          active={active}
          onToggle={() => {
            if (active || pipPresented.value) stopMonitor()
            else {
              startMonitor()
              pipPresented.setValue(true)
            }
          }}
        />
      </Tab>

      <Tab title="设置" systemImage="gearshape.fill" value={SETTINGS_TAB}>
        <TranslatorSettingsView
          onSettingsChanged={() => {
            setSettingsRefreshKey((current) => current + 1)
            const next = loadTranslatorSettings()
            setSettings(next)
          }}
        />
      </Tab>
    </TabView>
  )
}
