import { getDashboardLanguage, localize } from "../utils/localization"
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
  useEffect,
  useState,
  VirtualNode,
  VStack,
  ZStack,
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
import {
  buildAntigravityAuthURL,
  buildCodexWebAuthPlan,
  buildTraeAuthURL,
  exchangeAntigravityCode,
  exchangeCodexWebOAuthCode,
  exchangeTraeToken,
  extractWebSessionFromController,
} from "../services/provider_auth"
import {
  buildCredentialEnvelope,
  computeCredentialFingerprint,
  generateAccountKeychainKey,
  loadEnvelopeFromKeychain,
  loadStoredAccounts,
  normalizeGatewayServerAddress,
  removeEnvelopeFromKeychain,
  saveEnvelopeToKeychain,
} from "../utils/credential_store"
import { getProviderMeta, localizeAccountName } from "../utils/providers_catalog"
import {
  formatShortDateTime,
  formatWalletAmount,
  formatWindowQuotaBreakdown,
  formatWindowRemainingFraction,
  formatWindowTitle,
} from "../utils/quota_formatting"
import {
  adaptiveProminentButtonStyle,
  adaptiveSecondaryButtonStyle,
  loginMethodBadgeText,
  remainingQuotaColor,
  routeCategoryTitle,
} from "../utils/theme"
import { ProviderIconView } from "./ProviderIconView"
import { DeviceCodeLoginSheet } from "./DeviceCodeLoginSheet"


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

/**
 * 包装 Form / List 内的居中操作按钮行：
 * SwiftUI Form 在计算行分割线（listRowSeparatorLeading）时，默认会依据行内首个文字／内容元素的 leading 对齐。
 * 居中按钮若未在行首提供 leading 锚点，会导致分割线从屏幕中央甚至按钮文字处才开始绘制（左侧缺失一半）。
 * 通过 ZStack leading 对齐并在行首放置尺寸为 0 的隐式锚点，使分割线恢复与表单标准间距一致的完整显示。
 */
function FormActionButtonRow(props: { children: VirtualNode }): JSX.Element {
  return (
    <ZStack
      alignment="leading"
      frame={{ maxWidth: "infinity" }}
      alignmentGuide={{ alignment: "leading", value: 0 }}
    >
      <Text font="subheadline" opacity={0} frame={{ width: 0, height: 0 }}>
        {" "}
      </Text>
      {props.children}
    </ZStack>
  )
}

export function AccountDetailSheet(props: {
  account: SubscriptionAccount
  state: AccountQuotaState
  isDemoMode: boolean
  codexResetStatus?: CodexResetStatus | null
  embedded?: boolean
  zoomNamespace?: any
  navigationTransition?: { type: "zoom"; sourceID: string | number; namespace: any }
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

  const isEnglish = getDashboardLanguage() === "en"
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
  const [isDeviceLoginPresented, setIsDeviceLoginPresented] =
    useState<boolean>(false)
  const [isPresentingBuiltInBrowser, setIsPresentingBuiltInBrowser] =
    useState<boolean>(false)
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
    setIsDeviceLoginPresented(false)
    setIsPresentingBuiltInBrowser(false)
    setIsReauthenticating(false)
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

  const handleImportFromKeychain = async () => {
    try {
      const picked = await Keychain.pick({
        title: localize("从钥匙串导入"),
        prompt: localize(`选择要更新到 ${meta.displayName} 的新凭据或 API 密钥`),
      })
      if (!picked || !picked.trim()) return
      const trimmed = picked.trim()

      try {
        const parsed = JSON.parse(trimmed) as Partial<ProviderCredentialEnvelope>
        if (
          parsed &&
          typeof parsed.accessToken === "string" &&
          parsed.accessToken.trim()
        ) {
          setNewCredentialInput(parsed.accessToken.trim())
          if (parsed.metadata?.serverAddress && meta.requiresGatewayAddress) {
            setServerAddress(parsed.metadata.serverAddress)
          }
          HapticFeedback.notificationSuccess()
          setToastMessage("已从钥匙串导入新凭证")
          setIsToastPresented(true)
          setTimeout(() => setIsToastPresented(false), 2000)
          setErrorMessage(null)
          return
        }
      } catch {
        // 非 JSON
      }

      setNewCredentialInput(trimmed)
      HapticFeedback.notificationSuccess()
      setToastMessage("已从钥匙串导入新凭证")
      setIsToastPresented(true)
      setTimeout(() => setIsToastPresented(false), 2000)
      setErrorMessage(null)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "从钥匙串导入失败")
      HapticFeedback.notificationError()
    }
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
      } else if (!isDemoMode && meta.requiresGatewayAddress) {
        const nextAddress = normalizeGatewayServerAddress(serverAddress)
        if (nextAddress !== existingEnvelope?.metadata.serverAddress) {
          if (!existingEnvelope) throw new Error("原登录凭据不可读取，请先重新登录")
          updatedEnvelope = {
            ...existingEnvelope,
            metadata: { ...existingEnvelope.metadata, serverAddress: nextAddress },
          }
          updatedEnvelope.metadata.sourceCredentialFingerprint =
            computeCredentialFingerprint(updatedEnvelope)
        }
      }

      const existingAccounts = loadStoredAccounts()
      const newDisplayName = displayName.trim() || meta.displayName
      const activeEnvelope = updatedEnvelope || existingEnvelope

      let targetKey = account.credentialKeychainKey
      if (!isDemoMode) {
        targetKey = generateAccountKeychainKey({
          provider: account.provider,
          accountId: account.id,
          displayName: newDisplayName,
          envelope: activeEnvelope || undefined,
          existingAccounts,
        })

        if (targetKey !== account.credentialKeychainKey) {
          if (!activeEnvelope) throw new Error("原登录凭据不可读取，请先重新登录")
          if (!saveEnvelopeToKeychain(targetKey, activeEnvelope, account.preferssynchronizableKeychain) ||
            Keychain.get(targetKey, { synchronizable: account.preferssynchronizableKeychain }) !== JSON.stringify(activeEnvelope)) {
            throw new Error("新账号凭据写入失败，原登录凭据已保留")
          }
        } else if (updatedEnvelope) {
          if (!saveEnvelopeToKeychain(targetKey, updatedEnvelope, account.preferssynchronizableKeychain) ||
            Keychain.get(targetKey, { synchronizable: account.preferssynchronizableKeychain }) !== JSON.stringify(updatedEnvelope)) {
            throw new Error("登录凭据写入失败，请重试")
          }
        }
      }

      const parsedOrder = widgetOrder.trim() ? parseInt(widgetOrder.trim(), 10) : undefined
      const updatedAccount: SubscriptionAccount = {
        ...account,
        displayName: newDisplayName,
        credentialKeychainKey: targetKey,
        isEnabled,
        serverAddress: meta.requiresGatewayAddress
          ? activeEnvelope?.metadata.serverAddress
          : account.provider === "openAIAPI" || account.provider === "anthropic"
            ? undefined
            : account.serverAddress,
        widgetOrder: parsedOrder !== undefined && !isNaN(parsedOrder) && parsedOrder > 0 ? parsedOrder : undefined,
      }

      onUpdateAccount(updatedAccount, updatedEnvelope)
      if (!isDemoMode) {
        if (targetKey !== account.credentialKeychainKey) {
          removeEnvelopeFromKeychain(account.credentialKeychainKey, account.preferssynchronizableKeychain)
        }
      }
      HapticFeedback.notificationSuccess()
      onClose()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "保存修改失败")
      HapticFeedback.notificationError()
    }
  }

  const isGoogleOAuth =
    account.provider === "antigravity" || account.provider === "gemini"
  const isTraeAuth = account.provider === "trae"
  const isCodexAuth = account.provider === "codex"
  const supportsDeviceOrPollFlow =
    meta.loginMethod === "deviceCode" ||
    account.provider === "codex" ||
    account.provider === "cursor" ||
    account.provider === "grokBot" ||
    account.provider === "workBuddy" ||
    account.provider === "qoder" ||
    account.provider === "zhipu"

  const isTrueDeviceCode =
    account.provider === "copilot" || account.provider === "kimiCode"

  const supportsWebViewFlow = Boolean(meta.webSessionProfile)

  const handleEnvelopeUpdated = (newEnvelope: ProviderCredentialEnvelope) => {
    if (!saveEnvelopeToKeychain(
      account.credentialKeychainKey,
      newEnvelope,
      account.preferssynchronizableKeychain
    ) || Keychain.get(account.credentialKeychainKey, { synchronizable: account.preferssynchronizableKeychain }) !== JSON.stringify(newEnvelope)) {
      setErrorMessage("登录凭据写入失败，请重试")
      HapticFeedback.notificationError()
      return
    }
    HapticFeedback.notificationSuccess()
    onUpdateAccount(account, newEnvelope)
    onClose()
  }

  const handleGoogleOAuthRelogin = async () => {
    if (isPresentingBuiltInBrowser) return
    setIsPresentingBuiltInBrowser(true)
    setErrorMessage(null)
    const controller = new WebViewController({ ephemeral: false })
    let capturedCode: string | null = null
    controller.shouldAllowRequest = async (req) => {
      if (
        req.url.startsWith("http://localhost:51121/oauth-callback") ||
        req.url.startsWith("http://127.0.0.1:51121/oauth-callback")
      ) {
        try {
          const u = new URL(req.url)
          const code = u.searchParams.get("code")
          if (code) {
            capturedCode = code
          }
        } catch {}
        controller.dismiss()
        return false
      }
      return true
    }

    try {
      const authUrl = buildAntigravityAuthURL()
      void controller.loadURL(authUrl)
      await controller.present({
        navigationTitle: localize("Google 授权登录"),
        fullscreen: false,
      })
      if (capturedCode) {
        const tokenResult = await exchangeAntigravityCode(capturedCode)
        const envelope: ProviderCredentialEnvelope = {
          provider: account.provider,
          kind: "oauth",
          accessToken: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken,
          expiresAt: new Date(
            Date.now() + tokenResult.expiresIn * 1000
          ).toISOString(),
          metadata: {
            ...existingEnvelope?.metadata,
            accountEmail: tokenResult.email,
          },
        }
        handleEnvelopeUpdated(envelope)
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Google 授权登录未完成，请重试"
      )
      HapticFeedback.notificationError()
    } finally {
      controller.dispose()
      setIsPresentingBuiltInBrowser(false)
    }
  }

  const handleTraeRelogin = async () => {
    if (isPresentingBuiltInBrowser) return
    setIsPresentingBuiltInBrowser(true)
    setErrorMessage(null)
    const controller = new WebViewController({ ephemeral: false })
    let capturedRefreshToken: string | null = null
    let capturedUid = ""
    controller.shouldAllowRequest = async (req) => {
      if (
        req.url.startsWith("http://127.0.0.1:18080/authorize") ||
        req.url.startsWith("http://localhost:18080/authorize")
      ) {
        try {
          const u = new URL(req.url)
          const rt = u.searchParams.get("refreshToken")
          let jwtRt = ""
          try {
            const userJwt = JSON.parse(u.searchParams.get("userJwt") || "{}")
            jwtRt = userJwt.RefreshToken || ""
          } catch {}
          try {
            const userInfo = JSON.parse(u.searchParams.get("userInfo") || "{}")
            capturedUid = String(userInfo.UserID || "")
          } catch {}
          capturedRefreshToken = rt || jwtRt
        } catch {}
        controller.dismiss()
        return false
      }
      return true
    }

    const region = (existingEnvelope?.metadata.region as "china" | "global") || "china"
    const authPlan = buildTraeAuthURL(region)
    try {
      void controller.loadURL(authPlan.url)
      await controller.present({
        navigationTitle: localize(`登录 TRAE (${region === "global" ? "国际站" : "中国站"})`),
        fullscreen: false,
      })
      if (capturedRefreshToken) {
        const exchanged = await exchangeTraeToken(
          capturedRefreshToken,
          region,
          capturedUid,
          authPlan.deviceId
        )
        const envelope: ProviderCredentialEnvelope = {
          provider: "trae",
          kind: "oauth",
          accessToken: exchanged.accessToken,
          refreshToken: exchanged.refreshToken,
          expiresAt: exchanged.expiresAt,
          metadata: {
            ...existingEnvelope?.metadata,
            region,
            machineId: authPlan.machineId,
            deviceId: authPlan.deviceId,
            uid: capturedUid,
          },
        }
        handleEnvelopeUpdated(envelope)
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Trae 授权登录未完成，请重试"
      )
      HapticFeedback.notificationError()
    } finally {
      controller.dispose()
      setIsPresentingBuiltInBrowser(false)
    }
  }

  const handleCodexWebRelogin = async () => {
    if (isPresentingBuiltInBrowser) return
    setIsPresentingBuiltInBrowser(true)
    setErrorMessage(null)
    const controller = new WebViewController({ ephemeral: false })
    let capturedCode: string | null = null
    controller.shouldAllowRequest = async (req) => {
      if (
        req.url.startsWith("http://localhost:1455/auth/callback") ||
        req.url.startsWith("http://127.0.0.1:1455/auth/callback")
      ) {
        try {
          const u = new URL(req.url)
          const code = u.searchParams.get("code")
          if (code) {
            capturedCode = code
          }
        } catch {}
        controller.dismiss()
        return false
      }
      return true
    }

    const authPlan = buildCodexWebAuthPlan()
    try {
      void controller.loadURL(authPlan.url)
      await controller.present({
        navigationTitle: localize("OpenAI 授权登录"),
        fullscreen: false,
      })
      if (capturedCode) {
        const tokenResult = await exchangeCodexWebOAuthCode(
          capturedCode,
          authPlan.codeVerifier
        )
        const extraMetadata: Record<string, string> = {
          ...existingEnvelope?.metadata,
        }
        if (tokenResult.email) {
          extraMetadata.accountEmail = tokenResult.email
          extraMetadata.email = tokenResult.email
        }
        if (tokenResult.planType) {
          extraMetadata.planType = tokenResult.planType
        }
        const envelope = buildCredentialEnvelope({
          provider: "codex",
          rawInput: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken,
          expiresAt: new Date(
            Date.now() + tokenResult.expiresIn * 1000
          ).toISOString(),
          accountID: tokenResult.accountID,
          extraMetadata,
        })
        handleEnvelopeUpdated(envelope)
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "OpenAI 授权登录未完成，请重试"
      )
      HapticFeedback.notificationError()
    } finally {
      controller.dispose()
      setIsPresentingBuiltInBrowser(false)
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
        navigationTitle: localize(`重新登录 ${meta.displayName}`),
        fullscreen: false,
      })
      const updatedEnvelope = await extractWebSessionFromController(
        account.provider,
        controller
      )
      handleEnvelopeUpdated(updatedEnvelope)
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

  const formContent = (
    <Form
      navigationTitle={localize("账号详情与设置")}
      navigationBarTitleDisplayMode="inline"
      navigationTransition={props.navigationTransition}
      toast={{
        isPresented: isToastPresented,
        onChanged: setIsToastPresented,
        message: localize(toastMessage),
        duration: 2,
        position: "bottom",
      }}
      toolbar={{
        cancellationAction: props.embedded ? undefined : <Button title={localize("关闭")} action={onClose} />,
        confirmationAction: (
          <Button title={localize("保存")} action={handleSaveChanges} />
        ),
      }}
      confirmationDialog={{
        title: localize(`确认删除「${localizeAccountName(account.provider, account.displayName)}」？`),
        titleVisibility: "visible",
        isPresented: isDeleteConfirmPresented,
        onChanged: setIsDeleteConfirmPresented,
        message: <Text>{localize("删除后将同时清除钥匙串中的凭证与本地缓存快照。")}</Text>,
        actions: (
          <Button
            title={localize("删除账号")}
            role="destructive"
            action={() => {
              setIsDeleteConfirmPresented(false)
              onDeleteAccount(account.id)
              onClose()
            }}
          />
        ),
      }}
      navigationDestination={
        props.embedded
          ? {
              isPresented: isDeviceLoginPresented,
              onChanged: setIsDeviceLoginPresented,
              content: (
                <DeviceCodeLoginSheet
                  provider={account.provider}
                  region={existingEnvelope?.metadata.region}
                  embedded={true}
                  navigationTransition={
                    props.zoomNamespace
                      ? {
                          type: "zoom",
                          sourceID: `account-reauth-${account.id}`,
                          namespace: props.zoomNamespace,
                        }
                      : undefined
                  }
                  onCancel={() => setIsDeviceLoginPresented(false)}
                  onCompleted={(envelope) => {
                    setIsDeviceLoginPresented(false)
                    handleEnvelopeUpdated(envelope)
                  }}
                />
              ),
            }
          : undefined
      }
      sheet={
        props.embedded
          ? undefined
          : {
              isPresented: isDeviceLoginPresented,
              onChanged: setIsDeviceLoginPresented,
              content: (
                <DeviceCodeLoginSheet
                  provider={account.provider}
                  region={existingEnvelope?.metadata.region}
                  onCancel={() => setIsDeviceLoginPresented(false)}
                  onCompleted={(envelope) => {
                    setIsDeviceLoginPresented(false)
                    handleEnvelopeUpdated(envelope)
                  }}
                />
              ),
            }
      }
    >
        <Section header={<Text>{localize("基本资料")}</Text>}>
          <HStack alignment="center" spacing={12}>
            <ProviderIconView provider={account.provider} size={42} />
            <VStack alignment="leading" spacing={2}>
              <Text font="headline">{localize(meta.displayName)}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {`${localize(routeCategoryTitle(meta.routeCategory))} · ${localize(loginMethodBadgeText(meta.loginMethod))}`}
              </Text>
            </VStack>
          </HStack>

          <TextField
            title={localize("显示名称")}
            value={displayName}
            prompt={localize(meta.displayName)}
            keyboardType="default"
            onChanged={setDisplayName}
          />

          <TextField
            title={localize("小组件序号")}
            value={widgetOrder}
            prompt={localize("可选排序数字 (用于同供应商合并展示，如 1, 2...)")}
            keyboardType="numberPad"
            onChanged={setWidgetOrder}
          />

          <Toggle
            title={localize("参与全局一键刷新")}
            value={isEnabled}
            onChanged={setIsEnabled}
          />
        </Section>

        {meta.requiresGatewayAddress ? (
          <Section header={<Text>{localize("网关地址")}</Text>}>
            <TextField
              title={localize("服务器地址")}
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
            header={<Text>{localize("API 凭据")}</Text>}
            footer={
              <Text>
                {localize("点击密钥区域即可复制完整密钥；默认以掩码保护，点击右侧按钮可切换明文")}</Text>
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
                        {localize(meta.credentialLabel || "API 密钥")}
                      </Text>
                      <Text font="caption2" foregroundStyle="accentColor">
                        {localize("(点击复制)")}</Text>
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
                    {localize(isApiKeyRevealed ? "隐藏" : "查看")}
                  </Text>
                </HStack>
              </Button>
            </HStack>
          </Section>
        ) : null}

        <Section
          header={<Text>{localize("安全信封与凭证指纹")}</Text>}
          footer={
            <Text>
              {localize("当旋转密钥或变更网关地址时，SHA-256 指纹会自动更新并立即淘汰旧额度快照")}</Text>
          }
        >
          <LabeledContent
            title={localize("凭证存储位置")}
            value={
              localize(isDemoMode
                ? "演示内存沙箱"
                : account.preferssynchronizableKeychain
                  ? "iCloud 钥匙串"
                  : "本机钥匙串 (Keychain)")
            }
          />
          {!isDemoMode ? (
            <LabeledContent
              title={localize("钥匙串 UID (键名)")}
              value={account.credentialKeychainKey}
            />
          ) : null}
          <LabeledContent title={localize("SHA-256 指纹前缀")} value={fingerprintPreview} />
          {snapshot?.accountIdentity ? (
            <LabeledContent
              title={localize("远端身份标识")}
              value={isDemoMode ? localize(snapshot.accountIdentity) : snapshot.accountIdentity}
            />
          ) : null}
          {snapshot?.providerPlanName ? (
            <LabeledContent
              title={localize("订阅套餐层级")}
              value={localize(snapshot.providerPlanName)}
            />
          ) : null}
        </Section>

        {!isDemoMode ? (
          <Section
            header={<Text>{localize("更新 / 重新获取凭证 (可选)")}</Text>}
            footer={<Text>{localize("留空则保留当前钥匙串中的原凭证不变")}</Text>}
          >
            {isGoogleOAuth ? (
              <FormActionButtonRow>
                <Button
                  buttonStyle={adaptiveProminentButtonStyle()}
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  alignmentGuide={{ alignment: "leading", value: 0 }}
                  disabled={isPresentingBuiltInBrowser}
                  action={handleGoogleOAuthRelogin}
                >
                  <HStack
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    alignment="center"
                    spacing={8}
                    padding={{ vertical: 2 }}
                  >
                    <Image systemName="sparkles.tv.fill" font="subheadline" />
                    <Text
                      font="subheadline"
                      fontWeight="semibold"
                      lineLimit={isEnglish ? undefined : 1}
                      multilineTextAlignment="center"
                    >
                      {localize(isPresentingBuiltInBrowser
                        ? "正在等待授权…"
                        : "Google 重新登录授权")}
                    </Text>
                  </HStack>
                </Button>
              </FormActionButtonRow>
            ) : null}

            {isTraeAuth ? (
              <FormActionButtonRow>
                <Button
                  buttonStyle={adaptiveProminentButtonStyle()}
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  alignmentGuide={{ alignment: "leading", value: 0 }}
                  disabled={isPresentingBuiltInBrowser}
                  action={handleTraeRelogin}
                >
                  <HStack
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    alignment="center"
                    spacing={8}
                    padding={{ vertical: 2 }}
                  >
                    <Image
                      systemName="person.badge.key.fill"
                      font="subheadline"
                    />
                    <Text
                      font="subheadline"
                      fontWeight="semibold"
                      lineLimit={isEnglish ? undefined : 1}
                      multilineTextAlignment="center"
                    >
                      {localize(isPresentingBuiltInBrowser
                        ? "正在等待登录…"
                        : "Trae 重新登录授权")}
                    </Text>
                  </HStack>
                </Button>
              </FormActionButtonRow>
            ) : null}

            {isCodexAuth ? (
              <>
                <FormActionButtonRow>
                  <Button
                    buttonStyle={adaptiveProminentButtonStyle()}
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    alignmentGuide={{ alignment: "leading", value: 0 }}
                    disabled={isPresentingBuiltInBrowser}
                    action={handleCodexWebRelogin}
                  >
                    <HStack
                      frame={{ maxWidth: "infinity", alignment: "center" }}
                      alignment="center"
                      spacing={8}
                      padding={{ vertical: 2 }}
                    >
                      <Image
                        systemName="person.crop.circle.badge.checkmark"
                        font="subheadline"
                      />
                      <Text
                        font="subheadline"
                        fontWeight="semibold"
                        lineLimit={isEnglish ? undefined : 1}
                        multilineTextAlignment="center"
                      >
                        {localize(isPresentingBuiltInBrowser
                          ? "正在等待登录…"
                          : "OpenAI 网页重新登录授权 (推荐)")}
                      </Text>
                    </HStack>
                  </Button>
                </FormActionButtonRow>

                <FormActionButtonRow>
                  <Button
                    buttonStyle={adaptiveSecondaryButtonStyle()}
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    alignmentGuide={{ alignment: "leading", value: 0 }}
                    matchedTransitionSource={
                      props.zoomNamespace
                        ? {
                            id: `account-reauth-${account.id}`,
                            namespace: props.zoomNamespace,
                          }
                        : undefined
                    }
                    action={() => setIsDeviceLoginPresented(true)}
                  >
                    <HStack
                      frame={{ maxWidth: "infinity", alignment: "center" }}
                      alignment="center"
                      spacing={8}
                      padding={{ vertical: 2 }}
                    >
                      <Image
                        systemName="qrcode.viewfinder"
                        font="subheadline"
                      />
                      <Text
                        font="subheadline"
                        fontWeight="medium"
                        lineLimit={isEnglish ? undefined : 1}
                        multilineTextAlignment="center"
                      >
                        {localize("设备码重新授权登录 (CLI 方式)")}</Text>
                    </HStack>
                  </Button>
                </FormActionButtonRow>
              </>
            ) : null}

            {!isCodexAuth && supportsDeviceOrPollFlow ? (
              <FormActionButtonRow>
                <Button
                  buttonStyle={adaptiveProminentButtonStyle()}
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  alignmentGuide={{ alignment: "leading", value: 0 }}
                  matchedTransitionSource={
                    props.zoomNamespace
                      ? {
                          id: `account-reauth-${account.id}`,
                          namespace: props.zoomNamespace,
                        }
                      : undefined
                  }
                  action={() => setIsDeviceLoginPresented(true)}
                >
                  <HStack
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    alignment="center"
                    spacing={8}
                    padding={{ vertical: 2 }}
                  >
                    <Image
                      systemName={
                        isTrueDeviceCode
                          ? "qrcode.viewfinder"
                          : "person.badge.key.fill"
                      }
                      font="subheadline"
                    />
                    <Text
                      font="subheadline"
                      fontWeight="semibold"
                      lineLimit={isEnglish ? undefined : 1}
                      multilineTextAlignment="center"
                    >
                      {localize(isTrueDeviceCode ? "设备码重新授权登录" : "重新登录授权")}
                    </Text>
                  </HStack>
                </Button>
              </FormActionButtonRow>
            ) : null}

            {supportsWebViewFlow ? (
              <FormActionButtonRow>
                <Button
                  buttonStyle={
                    isCodexAuth || supportsDeviceOrPollFlow
                      ? adaptiveSecondaryButtonStyle()
                      : adaptiveProminentButtonStyle()
                  }
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  alignmentGuide={{ alignment: "leading", value: 0 }}
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
                      lineLimit={isEnglish ? undefined : 1}
                      multilineTextAlignment="center"
                    >
                      {localize(isReauthenticating ? "正在登录…" : "网页重新登录授权")}
                    </Text>
                  </HStack>
                </Button>
              </FormActionButtonRow>
            ) : null}

            <FormActionButtonRow>
              <Button
                buttonStyle={adaptiveSecondaryButtonStyle()}
                frame={{ maxWidth: "infinity", alignment: "center" }}
                alignmentGuide={{ alignment: "leading", value: 0 }}
                action={handleImportFromKeychain}
              >
                <HStack
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  alignment="center"
                  spacing={8}
                  padding={{ vertical: 2 }}
                >
                  <Image systemName="key.fill" font="subheadline" />
                  <Text
                    font="subheadline"
                    fontWeight="medium"
                    lineLimit={isEnglish ? undefined : 1}
                    multilineTextAlignment="center"
                  >
                    {localize("从钥匙串导入新凭据")}</Text>
                </HStack>
              </Button>
            </FormActionButtonRow>

            <TextField
              title={localize(meta.credentialLabel)}
              value={newCredentialInput}
              prompt={localize("输入新密钥或令牌以覆盖旧凭证")}
              keyboardType="default"
              autocorrectionDisabled={true}
              textInputAutocapitalization="never"
              onChanged={setNewCredentialInput}
            />

            <Button
              title={localize("从剪贴板粘贴新凭证")}
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
          </Section>
        ) : null}

        {account.provider === "codex" &&
        codexResetStatus &&
        hasVisibleCodexResetPreview(codexResetStatus) ? (
          <Section
            header={<Text>{localize("Codex 重置预告 (第三方源)")}</Text>}
            footer={
              <Text>
                {localize("数据来源于 codex-resets.com 公开状态流，结合社区 AI 概率模型预测，非官方保证。")}</Text>
            }
          >
            {codexResetStatus.data.scheduledReset ? (
              <LabeledContent
                title={localize("预定重置时间")}
                value={
                  localize(codexResetStatus.data.scheduledReset.scheduledFor
                    ? `${formatCodexResetLocalTime(codexResetStatus.data.scheduledReset.scheduledFor)} · 北京时间 (${formatScheduledResetHeadline(codexResetStatus.data.scheduledReset.scheduledFor)})`
                    : "时间待定")
                }
              />
            ) : null}
            {codexResetStatus.data.scheduledReset?.text ? (
              <LabeledContent
                title={localize("公告内容")}
                value={localize(codexResetStatus.data.scheduledReset.text)}
              />
            ) : null}
            {codexResetStatus.data.activeWatch ? (
              <LabeledContent
                title={localize("AI 预测概率")}
                value={
                  codexResetStatus.data.activeWatch.resetChancePercent != null
                    ? `${codexResetStatus.data.activeWatch.resetChancePercent}% (${codexResetStatus.data.activeWatch.forecastWindow})`
                    : codexResetStatus.data.activeWatch.forecastWindow
                }
              />
            ) : null}
            {codexResetStatus.data.latestReset?.announcedAt ? (
              <LabeledContent
                title={localize("上次重置记录")}
                value={formatCodexResetLocalTime(
                  codexResetStatus.data.latestReset.announcedAt
                )}
              />
            ) : null}
          </Section>
        ) : null}

        {snapshot ? (
          <Section
            header={<Text>{`${localize("最新采集额度明细")} (${snapshot.windows.length})`}</Text>}
            footer={
              <Text>
                {localize(`采集时间：${formatShortDateTime(snapshot.collectedAt) ?? snapshot.collectedAt}`)}
              </Text>
            }
          >
            {snapshot.windows.map((win) => {
              if (win.wallet) {
                return (
                  <LabeledContent
                    key={win.id}
                    title={localize(win.name)}
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
                    <Text font="subheadline">{localize(formatWindowTitle(win))}</Text>
                    <Spacer />
                    <Text
                      font="caption"
                      fontWeight="semibold"
                      monospacedDigit={true}
                      foregroundStyle={
                        win.isUnlimited ? "systemGreen" : statusColor
                      }
                    >
                      {localize(breakdown.primaryRemainingText)}
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
                    {localize(breakdown.secondaryUsedText)}
                  </Text>
                </VStack>
              )
            })}
          </Section>
        ) : null}

        {errorMessage ? (
          <Section header={<Text>{localize("提示")}</Text>}>
            <Text foregroundStyle="systemRed">{localize(errorMessage)}</Text>
          </Section>
        ) : null}

        <Section>
          <Button
            title={localize("立即刷新此账号额度")}
            systemImage="arrow.clockwise"
            action={() => {
              onRefreshAccount(account)
              onClose()
            }}
          />

          <Button
            title={localize("删除此账号")}
            systemImage="trash"
            role="destructive"
            action={() => setIsDeleteConfirmPresented(true)}
          />
        </Section>
      </Form>
  )

  if (props.embedded) {
    return formContent
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
                {localize(toastMessage)}
              </Text>
            </HStack>
          </VStack>
        ) : undefined
      }
    >
      {formContent}
    </NavigationStack>
  )
}
