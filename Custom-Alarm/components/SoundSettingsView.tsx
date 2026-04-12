import {
  Button,
  ForEach,
  HStack,
  Image,
  List,
  NavigationStack,
  Section,
  Text,
  VStack,
} from "scripting"

function normalizeSoundName(value: string): string {
  return value.trim()
}

export function SoundSettingsView(props: {
  sounds: string[]
  onSave: (sounds: string[]) => void | Promise<void>
}) {
  async function addSound() {
    const input = await Dialog.prompt({
      title: "添加声音",
      placeholder: "例如：Radar、Unfold",
    })
    if (input === null) return

    const name = normalizeSoundName(input)
    if (!name) {
      await Dialog.alert({ message: "请输入声音名称。" })
      return
    }
    if (props.sounds.some((item) => item === name)) {
      await Dialog.alert({ message: "该声音已存在。" })
      return
    }
    const nextSounds = [...props.sounds, name]
    await props.onSave(nextSounds)
  }

  async function removeSound(name: string) {
    const nextSounds = props.sounds.filter((item) => item !== name)
    await props.onSave(nextSounds)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="声音"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{
          topBarTrailing: (
            <Button
              title=""
              systemImage="plus"
              action={() => {
                void addSound()
              }}
            />
          ),
        }}
      >
        <Section footer={<Text>这里维护可用于系统闹钟的声音名称列表。</Text>}>
          {props.sounds.length ? (
            <ForEach
              count={props.sounds.length}
              itemBuilder={(index) => {
                const sound = props.sounds[index]
                if (!sound) return <Text> </Text>
                return (
                  <VStack
                    key={`sound-row-${sound}`}
                    trailingSwipeActions={{
                      allowsFullSwipe: false,
                      actions: [
                        <Button
                          title="删除"
                          role="destructive"
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
                        systemName={sound === "Default" ? "speaker.wave.2.fill" : "music.note"}
                        foregroundStyle={sound === "Default" ? "#FF9500" : "#2563EB"}
                      />
                      <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                        {sound}
                      </Text>
                    </HStack>
                  </VStack>
                )
              }}
            />
          ) : (
            <Text foregroundStyle="secondaryLabel">暂无声音，请点右上角添加。</Text>
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}
