import {
  Button,
  Form,
  HStack,
  Image,
  LabeledContent,
  NavigationStack,
  ProgressView,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useState,
} from "scripting"
import {
  AccountQuotaState,
  ProviderCredentialEnvelope,
  ProviderId,
  SubscriptionAccount,
} from "../models/types"
import {
  CodexResetStatus,
  formatCodexResetLocalTime,
  formatScheduledResetHeadline,
  hasVisibleCodexResetPreview,
} from "../services/codex_reset_feed"
import { extractWebSessionFromController } from "../services/provider_auth"
import {
  buildCredentialEnvelope,
  loadEnvelopeFromKeychain,
  saveEnvelopeToKeychain,
} from "../utils/credential_store"
import { getProviderMeta } from "../utils/providers_catalog"
import {
  formatShortDateTime,
  formatWalletAmount,
  formatWindowQuotaBreakdown,
  formatWindowRemainingFraction,
  formatWindowTitle,
} from "../utils/quota_formatting"
import {
  adaptiveProminentButtonStyle,
  loginMethodBadgeText,
  remainingQuotaColor,
  routeCategoryTitle,
} from "../utils/theme"
import { ProviderIconView } from "./ProviderIconView"


function getDemoApiKey(provider: ProviderId): string {
  switch (provider) {
    case "deepSeek":
      return "demo-deepseek-api-key-sample-token"
    case "claude":
      return "demo-claude-session-sample-token"
    case "volcengine":
      return "demo-volcengine-sample-access-key-id:secret"
    case "miniMax":
    case "miniMaxChina":
    case "miniMaxInternational":
      return "demo-minimax-sample-bearer-token"
    case "newAPI":
      return "demo-newapi-gateway-sample-token"
    case "moonshot":
      return "demo-moonshot-api-key-sample-token"
    case "zhipu":
      return "demo-zhipu-api-key-sample-token"
    case "openAIAPI":
      return "demo-openai-project-key-sample-token"
    default:
      return "demo-mock-api-key-sample-token"
  }
}

function maskApiKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return "••••••••"
  if (trimmed.length <= 8) {
    return "••••••••"
  }
  if (trimmed.length <= 16) {
    return `${trimmed.slice(0, 3)}••••••••${trimmed.slice(-3)}`
  }
  const prefix = trimmed.slice(0, 4)
  const suffix = trimmed.slice(-4)
  return `${prefix}${"•".repeat(12)}${suffix}`
}

export function AccountDetailSheet(props: {
  account: SubscriptionAccount
  state: AccountQuotaState
  isDemoMode: boolean
  codexResetStatus?: CodexResetStatus | null
  onClose: () => void
  onUpdateAccount: (
    updated: SubscriptionAccount,
    newEnvelope?: ProviderCredentialEnvelope
  ) => void
  onDeleteAccount: (accountId: string) => void
  onRefreshAccount: (account: SubscriptionAccount) => void
}) {
  const {
    account,
    state,
    isDemoMode,
    codexResetStatus,
    onClose,
    onUpdateAccount,
    onDeleteAccount,
    onRefreshAccount,
  } = props

  const meta = getProviderMeta(account.provider)
  const existingEnvelope = !isDemoMode
    ? loadEnvelopeFromKeychain(
        account.credentialKeychainKey,
        account.preferssynchronizableKeychain
      )
    : null

  const isApiKeyAccount =
    meta.credentialKind === "apiKey" ||
    meta.loginMethod === "apiKey" ||
    meta.routeCategory === "direct_api" ||
    meta.routeCategory === "gateway" ||
    (existingEnvelope && existingEnvelope.kind === "apiKey")

  const apiKeyToDisplay =
    existingEnvelope?.accessToken ||
    (isDemoMode && isApiKeyAccount ? getDemoApiKey(account.provider) : "")

  const [displayName, setDisplayName] = useState<string>(account.displayName)
  const [widgetOrder, setWidgetOrder] = useState<string>(
    account.widgetOrder !== undefined ? String(account.widgetOrder) : ""
  )
  const [isEnabled, setIsEnabled] = useState<boolean>(account.isEnabled)
  const [serverAddress, setServerAddress] = useState<string>(
    account.serverAddress ?? existingEnvelope?.metadata.serverAddress ?? ""
  )
  const [newCredentialInput, setNewCredentialInput] = useState<string>("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDeleteConfirmPresented, setIsDeleteConfirmPresented] =
    useState<boolean>(false)
  const [isReauthenticating, setIsReauthenticating] = useState<boolean>(false)
  const [isApiKeyRevealed, setIsApiKeyRevealed] = useState<boolean>(false)
  const [isToastPresented, setIsToastPresented] = useState<boolean>(false)
  const [toastMessage, setToastMessage] = useState<string>(
    "已复制 API 凭据到剪贴板"
  )

  // 当切换查看不同账号时，立即同步表单字段，防止沿用上一个查看过的账号名称（如 Cursor）
  useEffect(() => {
    setDisplayName(account.displayName)
    setWidgetOrder(account.widgetOrder !== undefined ? String(account.widgetOrder) : "")
    setIsEnabled(account.isEnabled)
    setServerAddress(
      account.serverAddress ?? existingEnvelope?.metadata.serverAddress ?? ""
    )
    setNewCredentialInput("")
    setErrorMessage(null)
    setIsDeleteConfirmPresented(false)
    setIsApiKeyRevealed(false)
    setIsToastPresented(false)
  }, [account.id, account.displayName, account.widgetOrder, account.isEnabled, account.serverAddress])

  const handleCopyApiKey = async () => {
    if (!apiKeyToDisplay) return
    await Pasteboard.setString(apiKeyToDisplay)
    HapticFeedback.lightImpact()
    setToastMessage("已复制 API 凭据到剪贴板")
    setIsToastPresented(true)
    setTimeout(() => {
      setIsToastPresented(false)
    }, 2000)
  }

  const snapshot =
    state.type === "loaded"
      ? state.snapshot
      : state.type === "loading"
        ? state.previous
        : state.type === "failed"
          ? state.previous
          : undefined

  const fingerprintPreview =
    existingEnvelope?.metadata.sourceCredentialFingerprint?.slice(0, 16) ??
    snapshot?.sourceCredentialFingerprint?.slice(0, 16) ??
    "未生成"

  const handleSaveChanges = () => {
    try {
      setErrorMessage(null)
      let updatedEnvelope: ProviderCredentialEnvelope | undefined

      if (!isDemoMode && newCredentialInput.trim()) {
        updatedEnvelope = buildCredentialEnvelope({
          provider: account.provider,
          rawInput: newCredentialInput.trim(),
          serverAddress: meta.requiresGatewayAddress ? serverAddress : undefined,
          region: existingEnvelope?.metadata.region,
        })
        saveEnvelopeToKeychain(
          account.credentialKeychainKey,
          updatedEnvelope,
          account.preferssynchronizableKeychain
        )
      }

      const parsedOrder = widgetOrder.trim() ? parseInt(widgetOrder.trim(), 10) : undefined
      const updatedAccount: SubscriptionAccount = {
        ...account,
        displayName: displayName.trim() || meta.displayName,
        isEnabled,
        serverAddress: meta.requiresGatewayAddress
          ? serverAddress.trim()
          : account.serverAddress,
        widgetOrder: parsedOrder !== undefined && !isNaN(parsedOrder) && parsedOrder > 0 ? parsedOrder : undefined,
      }

      HapticFeedback.notificationSuccess()
      onUpdateAccount(updatedAccount, updatedEnvelope)
      onClose()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "保存修改失败")
      HapticFeedback.notificationError()
    }
  }

  const handleBuiltInBrowserRelogin = async () => {
    if (!meta.webSessionProfile || isReauthenticating) return
    setIsReauthenticating(true)
    setErrorMessage(null)
    const controller = new WebViewController({ ephemeral: true })
    try {
      void controller.loadURL(meta.webSessionProfile.loginURL)
      await controller.present({
        navigationTitle: `重新登录 ${meta.displayName}`,
        fullscreen: false,
      })
      const updatedEnvelope = await extractWebSessionFromController(
        account.provider,
        controller
      )
      saveEnvelopeToKeychain(
        account.credentialKeychainKey,
        updatedEnvelope,
        account.preferssynchronizableKeychain
      )
      HapticFeedback.notificationSuccess()
      onUpdateAccount(account, updatedEnvelope)
      onClose()
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "内置浏览器重新登录未提取到有效 Cookie"
      )
      HapticFeedback.notificationError()
    } finally {
      controller.dispose()
      setIsReauthenticating(false)
    }
  }

  return (
    <NavigationStack
      overlay={
        isToastPresented ? (
          <VStack
            frame={{
              maxWidth: "infinity",
              maxHeight: "infinity",
              alignment: "bottom",
            }}
            padding={{ bottom: 28 }}
          >
            <HStack
              alignment="center"
              spacing={8}
              padding={{ horizontal: 16, vertical: 10 }}
              background={{
                style: "regularMaterial",
                shape: { type: "capsule", style: "continuous" },
              }}
              shadow={{ color: "black", radius: 8, y: 2 }}
            >
              <Image
                systemName="checkmark.circle.fill"
                font="subheadline"
                foregroundStyle="systemGreen"
              />
              <Text
                font="subheadline"
                fontWeight="medium"
                foregroundStyle="label"
              >
                {toastMessage}
              </Text>
            </HStack>
          </VStack>
        ) : undefined
      }
    >
      <Form
        navigationTitle="账号详情与设置"
        navigationBarTitleDisplayMode="inline"
        toast={{
          isPresented: isToastPresented,
          onChanged: setIsToastPresented,
          message: toastMessage,
          duration: 2,
          position: "bottom",
        }}
        toolbar={{
          cancellationAction: <Button title="关闭" action={onClose} />,
          confirmationAction: (
            <Button title="保存" action={handleSaveChanges} />
          ),
        }}
        confirmationDialog={{
          title: `确认删除「${account.displayName}」？`,
          titleVisibility: "visible",
          isPresented: isDeleteConfirmPresented,
          onChanged: setIsDeleteConfirmPresented,
          message: <Text>删除后将同时清除钥匙串中的凭证与本地缓存快照。</Text>,
          actions: (
            <Button
              title="删除账号"
              role="destructive"
              action={() => {
                setIsDeleteConfirmPresented(false)
                onDeleteAccount(account.id)
                onClose()
              }}
            />
          ),
        }}
      >
        <Section header={<Text>基本资料</Text>}>
          <HStack alignment="center" spacing={12}>
            <ProviderIconView provider={account.provider} size={42} />
            <VStack alignment="leading" spacing={2}>
              <Text font="headline">{meta.displayName}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {`${routeCategoryTitle(meta.routeCategory)} · ${loginMethodBadgeText(meta.loginMethod)}`}
              </Text>
            </VStack>
          </HStack>

          <TextField
            title="显示名称"
            value={displayName}
            prompt={meta.displayName}
            keyboardType="default"
            onChanged={setDisplayName}
          />

          <TextField
            title="小组件序号"
            value={widgetOrder}
            prompt="可选排序数字 (用于同供应商合并展示，如 1, 2...)"
            keyboardType="numberPad"
            onChanged={setWidgetOrder}
          />

          <Toggle
            title="参与全局一键刷新"
            value={isEnabled}
            onChanged={setIsEnabled}
          />
        </Section>

        {meta.requiresGatewayAddress ? (
          <Section header={<Text>网关地址</Text>}>
            <TextField
              title="服务器地址"
              value={serverAddress}
              prompt="https://api.example.com"
              keyboardType="URL"
              textInputAutocapitalization="never"
              autocorrectionDisabled={true}
              onChanged={setServerAddress}
            />
          </Section>
        ) : null}

        {isApiKeyAccount && apiKeyToDisplay ? (
          <Section
            header={<Text>API 凭据</Text>}
            footer={
              <Text>
                点击密钥区域即可复制完整密钥；默认以掩码保护，点击右侧按钮可切换明文
              </Text>
            }
          >
            <HStack alignment="center" spacing={8}>
              <Button
                buttonStyle="plain"
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                action={handleCopyApiKey}
              >
                <HStack alignment="center" spacing={10}>
                  <Image
                    systemName="key.fill"
                    font="subheadline"
                    foregroundStyle="accentColor"
                  />
                  <VStack alignment="leading" spacing={3}>
                    <HStack alignment="center" spacing={4}>
                      <Text font="caption2" foregroundStyle="secondaryLabel">
                        {meta.credentialLabel || "API 密钥"}
                      </Text>
                      <Text font="caption2" foregroundStyle="accentColor">
                        (点击复制)
                      </Text>
                    </HStack>
                    <Text
                      font="subheadline"
                      monospaced={true}
                      foregroundStyle={
                        isApiKeyRevealed ? "label" : "secondaryLabel"
                      }
                      lineLimit={isApiKeyRevealed ? 4 : 1}
                      truncationMode="middle"
                    >
                      {isApiKeyRevealed
                        ? apiKeyToDisplay
                        : maskApiKey(apiKeyToDisplay)}
                    </Text>
                  </VStack>
                </HStack>
              </Button>

              <Spacer />

              <Button
                buttonStyle="borderless"
                action={() => {
                  setIsApiKeyRevealed((prev) => !prev)
                  HapticFeedback.lightImpact()
                }}
              >
                <HStack
                  alignment="center"
                  spacing={4}
                  padding={{ vertical: 4, horizontal: 8 }}
                >
                  <Image
                    systemName={
                      isApiKeyRevealed ? "eye.slash.fill" : "eye.fill"
                    }
                    font="subheadline"
                    foregroundStyle="accentColor"
                  />
                  <Text font="caption" foregroundStyle="accentColor">
                    {isApiKeyRevealed ? "隐藏" : "查看"}
                  </Text>
                </HStack>
              </Button>
            </HStack>
          </Section>
        ) : null}

        <Section
          header={<Text>安全信封与凭证指纹</Text>}
          footer={
            <Text>
              当旋转密钥或变更网关地址时，SHA-256 指纹会自动更新并立即淘汰旧额度快照
            </Text>
          }
        >
          <LabeledContent
            title="凭证存储位置"
            value={
              isDemoMode
                ? "演示内存沙箱"
                : account.preferssynchronizableKeychain
                  ? "iCloud 钥匙串"
                  : "本机钥匙串 (Keychain)"
            }
          />
          <LabeledContent title="SHA-256 指纹前缀" value={fingerprintPreview} />
          {snapshot?.accountIdentity ? (
            <LabeledContent
              title="远端身份标识"
              value={snapshot.accountIdentity}
            />
          ) : null}
          {snapshot?.providerPlanName ? (
            <LabeledContent
              title="订阅套餐层级"
              value={snapshot.providerPlanName}
            />
          ) : null}
        </Section>

        {!isDemoMode ? (
          <Section
            header={<Text>更新 / 重新获取凭证 (可选)</Text>}
            footer={<Text>留空则保留当前钥匙串中的原凭证不变</Text>}
          >
            {meta.webSessionProfile ? (
              <Button
                buttonStyle={adaptiveProminentButtonStyle()}
                frame={{ maxWidth: "infinity", alignment: "center" }}
                disabled={isReauthenticating}
                action={handleBuiltInBrowserRelogin}
              >
                <HStack
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  alignment="center"
                  spacing={8}
                  padding={{ vertical: 2 }}
                >
                  <Image systemName="safari.fill" font="subheadline" />
                  <Text
                    font="subheadline"
                    fontWeight="semibold"
                    lineLimit={1}
                    multilineTextAlignment="center"
                  >
                    {isReauthenticating ? "正在登录…" : "网页重新登录"}
                  </Text>
                </HStack>
              </Button>
            ) : null}

            <TextField
              title={meta.credentialLabel}
              value={newCredentialInput}
              prompt="输入新密钥或令牌以覆盖旧凭证"
              keyboardType="default"
              autocorrectionDisabled={true}
              textInputAutocapitalization="never"
              onChanged={setNewCredentialInput}
            />

            <HStack>
              <Button
                title="从剪贴板粘贴新凭证"
                systemImage="doc.on.clipboard"
                buttonStyle="borderless"
                action={async () => {
                  const clip = await Pasteboard.getString()
                  if (clip && clip.trim()) {
                    setNewCredentialInput(clip.trim())
                    HapticFeedback.lightImpact()
                  }
                }}
              />
              <Spacer />
            </HStack>
          </Section>
        ) : null}

        {account.provider === "codex" &&
        codexResetStatus &&
        hasVisibleCodexResetPreview(codexResetStatus) ? (
          <Section
            header={<Text>Codex 重置预告 (第三方源)</Text>}
            footer={
              <Text>
                数据来源于 codex-resets.com 公开状态流，结合社区 AI 概率模型预测，非官方保证。
              </Text>
            }
          >
            {codexResetStatus.data.scheduledReset ? (
              <LabeledContent
                title="预定重置时间"
                value={
                  codexResetStatus.data.scheduledReset.scheduledFor
                    ? `${formatCodexResetLocalTime(codexResetStatus.data.scheduledReset.scheduledFor)} · 北京时间 (${formatScheduledResetHeadline(codexResetStatus.data.scheduledReset.scheduledFor)})`
                    : "时间待定"
                }
              />
            ) : null}
            {codexResetStatus.data.scheduledReset?.text ? (
              <LabeledContent
                title="公告内容"
                value={codexResetStatus.data.scheduledReset.text}
              />
            ) : null}
            {codexResetStatus.data.activeWatch ? (
              <LabeledContent
                title="AI 预测概率"
                value={
                  codexResetStatus.data.activeWatch.resetChancePercent != null
                    ? `${codexResetStatus.data.activeWatch.resetChancePercent}% (${codexResetStatus.data.activeWatch.forecastWindow})`
                    : codexResetStatus.data.activeWatch.forecastWindow
                }
              />
            ) : null}
            {codexResetStatus.data.latestReset?.announcedAt ? (
              <LabeledContent
                title="上次重置记录"
                value={formatCodexResetLocalTime(
                  codexResetStatus.data.latestReset.announcedAt
                )}
              />
            ) : null}
          </Section>
        ) : null}

        {snapshot ? (
          <Section
            header={<Text>最新采集额度明细 ({snapshot.windows.length})</Text>}
            footer={
              <Text>
                {`采集时间：${formatShortDateTime(snapshot.collectedAt) ?? snapshot.collectedAt}`}
              </Text>
            }
          >
            {snapshot.windows.map((win) => {
              if (win.wallet) {
                return (
                  <LabeledContent
                    key={win.id}
                    title={win.name}
                    value={formatWalletAmount(win.wallet.total, win.wallet)}
                  />
                )
              }
              const remFrac = formatWindowRemainingFraction(win)
              const breakdown = formatWindowQuotaBreakdown(win)
              const statusColor = remainingQuotaColor(
                breakdown.remainingPercent,
                win.isExhausted
              )
              return (
                <VStack
                  key={win.id}
                  alignment="leading"
                  spacing={6}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  <HStack>
                    <Text font="subheadline">{formatWindowTitle(win)}</Text>
                    <Spacer />
                    <Text
                      font="caption"
                      fontWeight="semibold"
                      monospacedDigit={true}
                      foregroundStyle={
                        win.isUnlimited ? "systemGreen" : statusColor
                      }
                    >
                      {breakdown.primaryRemainingText}
                    </Text>
                  </HStack>
                  {remFrac !== null ? (
                    <ProgressView
                      value={remFrac}
                      total={1}
                      progressViewStyle="linear"
                      tint={statusColor}
                    />
                  ) : null}
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {breakdown.secondaryUsedText}
                  </Text>
                </VStack>
              )
            })}
          </Section>
        ) : null}

        {errorMessage ? (
          <Section header={<Text>提示</Text>}>
            <Text foregroundStyle="systemRed">{errorMessage}</Text>
          </Section>
        ) : null}

        <Section>
          <Button
            title="立即刷新此账号额度"
            systemImage="arrow.clockwise"
            action={() => {
              onRefreshAccount(account)
              onClose()
            }}
          />

          <Button
            title="删除此账号"
            systemImage="trash"
            role="destructive"
            action={() => setIsDeleteConfirmPresented(true)}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}
