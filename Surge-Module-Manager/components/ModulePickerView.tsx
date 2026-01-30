import {
  Button,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  Toggle,
  VStack,
  HStack,
  Spacer,
  useState,
} from "scripting"

import type { ModuleInfo } from "../utils/storage"

export function ModulePickerView(props: {
  title: string
  modules: ModuleInfo[]
  initialSelected?: string[]
}) {
  const dismiss = Navigation.useDismiss()
  const init = new Set(props.initialSelected ?? [])
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {}
    for (const m of props.modules) {
      map[m.name] = init.has(m.name)
    }
    return map
  })

  function toggle(name: string, value: boolean) {
    setSelected((prev) => ({ ...prev, [name]: value }))
  }

  function done() {
    const picked = props.modules.filter((m) => selected[m.name])
    dismiss(picked)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={props.title}
        navigationBarTitleDisplayMode={"inline"}
        listStyle={"insetGroup"}
        toolbar={{
          topBarTrailing: <Button title="完成" action={done} />,
        }}
      >
        <Section header={<Text>模块列表</Text>}>
          {props.modules.map((m) => (
            <Toggle
              key={m.name}
              value={!!selected[m.name]}
              onChanged={(v: boolean) => toggle(m.name, v)}
            >
              {(
                <VStack>
                  <HStack>
                    <Text font="headline">{m.name}</Text>
                    <Spacer />
                    {m.category ? <Text>{m.category}</Text> : null}
                  </HStack>
                </VStack>
              )}
            </Toggle>
          ))}
        </Section>
      </List>
    </NavigationStack>
  )
}
