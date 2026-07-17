import {
  Button,
  Group,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  NavigationStack,
  Picker,
  ProgressView,
  RoundedRectangle,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  useEffect,
  useEffectEvent,
  useColorScheme,
  useRef,
  useState,
  ZStack,
} from "scripting"

import { AUTO_LANGUAGE, LANGUAGE_OPTIONS } from "../constants"
import type {
  EngineTranslationState,
  LanguageOption,
} from "../types"
import {
  createAssistantTranslationEngine,
  isAssistantTranslationAvailable,
} from "../utils/assistant_translation_engine"
import {
  createTranslationEngine,
  detectSourceLanguageCode,
  isLocalTranslationAvailable,
} from "../utils/translation_engine"
import {
  isExternalEngineConfigured,
  translateWithExternalEngine,
} from "../utils/external_translation_engines"
import {
  createSystemTranslationEngine,
  isSystemTranslationAvailable,
} from "../utils/system_translation_engine"
import {
  getExecutableEngines,
  loadTranslatorSettings,
} from "../utils/translator_settings"

type ScriptTranslationViewProps = {
  settingsRefreshKey?: number
}

function summarizeText(text: string, maxLength = 48) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized
}

function logTranslationEvent(message: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.log(`[Translator] ${message}`, payload)
    return
  }
  console.log(`[Translator] ${message}`)
}

function assistantLogOptions(engine: { kind?: string; config?: any }) {
  if (engine.kind !== "assistant") return {}

  const providerId = String(engine.config?.assistantProviderId ?? "openai").trim() || "openai"
  const customProvider = String(engine.config?.assistantCustomProvider ?? "").trim()
  const modelId = String(engine.config?.assistantModelId ?? "").trim()

  return {
    provider: providerId === "custom" ? `{ custom: "${customProvider}" }` : providerId,
    modelId: modelId || "(default)",
  }
}

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try {
      HapticFeedback.lightImpact()
    } catch {}
    void action()
  }
}

function dismissKeyboardIfNeeded() {
  if (!Keyboard.visible) return
  setTimeout(() => Keyboard.hide(), 0)
}

function pickerLabel(option: LanguageOption) {
  if (option.code === AUTO_LANGUAGE.code) {
    return "自动检测-Auto"
  }

  return `${option.label}-${option.promptName}`
}

function targetLanguageLabel(code: string) {
  const option = LANGUAGE_OPTIONS.find((item) => item.code === code) ?? LANGUAGE_OPTIONS[0]
  const promptName = option.promptName === "Simplified Chinese"
    ? "Chinese Simplified"
    : option.promptName === "Traditional Chinese"
      ? "Chinese Traditional"
      : option.promptName
  return `${option.label}-${promptName}`
}

function sourceLanguageLabel(code: string) {
  if (code === AUTO_LANGUAGE.code) {
    return "自动检测-Auto"
  }
  return targetLanguageLabel(code)
}

function LanguageMenu(props: {
  title: string
  value: string
  selectedLabel: string
  onChanged: (value: string) => void
  options: LanguageOption[]
  alignment?: "leading" | "trailing"
}) {
  const align = props.alignment ?? "leading"
  return (
    <Menu
      label={
        <HStack spacing={4}>
          <Text
            font="subheadline"
            foregroundStyle="accentColor"
            lineLimit={1}
            truncationMode="tail"
            allowsTightening
            frame={{ maxWidth: 160, alignment: align as any }}
            multilineTextAlignment={align}
          >
            {props.selectedLabel}
          </Text>
          <Image
            systemName="chevron.down"
            font="caption2"
            foregroundStyle="accentColor"
          />
        </HStack>
      }
    >
      <Picker
        title={props.title}
        value={props.value}
        onChanged={props.onChanged}
      >
        {props.options.map((option) => (
          <Text key={option.code} tag={option.code}>
            {pickerLabel(option)}
          </Text>
        ))}
      </Picker>
    </Menu>
  )
}

function CopyableTextRow(props: {
  text: string
  emptyText?: string
  foregroundStyle?: any
  onTapWhenEmpty?: () => void | Promise<void>
  onRetranslate?: () => void | Promise<void>
}) {
  const colorScheme = useColorScheme()
  const hasText = props.text.trim().length > 0
  const canTap = hasText || !!props.onTapWhenEmpty
  const hasMenu = hasText || !!props.onRetranslate
  const copyAction = withHaptic(async () => {
    if (!hasText) return
    await Pasteboard.setString(props.text)
    try {
      HapticFeedback.notificationSuccess()
    } catch {}
  })
  const emptyTapAction = props.onTapWhenEmpty ? withHaptic(props.onTapWhenEmpty) : undefined
  const darkCardFill: any = "secondarySystemGroupedBackground"

  return (
    <ZStack
      onTapGesture={canTap ? (hasText ? copyAction : emptyTapAction) : undefined}
      contextMenu={hasMenu ? {
        menuItems: (
          <Group>
            {hasText ? (
              <Button
                title="复制"
                systemImage="doc.on.doc"
                action={withHaptic(async () => {
                  await Pasteboard.setString(props.text)
                })}
              />
            ) : null}
            {props.onRetranslate ? (
              <Button
                title="重译"
                systemImage="arrow.clockwise"
                action={withHaptic(props.onRetranslate)}
              />
            ) : null}
          </Group>
        ),
      } : undefined}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      contentShape={{
        kind: "interaction",
        shape: "rect",
      }}
    >
      <RoundedRectangle
        cornerRadius={16}
        fill={colorScheme === "dark" ? darkCardFill : "systemBackground"}
        frame={{ maxWidth: "infinity", minHeight: 62 }}
      />
      <VStack
        frame={{ maxWidth: "infinity", minHeight: 62, alignment: "topLeading" as any }}
        padding={{ top: 12, bottom: 12, leading: 14, trailing: 14 }}
      >
        <Text
          frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
          multilineTextAlignment="leading"
          selectionDisabled={false}
          foregroundStyle={props.foregroundStyle}
          fixedSize={{ horizontal: false, vertical: true }}
        >
          {hasText ? props.text : (props.emptyText || "")}
        </Text>
      </VStack>
    </ZStack>
  )
}

function CardHeader(props: {
  systemImage: string
  title: string
}) {
  return (
    <HStack spacing={8}>
      <Image systemName={props.systemImage} font="subheadline" foregroundStyle="accentColor" />
      <Text font="headline">{props.title}</Text>
    </HStack>
  )
}

function WanxiangCard(props: {
  children: any
  minHeight?: number
  padding?: number
}) {
  const colorScheme = useColorScheme()
  const darkCardFill: any = "secondarySystemGroupedBackground"
  const padding = props.padding ?? 14
  const minHeight = props.minHeight ?? 62

  return (
    <ZStack frame={{ maxWidth: "infinity" }}>
      {colorScheme === "dark" ? (
        <RoundedRectangle
          cornerRadius={16}
          fill={darkCardFill}
          frame={{ maxWidth: "infinity", minHeight }}
        />
      ) : (
        <RoundedRectangle
          cornerRadius={16}
          fill={"systemBackground"}
          frame={{ maxWidth: "infinity", minHeight }}
        />
      )}
      <VStack
        spacing={12}
        frame={{ maxWidth: "infinity", minHeight, alignment: "topLeading" as any }}
        padding={{ top: padding, bottom: padding, leading: padding, trailing: padding }}
      >
        {props.children}
      </VStack>
    </ZStack>
  )
}

export function ScriptTranslationView(props: ScriptTranslationViewProps) {
  const dismiss = Navigation.useDismiss()
  const [settings, setSettings] = useState(() => loadTranslatorSettings())
  const [sourceText, setSourceText] = useState("")
  const [sourceLanguageCode, setSourceLanguageCode] = useState(() => settings.defaultSourceLanguageCode)
  const [targetLanguageCode, setTargetLanguageCode] = useState(() => settings.defaultTargetLanguageCode)
  const [errorText, setErrorText] = useState("")
  const [engineResults, setEngineResults] = useState<EngineTranslationState[]>([])
  const [systemTranslationHost] = useState(() => new Translation())
  const [appleEngine] = useState(() => createTranslationEngine())
  const [systemEngine] = useState(() => createSystemTranslationEngine(systemTranslationHost))
  const requestIdRef = useRef(0)
  const targetTouchedRef = useRef(false)
  const executableEngines = getExecutableEngines(settings)
  const assistantConfig = settings.engines.find((engine) => engine.kind === "assistant")?.config
  const hasInput = sourceText.trim().length > 0

  const visibleEngines = executableEngines.filter((engine) => {
    const available = engine.kind === "apple_intelligence"
      ? isLocalTranslationAvailable()
      : engine.kind === "assistant"
        ? isAssistantTranslationAvailable()
      : engine.kind === "system_translation"
        ? isSystemTranslationAvailable()
        : isExternalEngineConfigured(engine)

    return engine.enabled && available
  })

  function createLoadingStates(): EngineTranslationState[] {
    return visibleEngines.map((engine) => ({
      engineId: engine.id,
      engineName: engine.label,
      systemImage: engine.systemImage,
      translatedText: "",
      errorText: "",
      isTranslating: true,
    }))
  }

  async function translateEngine(engine: typeof visibleEngines[number]) {
    const request = {
      sourceText,
      sourceLanguageCode,
      targetLanguageCode,
    }

    const result = engine.kind === "apple_intelligence"
      ? await appleEngine.translate(request)
      : engine.kind === "assistant"
        ? await createAssistantTranslationEngine(assistantConfig).translate(request)
        : engine.kind === "system_translation"
          ? await systemEngine.translate(request)
          : await translateWithExternalEngine(engine, request)

    return {
      engineId: engine.id,
      engineName: engine.label,
      systemImage: engine.systemImage,
      translatedText: result.translatedText,
      errorText: "",
      isTranslating: false,
    } satisfies EngineTranslationState
  }

  useEffect(() => {
    appleEngine.prewarm()
    return () => {
      appleEngine.dispose()
    }
  }, [appleEngine])

  useEffect(() => {
    if (props.settingsRefreshKey == null) return

    const nextSettings = loadTranslatorSettings()
    setSettings(nextSettings)
    setSourceLanguageCode(nextSettings.defaultSourceLanguageCode)
    setTargetLanguageCode(nextSettings.defaultTargetLanguageCode)
    setErrorText("")
    setEngineResults([])
    targetTouchedRef.current = false
  }, [props.settingsRefreshKey])

  useEffect(() => {
    if (!hasInput) return
    if (sourceLanguageCode !== AUTO_LANGUAGE.code) return
    if (targetTouchedRef.current) return
    if (settings.defaultTargetLanguageCode !== "zh-Hans") return

    let cancelled = false

    void (async () => {
      const detected = await detectSourceLanguageCode(sourceText)
      if (cancelled || !detected) return

      if ((detected === "zh-Hans" || detected === "zh-Hant") && targetLanguageCode !== "en") {
        setTargetLanguageCode("en")
        return
      }

      if (detected === "en" && targetLanguageCode !== "zh-Hans") {
        setTargetLanguageCode("zh-Hans")
      }
    })()

    return () => {
      cancelled = true
    }
  }, [hasInput, settings.defaultTargetLanguageCode, sourceLanguageCode, sourceText, targetLanguageCode])

  const runTranslation = useEffectEvent(async () => {
    dismissKeyboardIfNeeded()

    if (!hasInput) {
      setErrorText("请输入要翻译的文本。")
      setEngineResults([])
      return
    }

    if (!visibleEngines.length) {
      logTranslationEvent("没有可执行的翻译引擎", {
        sourceLanguageCode,
        targetLanguageCode,
      })
      setEngineResults([])
      setErrorText("没有启用且可用的翻译引擎。")
      return
    }

    if (
      sourceLanguageCode !== AUTO_LANGUAGE.code &&
      sourceLanguageCode === targetLanguageCode
    ) {
      setEngineResults(visibleEngines.map((engine) => ({
        engineId: engine.id,
        engineName: engine.label,
        systemImage: engine.systemImage,
        translatedText: "",
        errorText: "源语言和目标语言不能相同。",
        isTranslating: false,
      })))
      setErrorText("源语言和目标语言不能相同。")
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const startedAt = Date.now()
    setErrorText("")
    setEngineResults(createLoadingStates())

    logTranslationEvent("开始脚本内翻译", {
      requestId,
      sourceLength: sourceText.length,
      sourcePreview: summarizeText(sourceText),
      sourceLanguageCode,
      targetLanguageCode,
      engines: visibleEngines.map((engine) => ({
        engineName: engine.label,
        ...assistantLogOptions(engine),
      })),
    })

    try {
      await Promise.allSettled(
        visibleEngines.map(async (engine) => {
          const engineStartedAt = Date.now()
          try {
            const result = await translateEngine(engine)
            if (requestId !== requestIdRef.current) return null

            logTranslationEvent("脚本内引擎翻译成功", {
              requestId,
              engineId: engine.id,
              engineName: engine.label,
              ...assistantLogOptions(engine),
              elapsedMs: Date.now() - engineStartedAt,
              translatedLength: result.translatedText.length,
              translatedPreview: summarizeText(result.translatedText),
            })

            setEngineResults((current) => current.map((item) => (
              item.engineId === engine.id ? result : item
            )))
            return result
          } catch (error) {
            if (requestId !== requestIdRef.current) return null

            const message = error instanceof Error ? error.message : String(error)
            console.error(`[Translator] 脚本内引擎翻译失败`, {
              requestId,
              engineId: engine.id,
              engineName: engine.label,
              ...assistantLogOptions(engine),
              elapsedMs: Date.now() - engineStartedAt,
              error: message,
            })

            const failed = {
              engineId: engine.id,
              engineName: engine.label,
              systemImage: engine.systemImage,
              translatedText: "",
              errorText: message,
              isTranslating: false,
            } satisfies EngineTranslationState
            setEngineResults((current) => current.map((item) => (
              item.engineId === engine.id ? failed : item
            )))
            return failed
          }
        })
      )

      if (requestId !== requestIdRef.current) return

      logTranslationEvent("脚本内翻译完成", {
        requestId,
        elapsedMs: Date.now() - startedAt,
      })
      try {
        HapticFeedback.notificationSuccess()
      } catch {}
    } catch (error) {
      if (requestId !== requestIdRef.current) return

      const message = error instanceof Error ? error.message : String(error)
      console.error(`[Translator] 脚本内翻译流程失败`, {
        requestId,
        elapsedMs: Date.now() - startedAt,
        error: message,
      })
      setErrorText(message)
      try {
        HapticFeedback.notificationError()
      } catch {}
    }
  })

  const rerunSingleEngine = useEffectEvent(async (engineId: string) => {
    const engine = visibleEngines.find((item) => item.id === engineId)
    if (!engine || !hasInput) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const startedAt = Date.now()
    setErrorText("")
    setEngineResults((current) => current.map((item) => (
      item.engineId === engineId
        ? {
            ...item,
            isTranslating: true,
            errorText: "",
          }
        : item
    )))

    try {
      const result = await translateEngine(engine)
      if (requestId !== requestIdRef.current) return

      logTranslationEvent("脚本内单引擎重试成功", {
        requestId,
        engineId: engine.id,
        engineName: engine.label,
        ...assistantLogOptions(engine),
        elapsedMs: Date.now() - startedAt,
        translatedLength: result.translatedText.length,
        translatedPreview: summarizeText(result.translatedText),
      })

      setEngineResults((current) => current.map((item) => (
        item.engineId === engineId ? result : item
      )))
      try {
        HapticFeedback.notificationSuccess()
      } catch {}
    } catch (error) {
      if (requestId !== requestIdRef.current) return

      const message = error instanceof Error ? error.message : String(error)
      console.error(`[Translator] 脚本内单引擎重试失败`, {
        requestId,
        engineId: engine.id,
        engineName: engine.label,
        ...assistantLogOptions(engine),
        elapsedMs: Date.now() - startedAt,
        error: message,
      })

      setEngineResults((current) => current.map((item) => (
        item.engineId === engineId
          ? {
              ...item,
              translatedText: "",
              errorText: message,
              isTranslating: false,
            }
          : item
      )))
      try {
        HapticFeedback.notificationError()
      } catch {}
    }
  })

  const pasteFromPasteboard = useEffectEvent(async () => {
    const value = (await Pasteboard.getString())?.trim() ?? ""
    if (!value) {
      try {
        HapticFeedback.notificationWarning()
      } catch {}
      return
    }

    setSourceText(value)
    setErrorText("")
    targetTouchedRef.current = false
    try {
      HapticFeedback.selection()
    } catch {}
  })

  const clearSourceText = useEffectEvent(() => {
    requestIdRef.current += 1
    setSourceText("")
    setErrorText("")
    setEngineResults([])
    targetTouchedRef.current = false
    try {
      HapticFeedback.selection()
    } catch {}
  })

  const selectSourceLanguage = useEffectEvent((code: string) => {
    setSourceLanguageCode(code)
    setErrorText("")
  })

  const selectTargetLanguage = useEffectEvent((code: string) => {
    targetTouchedRef.current = true
    setTargetLanguageCode(code)
    setErrorText("")
  })

  return (
    <NavigationStack>
      <List
        navigationTitle="翻译"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        listSectionSpacing={14}
        scrollDismissesKeyboard="interactively"
        toolbar={{
          topBarLeading: (
            <Button action={() => dismiss()}>
              <Image systemName="xmark" fontWeight="semibold" foregroundStyle="red" />
            </Button>
          ),
        }}
      >
        <Section
          header={
            <CardHeader systemImage="globe" title="语言" />
          }
        >
          <HStack spacing={12}>
            <Text>源语言</Text>
            <Spacer />
            <Menu
              label={
                <HStack spacing={4}>
                  <Text
                    foregroundStyle="accentColor"
                    lineLimit={1}
                    truncationMode="tail"
                    allowsTightening
                    frame={{ maxWidth: 160, alignment: "trailing" as any }}
                    multilineTextAlignment="trailing"
                  >
                    {sourceLanguageLabel(sourceLanguageCode)}
                  </Text>
                  <Image
                    systemName="chevron.down"
                    font="caption2"
                    foregroundStyle="accentColor"
                  />
                </HStack>
              }
            >
              <Picker
                title="源语言"
                value={sourceLanguageCode}
                onChanged={selectSourceLanguage}
              >
                {[AUTO_LANGUAGE, ...LANGUAGE_OPTIONS].map((option) => (
                  <Text key={option.code} tag={option.code}>
                    {sourceLanguageLabel(option.code)}
                  </Text>
                ))}
              </Picker>
            </Menu>
          </HStack>
          <HStack spacing={12}>
            <Text>目标语言</Text>
            <Spacer />
            <Menu
              label={
                <HStack spacing={4}>
                  <Text
                    foregroundStyle="accentColor"
                    lineLimit={1}
                    truncationMode="tail"
                    allowsTightening
                    frame={{ maxWidth: 160, alignment: "trailing" as any }}
                    multilineTextAlignment="trailing"
                  >
                    {targetLanguageLabel(targetLanguageCode)}
                  </Text>
                  <Image
                    systemName="chevron.down"
                    font="caption2"
                    foregroundStyle="accentColor"
                  />
                </HStack>
              }
            >
              <Picker
                title="目标语言"
                value={targetLanguageCode}
                onChanged={selectTargetLanguage}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <Text key={option.code} tag={option.code}>
                    {targetLanguageLabel(option.code)}
                  </Text>
                ))}
              </Picker>
            </Menu>
          </HStack>
        </Section>

        <Section
          header={
            <CardHeader systemImage="square.and.pencil" title="输入" />
          }
          listRowSeparator="hidden"
          listSectionSeparator="hidden"
        >
          <WanxiangCard minHeight={128}>
            <VStack spacing={12} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
              <TextField
                title=""
                value={sourceText}
                onChanged={(value: string) => {
                  setSourceText(value)
                  setErrorText("")
                }}
                prompt="输入要翻译的文本"
                axis="vertical"
                submitLabel="done"
                onSubmit={runTranslation}
                frame={{ minHeight: 96, maxWidth: "infinity" as any, alignment: "topLeading" as any }}
              />
              <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "trailing" as any }}>
                <Button
                  title="清空"
                  systemImage="xmark.circle"
                  buttonStyle="bordered"
                  controlSize="regular"
                  disabled={!hasInput}
                  action={clearSourceText}
                />
                <Button
                  title="粘贴"
                  systemImage="doc.on.clipboard"
                  buttonStyle="bordered"
                  controlSize="regular"
                  action={pasteFromPasteboard}
                />
                <Button
                  buttonStyle="borderedProminent"
                  controlSize="regular"
                  disabled={!hasInput}
                  action={runTranslation}
                >
                  <HStack spacing={6}>
                    <Image
                      systemName="arrow.triangle.2.circlepath"
                      foregroundStyle="white"
                    />
                    <Text foregroundStyle="white">翻译</Text>
                  </HStack>
                </Button>
              </HStack>
            </VStack>
          </WanxiangCard>
        </Section>

        {!hasInput && !engineResults.length ? (
          <Section
            header={
              <CardHeader systemImage="text.bubble" title="结果" />
            }
            listRowSeparator="hidden"
            listSectionSeparator="hidden"
          >
            <WanxiangCard>
              <Text foregroundStyle="secondaryLabel">
                输入文本后点击翻译，将按当前已启用的引擎输出结果。
              </Text>
            </WanxiangCard>
          </Section>
        ) : visibleEngines.length === 0 ? (
          <Section
            header={
              <CardHeader systemImage="text.bubble" title="结果" />
            }
            listRowSeparator="hidden"
            listSectionSeparator="hidden"
          >
            <WanxiangCard>
              <Text foregroundStyle="secondaryLabel">
                {errorText || "没有启用且可用的翻译引擎。"}
              </Text>
            </WanxiangCard>
          </Section>
        ) : (
          engineResults.map((result) => (
            <Section
              key={result.engineId}
              header={
                <CardHeader systemImage={result.systemImage} title={result.engineName} />
              }
              listRowSeparator="hidden"
              listSectionSeparator="hidden"
            >
              {result.isTranslating ? (
                <WanxiangCard>
                  <VStack spacing={10} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
                    <ProgressView />
                  </VStack>
                </WanxiangCard>
              ) : result.translatedText ? (
                <CopyableTextRow
                  text={result.translatedText}
                  onRetranslate={runTranslation}
                />
              ) : (
                <CopyableTextRow
                  text=""
                  emptyText={result.errorText || errorText || "暂无译文"}
                  foregroundStyle={(result.errorText || errorText) ? "systemRed" : "secondaryLabel"}
                  onTapWhenEmpty={() => rerunSingleEngine(result.engineId)}
                  onRetranslate={runTranslation}
                />
              )}
            </Section>
          ))
        )}
      </List>
    </NavigationStack>
  )
}
