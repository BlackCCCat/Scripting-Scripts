import {
  Button,
  EditButton,
  ForEach,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  Toggle,
  useState,
} from "scripting"

import type {
  TranslationEngineConfig,
  TranslatorEngineEntry,
} from "../types"
import { isExternalEngineConfigured } from "../utils/external_translation_engines"
import { isLocalTranslationAvailable } from "../utils/translation_engine"
import { isSystemTranslationAvailable } from "../utils/system_translation_engine"
import {
  addAiApiEngine,
  addKnownEngine,
  loadTranslatorSettings,
  removeEngine,
  reorderEngines,
  saveTranslatorSettings,
  updateEngineConfig,
  updateEngineEnabled,
} from "../utils/translator_settings"
import { AddEngineView } from "./AddEngineView"
import { EngineEditorView } from "./EngineEditorView"

function isEngineEditable(engine: TranslatorEngineEntry) {
  return engine.kind === "ai_api"
}

function canDeleteEngine(engine: TranslatorEngineEntry) {
  return (
    engine.kind === "google_translate" ||
    engine.kind === "ai_api"
  )
}

function isEngineAvailable(engine: TranslatorEngineEntry) {
  if (engine.kind === "apple_intelligence") {
    return isLocalTranslationAvailable()
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

export function TranslatorSettingsView() {
  const [settings, setSettings] = useState(() => loadTranslatorSettings())

  function persist(next: ReturnType<typeof loadTranslatorSettings>) {
    setSettings(next)
    saveTranslatorSettings(next)
  }

  async function openAddEngine() {
    const selection = await Navigation.present({
      element: <AddEngineView existingKinds={settings.engines.map((item) => item.kind)} />,
    })

    if (selection?.kind === "ai_api") {
      const next = addAiApiEngine(settings)
      persist(next)

      const added = next.engines[next.engines.length - 1]
      if (added?.kind === "ai_api") {
        void openEditEngine(added, next)
      }
      return
    }

    if (
      selection?.kind === "google_translate"
    ) {
      persist(addKnownEngine(settings, selection.kind))
    }
  }

  async function openEditEngine(
    engine: TranslatorEngineEntry,
    baseSettings = settings
  ) {
    if (!isEngineEditable(engine)) return

    const result = await Navigation.present({
      element: (
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

    const nextWithConfig = engine.kind === "ai_api"
      ? updateEngineConfig(baseSettings, engine.id, result.config as TranslationEngineConfig)
      : baseSettings

    persist({
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
        <Section>
          <ForEach
            count={settings.engines.length}
            itemBuilder={(index) => {
              const engine = settings.engines[index]
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
              void openAddEngine()
            }}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}
