import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
  useState,
} from "scripting"

import type { ManagerSettings } from "../types"
import { WIDGET_REFRESH_HOUR_OPTIONS, normalizeWidgetRefreshHours } from "../utils/common"

function CenterRowButton(props: {
  title: string
  role?: "cancel" | "destructive"
  onPress: () => void | Promise<void>
}) {
  return (
    <Button
      buttonStyle="plain"
      role={props.role}
      frame={{ maxWidth: "infinity" }}
      action={() => {
        try { (globalThis as any).HapticFeedback?.mediumImpact?.() } catch {}
        void props.onPress()
      }}
    >
      <HStack
        frame={{ width: "100%" as any }}
        padding={{ top: 14, bottom: 14 }}
        background={"rgba(0,0,0,0.001)"}
      >
        <Text opacity={0} frame={{ width: 1 }}>
          .
        </Text>
        <Spacer />
        <Text font="headline">{props.title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}

export function SettingsView(props: {
  initial: ManagerSettings
}) {
  const dismiss = Navigation.useDismiss()
  const [autoCheckOnLaunch, setAutoCheckOnLaunch] = useState(
    Boolean(props.initial.autoCheckOnLaunch)
  )
  const [autoCheckOnAdd, setAutoCheckOnAdd] = useState(
    Boolean(props.initial.autoCheckOnAdd)
  )
  const [refreshIndex, setRefreshIndex] = useState(
    Math.max(
      0,
      WIDGET_REFRESH_HOUR_OPTIONS.findIndex(
        (hours) => hours === normalizeWidgetRefreshHours(props.initial.widgetRefreshHours)
      )
    )
  )

  async function onSave() {
    dismiss({
      autoCheckOnLaunch,
      autoCheckOnAdd,
      widgetRefreshHours: WIDGET_REFRESH_HOUR_OPTIONS[refreshIndex] ?? 3,
    } satisfies ManagerSettings)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
      >
        <Section header={<Text>检测</Text>}>
          <Toggle
            value={autoCheckOnLaunch}
            onChanged={setAutoCheckOnLaunch}
            toggleStyle="switch"
          >
            <HStack frame={{ width: "100%" as any }} spacing={8}>
              <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={4}>
                <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>运行时自动检测</Text>
              </VStack>
              <Spacer />
            </HStack>
          </Toggle>
          <Toggle
            value={autoCheckOnAdd}
            onChanged={setAutoCheckOnAdd}
            toggleStyle="switch"
          >
            <HStack frame={{ width: "100%" as any }} spacing={8}>
              <VStack frame={{ maxWidth: "infinity", alignment: "topLeading" as any }} spacing={4}>
                <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>新增后自动检测</Text>
              </VStack>
              <Spacer />
            </HStack>
          </Toggle>
        </Section>

        <Section header={<Text>小组件</Text>}>
          <Picker
            title="自动刷新间隔"
            pickerStyle="menu"
            value={refreshIndex}
            onChanged={(index: number) => setRefreshIndex(index)}
          >
            {WIDGET_REFRESH_HOUR_OPTIONS.map((hours, index) => (
              <Text key={hours} tag={index}>
                {hours} 小时
              </Text>
            ))}
          </Picker>
        </Section>

        <Section>
          <CenterRowButton title="保存" onPress={onSave} />
          <CenterRowButton title="取消" role="cancel" onPress={() => dismiss()} />
        </Section>
      </Form>
    </NavigationStack>
  )
}
