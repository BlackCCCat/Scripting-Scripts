import {
  Button,
  Form,
  HStack,
  Image,
  LabeledContent,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
  useState,
} from "scripting"
import { DashboardSettings } from "../models/types"
import { PROVIDERS_CATALOG } from "../utils/providers_catalog"
import { WidgetPreviewSheet } from "../widgets"
import { WidgetGuideSheet } from "./WidgetGuideSheet"


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
  const [isWidgetPreviewPresented, setIsWidgetPreviewPresented] =
    useState<boolean>(false)
  const [isWidgetGuidePresented, setIsWidgetGuidePresented] =
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
        sheet={[
          {
            isPresented: isWidgetPreviewPresented,
            onChanged: setIsWidgetPreviewPresented,
            content: (
              <WidgetPreviewSheet
                onDismiss={() => setIsWidgetPreviewPresented(false)}
              />
            ),
          },
          {
            isPresented: isWidgetGuidePresented,
            onChanged: setIsWidgetGuidePresented,
            content: (
              <WidgetGuideSheet
                onDismiss={() => setIsWidgetGuidePresented(false)}
              />
            ),
          },
        ]}
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
              开启小组件账号隐私保护后，当小组件中显示同一供应商的多个账号时，将自动对邮箱、用户名等进行遮罩（如 d***r@gmail.com）。主看板开启账号保护显示后，卡片上的账号名称也将自动遮罩。
            </Text>
          }
        >
          <Toggle
            title="小组件账号隐私保护"
            value={settings.widgetPrivacyEnabled ?? true}
            onChanged={(val) =>
              onUpdateSettings({ ...settings, widgetPrivacyEnabled: val })
            }
          />
          <Toggle
            title="主看板账号保护显示"
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

        <Section
          header={<Text>桌面小组件</Text>}
          footer={
            <Text>
              原生适配 iOS/iPadOS 桌面小、中、大、特大四种尺寸。小组件受 iOS WidgetKit 能源与网络预算调度，设置较短间隔（如 15/30 分钟）可加快后台轮询；应用内数据变动或下拉刷新时会实时同步推送至小组件。
            </Text>
          }
        >
          <Picker
            title="小组件刷新间隔"
            value={String(settings.widgetRefreshIntervalMinutes ?? 30)}
            onChanged={(val: string) => {
              const minutes = Number.parseInt(val, 10) || 30
              onUpdateSettings({
                ...settings,
                widgetRefreshIntervalMinutes: minutes,
              })
            }}
          >
            <Text tag="5">5 分钟 (高频推荐)</Text>
            <Text tag="15">15 分钟</Text>
            <Text tag="30">30 分钟 (默认推荐)</Text>
            <Text tag="60">1 小时</Text>
            <Text tag="120">2 小时</Text>
            <Text tag="360">6 小时</Text>
          </Picker>

          <Toggle
            title="用量标识适配透明模式"
            value={settings.widgetQuotaAdaptTransparent ?? false}
            onChanged={(val) => {
              onUpdateSettings({
                ...settings,
                widgetQuotaAdaptTransparent: val,
                widgetConnectionAdaptTransparent: val,
              })
            }}
          />

          <Button
            title="小组件使用说明"
            systemImage="questionmark.circle"
            action={() => setIsWidgetGuidePresented(true)}
          />

          <Button
            title="预览桌面小组件样式 (小/中/大/特大)"
            systemImage="rectangle.3.group"
            action={() => setIsWidgetPreviewPresented(true)}
          />
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
