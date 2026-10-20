import {
  Button,
  Form,
  HStack,
  Image,
  LabeledContent,
  NavigationStack,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
  useState,
} from "scripting"
import { DashboardSettings } from "../models/types"
import { PROVIDERS_CATALOG } from "../utils/providers_catalog"


export function SettingsView(props: {
  settings: DashboardSettings
  realAccountCount: number
  demoAccountCount: number
  onUpdateSettings: (next: DashboardSettings) => void
  onResetDemoAccounts: () => void
  onClearSnapshotCache: () => void
  onOpenChangelog?: () => void
  onDismiss: () => void
}) {
  const {
    settings,
    realAccountCount,
    demoAccountCount,
    onUpdateSettings,
    onResetDemoAccounts,
    onClearSnapshotCache,
    onOpenChangelog,
    onDismiss,
  } = props

  const [isClearCacheConfirmPresented, setIsClearCacheConfirmPresented] =
    useState<boolean>(false)

  const handleOpenTokenPulseRepo = async () => {
    await Safari.present("https://github.com/hqwuzhaoyi/TokenPulse", false)
  }

  const handleOpenAntigravityManagerRepo = async () => {
    await Safari.present("https://github.com/lbjlaq/Antigravity-Manager", false)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="设置"
        toolbar={{
          topBarLeading: (
            <Button
              title="退出"
              systemImage="xmark"
              action={onDismiss}
            />
          ),
        }}
        confirmationDialog={{
          title: "确认清理本地额度快照缓存？",
          titleVisibility: "visible",
          isPresented: isClearCacheConfirmPresented,
          onChanged: setIsClearCacheConfirmPresented,
          message: (
            <Text>
              清理后不会删除钥匙串中的账号凭证，下次刷新将重新从各供应商接口拉取。
            </Text>
          ),
          actions: (
            <Button
              title="清理快照缓存"
              role="destructive"
              action={() => {
                setIsClearCacheConfirmPresented(false)
                onClearSnapshotCache()
                HapticFeedback.notificationSuccess()
              }}
            />
          ),
        }}
      >
        <Section
          header={<Text>数据源与演示模式</Text>}
          footer={
            <Text>
              演示模式提供覆盖 6 大接入路径的本地样例看板；关闭演示模式即可切换至真实 Keychain 凭证与直连 HTTP 查询。
            </Text>
          }
        >
          <Toggle
            title="演示模式 (Demo Mode)"
            value={settings.isDemoMode}
            onChanged={(val) =>
              onUpdateSettings({ ...settings, isDemoMode: val })
            }
          />
          {settings.isDemoMode ? (
            <Button
              title="恢复默认 9 个代表性演示账号"
              systemImage="arrow.counterclockwise"
              action={onResetDemoAccounts}
            />
          ) : null}
        </Section>

        <Section header={<Text>看板布局与刷新策略</Text>}>
          <Toggle
            title="分组显示"
            value={settings.groupByRouteCategory}
            onChanged={(val) =>
              onUpdateSettings({ ...settings, groupByRouteCategory: val })
            }
          />
          <Toggle
            title="启动脚本时自动刷新已启用账号"
            value={settings.autoRefreshOnLaunch}
            onChanged={(val) =>
              onUpdateSettings({ ...settings, autoRefreshOnLaunch: val })
            }
          />
          <Toggle
            title="新增账号默认开启 iCloud 钥匙串同步"
            value={settings.prefersICloudKeychain}
            onChanged={(val) =>
              onUpdateSettings({ ...settings, prefersICloudKeychain: val })
            }
          />
        </Section>

        <Section
          header={<Text>隐私与账号保护</Text>}
          footer={
            <Text>
              开启后，看板卡片上的邮箱、手机号或账号名称将自动遮罩显示（如 138****5678），点击卡片底部的账号信息可随时切换明文与遮罩。
            </Text>
          }
        >
          <Toggle
            title="账号保护显示"
            value={settings.protectAccountIdentity}
            onChanged={(val) =>
              onUpdateSettings({ ...settings, protectAccountIdentity: val })
            }
          />
        </Section>

        <Section
          header={<Text>客户端直连与钥匙串状态</Text>}
          footer={
            <Text>
              所有 API Key、OAuth 令牌与 Web 会话 Cookie 均封装为带 SHA-256 指纹的信封存入 iOS 系统钥匙串，网络层默认拦截跨域重定向以防止凭证泄漏。
            </Text>
          }
        >
          <LabeledContent
            title="支持 AI 供应商总数"
            value={`${PROVIDERS_CATALOG.length} 家`}
          />
          <LabeledContent
            title="已配置真实账号"
            value={`${realAccountCount} 个`}
          />
          <LabeledContent
            title="当前演示账号"
            value={`${demoAccountCount} 个`}
          />

          {onOpenChangelog ? (
            <Button
              title="查看更新说明 (Changelog)"
              systemImage="newspaper"
              action={onOpenChangelog}
            />
          ) : null}
        </Section>

        <Section header={<Text>缓存维护</Text>}>
          <Button
            title="清理本地额度快照缓存"
            systemImage="trash.slash"
            role="destructive"
            action={() => setIsClearCacheConfirmPresented(true)}
          />
        </Section>

        <Section
          header={<Text>开源致谢 · TokenPulse</Text>}
          footer={
            <Text>
              本脚本基于 TokenPulse 的供应商接入规范与安全设计理念，使用 Scripting 原生组件构建。对齐基线：commit 46ea63d (2026-10-17)。
            </Text>
          }
        >
          <HStack alignment="center" spacing={10}>
            <Image
              systemName="heart.text.square.fill"
              font="title2"
              foregroundStyle="systemPink"
            />
            <VStack alignment="leading" spacing={2}>
              <Text font="headline">TokenPulse</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                github.com/hqwuzhaoyi/TokenPulse · 46ea63d
              </Text>
            </VStack>
            <Spacer />
          </HStack>

          <Button
            title="查看“TokenPulse”开源仓库"
            systemImage="safari"
            action={handleOpenTokenPulseRepo}
          />
        </Section>

        <Section
          header={<Text>开源致谢 · Antigravity-Manager</Text>}
          footer={
            <Text>
              参考该项目实现了 Google Antigravity 多窗口配额提取、Gemini 4 Argon 独立模型解析及客户端直连会话协议。对齐基线：v4.9.8 · commit 9f8e4f2 (2026-10-17)。
            </Text>
          }
        >
          <HStack alignment="center" spacing={10}>
            <Image
              systemName="bolt.shield.fill"
              font="title2"
              foregroundStyle="systemIndigo"
            />
            <VStack alignment="leading" spacing={2}>
              <Text font="headline">Antigravity-Manager</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                github.com/lbjlaq/Antigravity-Manager · v4.9.8
              </Text>
            </VStack>
            <Spacer />
          </HStack>

          <Button
            title="查看“Antigravity-Manager”开源仓库"
            systemImage="safari"
            action={handleOpenAntigravityManagerRepo}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}
