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
  TranslationEngineConfig,
  TranslatorEngineEntry,
} from "../types"
import { isAssistantTranslationAvailable } from "../utils/assistant_translation_engine"
import { isExternalEngineConfigured } from "../utils/external_translation_engines"
import { isLocalTranslationAvailable } from "../utils/translation_engine"
import { isSystemTranslationAvailable } from "../utils/system_translation_engine"
import {
  addAiApiEngine,
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
import { DeepLXEditorView } from "./DeepLXEditorView"

function isEngineEditable(engine: TranslatorEngineEntry) {
  return engine.kind === "ai_api" || engine.kind === "assistant" || engine.kind === "deeplx"
}

function canDeleteEngine(engine: TranslatorEngineEntry) {
  return engine.kind === "ai_api" || engine.kind === "deeplx"
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

  if (engine.kind === "deeplx" || engine.kind === "ai_api") {
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

export function TranslatorSettingsView() {
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
    })
    return true
  })

  function persist(next: ReturnType<typeof loadTranslatorSettings>) {
    skipNextSync.current = true
    setSettings(next)
    engines.setValue(next.engines)
    saveTranslatorSettings(next)
  }

  function persistEngineLabelAndImage(
    nextSettings: ReturnType<typeof loadTranslatorSettings>,
    engineId: string,
    changes: Partial<Pick<TranslatorEngineEntry, "label" | "systemImage">>
  ) {
    persist({
      defaultTargetLanguageCode: nextSettings.defaultTargetLanguageCode,
      defaultSourceLanguageCode: nextSettings.defaultSourceLanguageCode,
      engines: nextSettings.engines.map((item) => (
        item.id === engineId
          ? {
              ...item,
              label: String(changes.label ?? item.label).trim() || item.label,
              systemImage: String(changes.systemImage ?? item.systemImage).trim() || item.systemImage,
            }
          : item
      )),
    })
  }

  async function presentDeepLxEditor(title: string, initial: { baseUrl: string; label: string }) {
    const result = await Navigation.present({
      element: (
        <DeepLXEditorView
          title={title}
          initial={initial}
        />
      ),
    })

    return result as { baseUrl: string; label?: string } | null
  }

  function persistDeepLxResult(
    baseSettings: ReturnType<typeof loadTranslatorSettings>,
    engine: TranslatorEngineEntry,
    result: { baseUrl: string; label?: string }
  ) {
    const nextWithConfig = updateEngineConfig(
      baseSettings,
      engine.id,
      { baseUrl: result.baseUrl } as TranslationEngineConfig
    )
    persistEngineLabelAndImage(nextWithConfig, engine.id, {
      label: String(result.label ?? engine.label).trim() || engine.label,
    })
  }

  async function openCreateAiEngine() {
    const draftSettings = addAiApiEngine(settings)
    const draft = draftSettings.engines[draftSettings.engines.length - 1]
    if (!draft || draft.kind !== "ai_api") return

    const result = await Navigation.present({
      element: (
        <EngineEditorView
          title="添加 AI 接口"
          initial={{
            config: draft.config,
            label: draft.label,
            systemImage: draft.systemImage,
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

    persistEngineLabelAndImage(nextWithConfig, draft.id, {
      label: String(result.label ?? draft.label).trim() || draft.label,
      systemImage: String(result.systemImage ?? draft.systemImage).trim() || draft.systemImage,
    })
  }

  async function openCreateDeepLxEngine() {
    const draftSettings = addDeepLxEngine(settings)
    const draft = draftSettings.engines[draftSettings.engines.length - 1]
    if (!draft || draft.kind !== "deeplx") return

    const result = await presentDeepLxEditor("添加 DeepLX", {
      baseUrl: draft.config?.baseUrl ?? "",
      label: draft.label,
    })
    if (!result) return
    persistDeepLxResult(draftSettings, draft, result)
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
      ) : engine.kind === "deeplx" ? (
        <DeepLXEditorView
          title={`配置 ${engine.label}`}
          initial={{
            baseUrl: engine.config?.baseUrl ?? "",
            label: engine.label,
          }}
        />
      ) : (
        <EngineEditorView
          title={`配置 ${engine.label}`}
          initial={{
            config: engine.config,
            label: engine.label,
            systemImage: engine.systemImage,
          }}
        />
      ),
    })

    if (!result) return

    if (engine.kind === "deeplx") {
      persistDeepLxResult(settings, engine, result as { baseUrl: string; label?: string })
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

    persistEngineLabelAndImage(nextWithConfig, engine.id, {
      label: String(result.label ?? engine.label).trim() || engine.label,
      systemImage: String(result.systemImage ?? engine.systemImage).trim() || engine.systemImage,
    })
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
                  title={engine.label}
                  systemImage={engine.systemImage}
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
                />
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
              title="AI 接口"
              systemImage="sparkles"
              action={() => {
                void openCreateAiEngine()
              }}
            />
            <Button
              title="DeepLX"
              systemImage="d.circle"
              action={() => {
                void openCreateDeepLxEngine()
              }}
            />
          </Menu>
        </Section>
      </List>
    </NavigationStack>
  )
}
