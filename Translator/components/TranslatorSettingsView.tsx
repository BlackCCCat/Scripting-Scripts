import {
  Button,
  ForEach,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  Toggle,
  useObservable,
  useState,
} from "scripting"

import { AUTO_LANGUAGE, LANGUAGE_OPTIONS } from "../constants"
import type {
  AiApiCompatibilityMode,
  TranslationEngineConfig,
  TranslatorEngineEntry,
} from "../types"
import { isAssistantTranslationAvailable } from "../utils/assistant_translation_engine"
import { AI_PROVIDERS } from "../utils/ai_providers"
import { isExternalEngineConfigured } from "../utils/external_translation_engines"
import { isLocalTranslationAvailable } from "../utils/translation_engine"
import { isSystemTranslationAvailable } from "../utils/system_translation_engine"
import {
  addAiApiEngine,
  addDeepLEngine,
  addDeepLxEngine,
  loadTranslatorSettings,
  removeEngine,
  reorderEngines,
  saveTranslatorSettings,
  updateEngineConfig,
  updateDefaultSourceLanguage,
  updateDefaultTargetLanguage,
  updateEngineEnabled,
} from "../utils/translator_settings"
import { AssistantEngineEditorView } from "./AssistantEngineEditorView"
import { EngineEditorView } from "./EngineEditorView"
import { DeepLServiceEditorView } from "./DeepLServiceEditorView"
import { EngineIcon } from "./EngineIcon"

function isEngineEditable(engine: TranslatorEngineEntry) {
  return engine.kind === "ai_api" || engine.kind === "assistant" || engine.kind === "deeplx" || engine.kind === "deepl"
}

function canDeleteEngine(engine: TranslatorEngineEntry) {
  return engine.kind === "ai_api" || engine.kind === "deeplx" || engine.kind === "deepl"
}

function isEngineAvailable(engine: TranslatorEngineEntry) {
  if (engine.kind === "apple_intelligence") {
    return isLocalTranslationAvailable()
  }

  if (engine.kind === "assistant") {
    return isAssistantTranslationAvailable()
  }

  if (engine.kind === "system_translation") {
    return isSystemTranslationAvailable()
  }

  if (
    engine.kind === "google_translate"
  ) {
    return true
  }

  if (engine.kind === "deeplx" || engine.kind === "deepl" || engine.kind === "ai_api") {
    return isExternalEngineConfigured(engine)
  }

  return false
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

export function TranslatorSettingsView(props: {
  onSettingsChanged?: () => void
}) {
  const dismiss = Navigation.useDismiss()
  const [settings, setSettings] = useState(() => loadTranslatorSettings())
  const engines = useObservable<TranslatorEngineEntry[]>(() => loadTranslatorSettings().engines)
  const editMode = useObservable(() => EditMode.inactive())
  const [isEditing, setIsEditing] = useState(false)
  const [skipNextSync] = useState(() => ({ current: false }))

  // When ForEach with editActions="move" auto-updates the observable on drag reorder,
  // the onMove callback is NOT invoked. Subscribe to persist the new order.
  useState(() => {
    engines.subscribe((nextEngines) => {
      if (skipNextSync.current) {
        skipNextSync.current = false
        return
      }
      const merged = { ...loadTranslatorSettings(), engines: nextEngines }
      setSettings(merged)
      saveTranslatorSettings(merged)
      props.onSettingsChanged?.()
    })
    return true
  })

  function persist(next: ReturnType<typeof loadTranslatorSettings>) {
    skipNextSync.current = true
    setSettings(next)
    engines.setValue(next.engines)
    saveTranslatorSettings(next)
    props.onSettingsChanged?.()
  }

  function persistEngineLabel(
    nextSettings: ReturnType<typeof loadTranslatorSettings>,
    engineId: string,
    label: string
  ) {
    persist({
      defaultTargetLanguageCode: nextSettings.defaultTargetLanguageCode,
      defaultSourceLanguageCode: nextSettings.defaultSourceLanguageCode,
      engines: nextSettings.engines.map((item) => (
        item.id === engineId
          ? {
              ...item,
              label: String(label).trim() || item.label,
            }
          : item
      )),
    })
  }

  async function presentDeepLServiceEditor(title: string, kind: "deeplx" | "deepl", initial: { baseUrl: string; label: string; apiKey?: string }) {
    const result = await Navigation.present({
      element: (
        <DeepLServiceEditorView
          title={title}
          kind={kind}
          initial={initial}
        />
      ),
    })

    return result as { baseUrl: string; label?: string; apiKey?: string } | null
  }

  function persistDeepLServiceResult(
    baseSettings: ReturnType<typeof loadTranslatorSettings>,
    engine: TranslatorEngineEntry,
    result: { baseUrl: string; label?: string; apiKey?: string }
  ) {
    const nextWithConfig = updateEngineConfig(
      baseSettings,
      engine.id,
      { baseUrl: result.baseUrl, ...(engine.kind === "deepl" ? { apiKey: result.apiKey } : {}) } as TranslationEngineConfig
    )
    persistEngineLabel(nextWithConfig, engine.id, String(result.label ?? engine.label))
  }

  async function openCreateAiEngine(mode: AiApiCompatibilityMode) {
    const draftSettings = addAiApiEngine(settings, mode)
    const draft = draftSettings.engines[draftSettings.engines.length - 1]
    if (!draft || draft.kind !== "ai_api") return

    const result = await Navigation.present({
      element: (
        <EngineEditorView
          title={`添加 ${draft.label}`}
          initial={{
            config: draft.config,
            label: draft.label,
          }}
        />
      ),
    })

    if (!result) return

    const nextWithConfig = updateEngineConfig(
      draftSettings,
      draft.id,
      result.config as TranslationEngineConfig
    )

    persistEngineLabel(nextWithConfig, draft.id, String(result.label ?? draft.label))
  }

  async function openCreateDeepLxEngine() {
    const draftSettings = addDeepLxEngine(settings)
    const draft = draftSettings.engines[draftSettings.engines.length - 1]
    if (!draft || draft.kind !== "deeplx") return

    const result = await presentDeepLServiceEditor("添加 DeepLX", "deeplx", {
      baseUrl: draft.config?.baseUrl ?? "",
      label: draft.label,
    })
    if (!result) return
    persistDeepLServiceResult(draftSettings, draft, result)
  }

  async function openCreateDeepLEngine() {
    const draftSettings = addDeepLEngine(settings)
    const draft = draftSettings.engines[draftSettings.engines.length - 1]
    if (!draft || draft.kind !== "deepl") return
    const result = await presentDeepLServiceEditor("添加 DeepL", "deepl", {
      baseUrl: draft.config?.baseUrl ?? "",
      apiKey: draft.config?.apiKey,
      label: draft.label,
    })
    if (result) persistDeepLServiceResult(draftSettings, draft, result)
  }

  async function openEditEngine(
    engine: TranslatorEngineEntry
  ) {
    if (!isEngineEditable(engine)) return

    const result = await Navigation.present({
      element: engine.kind === "assistant" ? (
        <AssistantEngineEditorView
          title={`配置 ${engine.label}`}
          initial={engine.config}
        />
      ) : engine.kind === "deeplx" || engine.kind === "deepl" ? (
        <DeepLServiceEditorView
          title={`配置 ${engine.label}`}
          kind={engine.kind}
          initial={{
            baseUrl: engine.config?.baseUrl ?? "",
            apiKey: engine.config?.apiKey,
            label: engine.label,
          }}
        />
      ) : (
        <EngineEditorView
          title={`配置 ${engine.label}`}
          initial={{
            config: engine.config,
            label: engine.label,
          }}
        />
      ),
    })

    if (!result) return

    if (engine.kind === "deeplx" || engine.kind === "deepl") {
      persistDeepLServiceResult(settings, engine, result as { baseUrl: string; label?: string; apiKey?: string })
      return
    }

    const nextWithConfig = (engine.kind === "ai_api" || engine.kind === "assistant")
      ? updateEngineConfig(
          settings,
          engine.id,
          (engine.kind === "assistant" ? result : result.config) as TranslationEngineConfig
        )
      : settings

    if (engine.kind === "assistant") {
      persist(nextWithConfig)
      return
    }

    persistEngineLabel(nextWithConfig, engine.id, String(result.label ?? engine.label))
  }

  async function deleteEngine(engine: TranslatorEngineEntry) {
    if (!canDeleteEngine(engine)) return

    const confirmed = await Dialog.confirm({
      title: "删除引擎",
      message: `确定删除“${engine.label}”吗？`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })

    if (!confirmed) return

    persist(removeEngine(settings, engine.id))
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="翻译器"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        environments={{
          editMode,
        }}
        toolbar={{
          topBarLeading: (
            <Button action={() => dismiss()}>
            <Image systemName="xmark" fontWeight="semibold" foregroundStyle="red"/>
            </Button>
          ),
          confirmationAction: [
            <Button
              title={isEditing ? "完成" : "编辑"}
              fontWeight="semibold"
              foregroundStyle="#007AFF"
              action={() => {
                const nextIsEditing = !isEditing
                setIsEditing(nextIsEditing)
                editMode.setValue(nextIsEditing ? EditMode.active() : EditMode.inactive())
              }}
            />,
          ],
        }}
      >
        <Section header={<Text>翻译设置</Text>}>
          <HStack spacing={12}>
            <Text>默认源语言</Text>
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
                    {sourceLanguageLabel(settings.defaultSourceLanguageCode)}
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
                title="默认源语言"
                value={settings.defaultSourceLanguageCode}
                onChanged={(value: string) => {
                  persist(updateDefaultSourceLanguage(settings, value))
                }}
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
            <Text>默认目标语言</Text>
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
                    {targetLanguageLabel(settings.defaultTargetLanguageCode)}
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
                title="默认目标语言"
                value={settings.defaultTargetLanguageCode}
                onChanged={(value: string) => {
                  persist(updateDefaultTargetLanguage(settings, value))
                }}
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

        <Section header={<Text>翻译引擎</Text>}>
          <ForEach
            data={engines}
            builder={(engine: TranslatorEngineEntry) => {
              const available = isEngineAvailable(engine)

              return (
                <Toggle
                  key={engine.id}
                  value={engine.enabled && available}
                  disabled={!available}
                  onChanged={(value: boolean) => {
                    persist(updateEngineEnabled(settings, engine.id, value))
                  }}
                  trailingSwipeActions={canDeleteEngine(engine) || isEngineEditable(engine) ? {
                    allowsFullSwipe: false,
                    actions: [
                      ...(isEngineEditable(engine) ? [
                        <Button
                          title="编辑"
                          systemImage="square.and.pencil"
                          tint="systemBlue"
                          action={() => {
                            void openEditEngine(engine)
                          }}
                        />,
                      ] : []),
                      ...(canDeleteEngine(engine) ? [
                        <Button
                          title="删除"
                          systemImage="trash"
                          role="destructive"
                          action={() => {
                            void deleteEngine(engine)
                          }}
                        />,
                      ] : []),
                    ],
                  } : undefined}
                >
                  <HStack spacing={10}>
                    <EngineIcon kind={engine.kind} mode={engine.config?.compatibilityMode} size={22} />
                    <Text lineLimit={1} truncationMode="tail">{engine.label}</Text>
                  </HStack>
                </Toggle>
              )
            }}
            editActions="move"
            onMove={(indices, newOffset) => {
              persist(reorderEngines(settings, indices, newOffset))
            }}
          />
        </Section>

        <Section>
          <Menu
            label={
              <HStack
                spacing={4}
                frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
                contentShape={{
                  kind: "interaction",
                  shape: "rect",
                }}
              >
                <Image
                  systemName="plus"
                  foregroundStyle="accentColor"
                  fontWeight="semibold"
                />
                <Text 
                  foregroundStyle="accentColor" 
                  fontWeight="semibold">
                  添加引擎
                </Text>
              </HStack>
            }
          >
            <Button
              action={() => {
                void openCreateDeepLEngine()
              }}
            >
              <HStack spacing={8}><EngineIcon kind="deepl" size={18} /><Text>DeepL</Text></HStack>
            </Button>
            <Button
              action={() => {
                void openCreateDeepLxEngine()
              }}
            >
              <HStack spacing={8}><EngineIcon kind="deeplx" size={18} /><Text>DeepLX</Text></HStack>
            </Button>
            {AI_PROVIDERS.map((provider) => (
              <Button key={provider.mode} action={() => { void openCreateAiEngine(provider.mode) }}>
                <HStack spacing={8}>
                  <EngineIcon kind="ai_api" mode={provider.mode} size={18} />
                  <Text>{provider.label}</Text>
                </HStack>
              </Button>
            ))}
          </Menu>
        </Section>
      </List>
    </NavigationStack>
  )
}
