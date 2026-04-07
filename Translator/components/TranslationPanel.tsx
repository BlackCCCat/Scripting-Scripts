import {
  Button,
  Group,
  HStack,
  Image,
  Menu,
  List,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
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
import { finishTranslation } from "../utils/translation_session"
import {
  getExecutableEngines,
  loadTranslatorSettings,
} from "../utils/translator_settings"

type TranslationPanelProps = {
  inputText: string | null
  allowsReplacement: boolean
}

function withHaptic(action: () => void | Promise<void>) {
  return () => {
    try {
      HapticFeedback.lightImpact()
    } catch {}
    void action()
  }
}

function pickerLabel(option: LanguageOption) {
  if (option.code === AUTO_LANGUAGE.code) {
    return "自动检测-Auto"
  }

  return `${option.label}-${option.promptName}`
}

function LanguageMenu(props: {
  title: string
  value: string
  selectedLabel: string
  onChanged: (value: string) => void
  options: LanguageOption[]
}) {
  return (
    <Menu
      label={
        <HStack spacing={4}>
          <Text
            font="subheadline"
            foregroundStyle="secondaryLabel"
            lineLimit={1}
            truncationMode="tail"
            allowsTightening
            frame={{ maxWidth: 150, alignment: "trailing" as any }}
            multilineTextAlignment="trailing"
          >
            {props.selectedLabel}
          </Text>
          <Image
            systemName="chevron.down"
            font="caption2"
            foregroundStyle="tertiaryLabel"
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
  canReplace?: boolean
  onTapWhenEmpty?: () => void | Promise<void>
  onRetranslate?: () => void | Promise<void>
  onReplace?: () => void | Promise<void>
}) {
  const hasText = props.text.trim().length > 0
  const hasMenu = hasText || !!props.onRetranslate || (!!props.onReplace && !!props.canReplace)
  const copyAction = withHaptic(async () => {
    if (!hasText) return
    await Pasteboard.setString(props.text)
    try {
      HapticFeedback.notificationSuccess()
    } catch {}
  })
  const emptyTapAction = props.onTapWhenEmpty ? withHaptic(props.onTapWhenEmpty) : undefined

  return (
    <Text
      onTapGesture={hasText ? copyAction : emptyTapAction}
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
            {props.onReplace ? (
              <Button
                title="替换原文"
                systemImage="rectangle.and.pencil.and.ellipsis"
                disabled={!props.canReplace}
                action={withHaptic(props.onReplace)}
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
      multilineTextAlignment="leading"
      selectionDisabled={false}
      foregroundStyle={props.foregroundStyle}
    >
      {hasText ? props.text : (props.emptyText || "")}
    </Text>
  )
}

export function TranslationPanel(props: TranslationPanelProps) {
  const sourceText = props.inputText ?? ""
  const hasInput = sourceText.trim().length > 0
  const [sourceLanguageCode, setSourceLanguageCode] = useState(AUTO_LANGUAGE.code)
  const [targetLanguageCode, setTargetLanguageCode] = useState("zh-Hans")
  const [settings] = useState(() => loadTranslatorSettings())
  const [systemTranslationHost] = useState(() => new Translation())
  const [errorText, setErrorText] = useState("")
  const [engineResults, setEngineResults] = useState<EngineTranslationState[]>([])
  const requestIdRef = useRef(0)
  const sourceFingerprintRef = useRef("")
  const targetTouchedRef = useRef(false)
  const [appleEngine] = useState(() => createTranslationEngine())
  const [assistantEngine] = useState(() => createAssistantTranslationEngine())
  const [systemEngine] = useState(() => createSystemTranslationEngine(systemTranslationHost))

  const executableEngines = getExecutableEngines(settings)
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
        ? await assistantEngine.translate(request)
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

  const runTranslation = useEffectEvent(async () => {
    if (!hasInput) return

    if (!visibleEngines.length) {
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
    setErrorText("")
    setEngineResults(createLoadingStates())

    try {
      // 这里逐条回填每个引擎的状态，不再在最后整体覆盖，避免未完成项丢掉自己的加载态。
      await Promise.allSettled(
        visibleEngines.map(async (engine) => {
          try {
            const result = await translateEngine(engine)
            if (requestId !== requestIdRef.current) return null

            setEngineResults((current) => current.map((item) => (
              item.engineId === engine.id ? result : item
            )))
            return result
          } catch (error) {
            if (requestId !== requestIdRef.current) return null

            const failed = {
              engineId: engine.id,
              engineName: engine.label,
              systemImage: engine.systemImage,
              translatedText: "",
              errorText: error instanceof Error ? error.message : String(error),
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
      try {
        HapticFeedback.notificationSuccess()
      } catch {}
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      setErrorText(error instanceof Error ? error.message : String(error))
      try {
        HapticFeedback.notificationError()
      } catch {}
    }
  })

  useEffect(() => {
    if (!hasInput) return
    void runTranslation()
  }, [hasInput, runTranslation, sourceLanguageCode, sourceText, targetLanguageCode])

  useEffect(() => {
    const fingerprint = sourceText.trim()
    if (fingerprint !== sourceFingerprintRef.current) {
      sourceFingerprintRef.current = fingerprint
      targetTouchedRef.current = false
    }
  }, [sourceText])

  useEffect(() => {
    if (!hasInput) return
    if (sourceLanguageCode !== AUTO_LANGUAGE.code) return
    if (targetTouchedRef.current) return

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
  }, [hasInput, sourceLanguageCode, sourceText, targetLanguageCode])

  const selectSourceLanguage = useEffectEvent((code: string) => {
    setSourceLanguageCode(code)
    setErrorText("")
  })

  const selectTargetLanguage = useEffectEvent((code: string) => {
    targetTouchedRef.current = true
    setTargetLanguageCode(code)
    setErrorText("")
  })

  const useTranslation = useEffectEvent(async (translatedText: string) => {
    if (!translatedText || !props.allowsReplacement) return
    finishTranslation(translatedText)
  })

  const rerunAllTranslations = useEffectEvent(async () => {
    await runTranslation()
  })

  const rerunSingleEngine = useEffectEvent(async (engineId: string) => {
    const engine = visibleEngines.find((item) => item.id === engineId)
    if (!engine || !hasInput) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
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

      setEngineResults((current) => current.map((item) => (
        item.engineId === engineId ? result : item
      )))
      try {
        HapticFeedback.notificationSuccess()
      } catch {}
    } catch (error) {
      if (requestId !== requestIdRef.current) return

      setEngineResults((current) => current.map((item) => (
        item.engineId === engineId
          ? {
              ...item,
              translatedText: "",
              errorText: error instanceof Error ? error.message : String(error),
              isTranslating: false,
            }
          : item
      )))
      try {
        HapticFeedback.notificationError()
      } catch {}
    }
  })

  if (!hasInput) {
    return (
      <List
        listStyle="insetGroup"
        scrollContentBackground="hidden"
        contentMargins={{
          edges: "top",
          insets: 0,
          placement: "scrollContent",
        }}
        presentationDetents={["medium", "large"]}
        presentationDragIndicator="visible"
        presentationContentInteraction="resizes"
        translationHost={systemTranslationHost}
      >
        <Section>
          <Text foregroundStyle="secondaryLabel">
            当前宿主没有传入可供翻译的文本。
          </Text>
        </Section>
      </List>
    )
  }

  return (
    <List
      listStyle="insetGroup"
      scrollContentBackground="hidden"
      contentMargins={{
        edges: "top",
        insets: 0,
        placement: "scrollContent",
      }}
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
      presentationContentInteraction="resizes"
      translationHost={systemTranslationHost}
    >
      <Section>
        <HStack spacing={10}>
          <Image
            systemName="doc.text"
            font="subheadline"
            foregroundStyle="systemBlue"
          />
          <Text font="headline">原文</Text>
          <Spacer />
          <LanguageMenu
            title="源语言"
            value={sourceLanguageCode}
            selectedLabel={sourceLanguageCode === AUTO_LANGUAGE.code
              ? pickerLabel(AUTO_LANGUAGE)
              : pickerLabel([AUTO_LANGUAGE, ...LANGUAGE_OPTIONS].find((option) => option.code === sourceLanguageCode) ?? AUTO_LANGUAGE)}
            onChanged={selectSourceLanguage}
            options={[AUTO_LANGUAGE, ...LANGUAGE_OPTIONS]}
          />
        </HStack>
        <CopyableTextRow text={sourceText} />
      </Section>

      <Section>
        <HStack spacing={10}>
          <Image
            systemName="text.bubble"
            font="subheadline"
            foregroundStyle="systemBlue"
          />
          <Text font="headline">译文</Text>
          <Spacer />
          <LanguageMenu
            title="目标语言"
            value={targetLanguageCode}
            selectedLabel={pickerLabel(LANGUAGE_OPTIONS.find((option) => option.code === targetLanguageCode) ?? LANGUAGE_OPTIONS[0])}
            onChanged={selectTargetLanguage}
            options={LANGUAGE_OPTIONS}
          />
        </HStack>
      </Section>

      {visibleEngines.length === 0 ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">
            {errorText || "没有启用且可用的翻译引擎。"}
          </Text>
        </Section>
      ) : (
        engineResults.map((result) => (
          <Section
            key={result.engineId}
            header={
              <HStack spacing={8}>
                <Image
                  systemName={result.systemImage}
                  font="caption"
                  foregroundStyle="secondaryLabel"
                />
                <Text
                  font="subheadline"
                  foregroundStyle="secondaryLabel"
                >
                  {result.engineName}
                </Text>
              </HStack>
            }
          >
            {result.isTranslating ? (
              <VStack spacing={10} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
                <ProgressView />
              </VStack>
            ) : result.translatedText ? (
              <CopyableTextRow
                text={result.translatedText}
                canReplace={props.allowsReplacement}
                onRetranslate={rerunAllTranslations}
                onReplace={() => useTranslation(result.translatedText)}
              />
            ) : (
              <CopyableTextRow
                text=""
                emptyText={result.errorText || errorText || "暂无译文"}
                foregroundStyle={(result.errorText || errorText) ? "systemRed" : "secondaryLabel"}
                onTapWhenEmpty={() => rerunSingleEngine(result.engineId)}
                onRetranslate={rerunAllTranslations}
              />
            )}
          </Section>
        ))
      )}
    </List>
  )
}
