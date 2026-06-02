import {
  Button,
  Form,
  Navigation,
  NavigationStack,
  Section,
  Text,
  useEffect,
  useState,
} from "scripting"

import {
  soundDisplayName,
  soundsDirectoryPath,
} from "../utils/alarm_sounds"

export function SoundSettingsView(props: {
  sounds: string[]
  onRefresh: () => Promise<string[]>
}) {
  const dismiss = Navigation.useDismiss()
  const [sounds, setSounds] = useState<string[]>(props.sounds)

  async function refreshSounds() {
    const nextSounds = await props.onRefresh()
    setSounds(nextSounds)
  }

  useEffect(() => {
    void refreshSounds()
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
              action={() => dismiss()}
            />
          ),
          topBarTrailing: (
            <Button
              title=""
              systemImage="arrow.clockwise"
              action={() => {
                void refreshSounds()
              }}
            />
          ),
        }}
      >
        <Section
          header={<Text>可用声音</Text>}
          footer={<Text>{soundsDirectoryPath()}</Text>}
        >
          {sounds.map((sound) => (
            <Text key={sound}>{soundDisplayName(sound)}</Text>
          ))}
        </Section>
      </Form>
    </NavigationStack>
  )
}
