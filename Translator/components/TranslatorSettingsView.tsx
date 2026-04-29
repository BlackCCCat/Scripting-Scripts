import {
  Button,
  EditButton,
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

import { LANGUAGE_OPTIONS } from "../constants"
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
  loadTranslatorSettings,
  removeEngine,
  reorderEngines,
  saveTranslatorSettings,
  updateEngineConfig,
  updateDefaultTargetLanguage,
  updateEngineEnabled,
} from "../utils/translator_settings"
import { AssistantEngineEditorView } from "./AssistantEngineEditorView"
import { EngineEditorView } from "./EngineEditorView"

function isEngineEditable(engine: TranslatorEngineEntry) {
  return engine.kind === "ai_api" || engine.kind === "assistant"
}

function canDeleteEngine(engine: TranslatorEngineEntry) {
  return engine.kind === "ai_api"
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

  if (engine.kind === "ai_api") {
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

export function TranslatorSettingsView() {
  const [settings, setSettings] = useState(() => loadTranslatorSettings())
  const engines = useObservable<TranslatorEngineEntry[]>(() => loadTranslatorSettings().engines)

  function persist(next: ReturnType<typeof loadTranslatorSettings>) {
    setSettings(next)
    engines.setValue(next.engines)
    saveTranslatorSettings(next)
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

    persist({
      defaultTargetLanguageCode: nextWithConfig.defaultTargetLanguageCode,
      engines: nextWithConfig.engines.map((item) => (
        item.id === draft.id
          ? {
              ...item,
              label: String(result.label ?? item.label).trim() || item.label,
              systemImage: String(result.systemImage ?? item.systemImage).trim() || item.systemImage,
            }
          : item
      )),
    })
  }

  async function openEditEngine(
    engine: TranslatorEngineEntry,
    baseSettings = settings
  ) {
    if (!isEngineEditable(engine)) return

    const result = await Navigation.present({
      element: engine.kind === "assistant" ? (
        <AssistantEngineEditorView
          title={`配置 ${engine.label}`}
          initial={engine.config}
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

    const nextWithConfig = (engine.kind === "ai_api" || engine.kind === "assistant")
      ? updateEngineConfig(
          baseSettings,
          engine.id,
          (engine.kind === "assistant" ? result : result.config) as TranslationEngineConfig
        )
      : baseSettings

    if (engine.kind === "assistant") {
      persist(nextWithConfig)
      return
    }

    persist({
      defaultTargetLanguageCode: nextWithConfig.defaultTargetLanguageCode,
      engines: nextWithConfig.engines.map((item) => (
        item.id === engine.id
          ? {
              ...item,
              label: String(result.label ?? item.label).trim() || item.label,
              systemImage: String(result.systemImage ?? item.systemImage).trim() || item.systemImage,
            }
          : item
      )),
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
        toolbar={{
          confirmationAction: [
            <EditButton />,
          ],
        }}
      >
        <Section header={<Text>翻译设置</Text>}>
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

        <Section>
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
          <Button
            title="添加引擎"
            systemImage="plus"
            action={() => {
              void openCreateAiEngine()
            }}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}
