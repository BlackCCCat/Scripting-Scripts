import {
  Button,
  Form,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  Path,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useRef,
  useState,
} from "scripting"

import {
  DEFAULT_SOUND_NAME,
  deleteSoundFile,
  importSoundFile,
  renameSoundFile,
  soundDisplayName,
  soundFilePath,
  soundSymbolName,
  soundsDirectoryPath,
} from "../utils/alarm_sounds"

export function SoundSettingsView(props: {
  sounds: string[]
  onRefresh: () => Promise<string[]>
  onSoundDeleted?: (sound: string) => void
  onSoundRenamed?: (oldSound: string, newSound: string) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [sounds, setSounds] = useState<string[]>(props.sounds)
  const [playingSound, setPlayingSound] = useState<string | null>(null)
  const playingSoundRef = useRef<string | null>(null)
  const [player] = useState(() => new AVPlayer())
  const visibleSounds = sounds.filter((sound) => sound !== DEFAULT_SOUND_NAME)

  function updatePlayingSound(sound: string | null) {
    playingSoundRef.current = sound
    setPlayingSound(sound)
  }

  function stopPreview() {
    player.stop()
    updatePlayingSound(null)
  }

  function togglePreview(sound: string) {
    if (playingSoundRef.current === sound) {
      stopPreview()
      return
    }

    player.stop()
    updatePlayingSound(sound)
    player.onReadyToPlay = () => {
      if (playingSoundRef.current !== sound) return
      if (!player.play()) {
        updatePlayingSound(null)
        void Dialog.alert({ message: "无法播放该声音文件。" })
      }
    }

    if (!player.setSource(soundFilePath(sound))) {
      updatePlayingSound(null)
      void Dialog.alert({ message: "无法读取该声音文件。" })
    }
  }

  async function refreshSounds() {
    const nextSounds = await props.onRefresh()
    setSounds(nextSounds)
  }

  async function importSounds() {
    const filePaths = await DocumentPicker.pickFiles({
      types: ["public.audio"],
    })
    if (!filePaths.length) return

    for (const filePath of filePaths) {
      const fileName = Path.basename(filePath)
      try {
        await importSoundFile(filePath)
      } catch (error: any) {
        if (String(error?.message ?? error) !== "声音文件已存在。") {
          await Dialog.alert({ message: String(error?.message ?? error) })
          continue
        }

        const shouldOverwrite = await Dialog.confirm({
          title: "替换声音",
          message: `“${fileName}”已存在，是否替换？`,
        })
        if (shouldOverwrite) {
          try {
            await importSoundFile(filePath, { overwrite: true })
          } catch (overwriteError: any) {
            await Dialog.alert({ message: String(overwriteError?.message ?? overwriteError) })
          }
        }
      }
    }

    await refreshSounds()
  }

  async function editSound(sound: string) {
    const nextName = await Dialog.prompt({
      title: "编辑声音名称",
      defaultValue: soundDisplayName(sound),
      placeholder: "声音名称",
      selectAll: true,
      cancelLabel: "取消",
      confirmLabel: "保存",
    })
    if (nextName == null) return

    try {
      if (playingSoundRef.current === sound) stopPreview()
      const renamedSound = await renameSoundFile(sound, nextName)
      if (renamedSound !== sound) {
        setSounds((current) => current.map((item) => (item === sound ? renamedSound : item)))
        props.onSoundRenamed?.(sound, renamedSound)
      }
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
    }
  }

  async function removeSound(sound: string) {
    const ok = await Dialog.confirm({
      title: "删除声音",
      message: `确定要删除“${soundDisplayName(sound)}”吗？`,
    })
    if (!ok) return

    try {
      if (playingSoundRef.current === sound) stopPreview()
      await deleteSoundFile(sound)
      setSounds((current) => current.filter((item) => item !== sound))
      props.onSoundDeleted?.(sound)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error) })
    }
  }

  useEffect(() => {
    player.onEnded = () => updatePlayingSound(null)
    player.onError = (message: string) => {
      updatePlayingSound(null)
      void Dialog.alert({ message: message || "声音播放失败。" })
    }
    void refreshSounds()
    return () => {
      player.stop()
      player.dispose()
      playingSoundRef.current = null
    }
  }, [])

  return (
    <NavigationStack>
      <Form
        navigationTitle="闹钟声音"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        toolbar={{
          topBarLeading: (
            <Button
              title=""
              systemImage="xmark"
              action={() => {
                stopPreview()
                dismiss()
              }}
            />
          ),
          topBarTrailing: (
            <Button
              title=""
              systemImage="plus"
              action={() => {
                void importSounds()
              }}
            />
          ),
        }}
      >
        <Section
          header={<Text>可用声音</Text>}
          footer={<Text>{soundsDirectoryPath()}</Text>}
        >
          {visibleSounds.length ? (
            visibleSounds.map((sound) => (
              <VStack
                key={sound}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button
                      title="编辑"
                      tint="systemOrange"
                      action={() => {
                        void editSound(sound)
                      }}
                    />,
                    <Button
                      title="删除"
                      tint="red"
                      action={() => {
                        void removeSound(sound)
                      }}
                    />,
                  ],
                }}
              >
                <HStack spacing={12}>
                  <Image
                    systemName={soundSymbolName(sound)}
                    foregroundStyle={"#F59E0B" as any}
                    frame={{ width: 20, alignment: "center" as any }}
                  />
                  <Text>{soundDisplayName(sound)}</Text>
                  <Spacer />
                  <Text foregroundStyle="secondaryLabel">{Path.extname(sound).toUpperCase().replace(".", "")}</Text>
                  <Button
                    title=""
                    systemImage={playingSound === sound ? "stop.circle.fill" : "play.circle.fill"}
                    buttonStyle="plain"
                    tint={playingSound === sound ? "systemRed" : "accentColor"}
                    action={() => togglePreview(sound)}
                  />
                </HStack>
              </VStack>
            ))
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无自定义声音</Text>
          )}
        </Section>
      </Form>
    </NavigationStack>
  )
}
