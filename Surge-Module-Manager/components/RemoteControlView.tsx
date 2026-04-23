import {
  Button,
  Form,
  HStack,
  Navigation,
  NavigationStack,
  Section,
  SecureField,
  Text,
  TextField,
  VStack,
  useState,
} from "scripting"

import { loadConfig, saveConfig, type AppConfig } from "../utils/config"

export function RemoteControlView(props: {
  initial?: AppConfig
  onDone?: (cfg: AppConfig) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [cfg, setCfg] = useState<AppConfig>(props.initial ?? loadConfig())

  async function saveAndClose() {
    try {
      const fixed: AppConfig = {
        ...cfg,
        remoteHost: String(cfg.remoteHost ?? "").trim() || "http://127.0.0.1",
        remotePort: String(cfg.remotePort ?? "").trim(),
        remotePassword: String(cfg.remotePassword ?? ""),
      }
      saveConfig(fixed)
      props.onDone?.(fixed)
      dismiss()
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"HTTP 远程控制"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarTrailing: (
            <Button
              title="保存"
              action={() => {
                HapticFeedback.mediumImpact()
                void saveAndClose()
              }}
            />
          ),
        }}
      >
        <Form formStyle="grouped">
          <Section header={<Text>连接信息</Text>}>
            <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
              <Text frame={{ width: 48, alignment: "leading" as any }}>
                地址：
              </Text>
              <TextField
                title=""
                value={cfg.remoteHost}
                onChanged={(v: string) => setCfg((c) => ({ ...c, remoteHost: v }))}
                prompt="http://127.0.0.1"
                keyboardType="URL"
                frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
              />
            </HStack>
            <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
              <Text frame={{ width: 48, alignment: "leading" as any }}>
                端口：
              </Text>
              <TextField
                title=""
                value={cfg.remotePort}
                onChanged={(v: string) => setCfg((c) => ({ ...c, remotePort: v }))}
                prompt="6171"
                keyboardType="numberPad"
                frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
              />
            </HStack>
            <HStack spacing={10} frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}>
              <Text frame={{ width: 48, alignment: "leading" as any }}>
                密码：
              </Text>
              <SecureField
                title=""
                value={cfg.remotePassword}
                onChanged={(v: string) => setCfg((c) => ({ ...c, remotePassword: v }))}
                prompt="X-Key 请求头使用的密码"
                frame={{ maxWidth: "infinity" as any, alignment: "leading" as any }}
              />
            </HStack>
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
