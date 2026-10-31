import {
  Button,
  Capsule,
  DisclosureGroup,
  Divider,
  Form,
  HStack,
  Image,
  LabeledContent,
  List,
  NavigationStack,
  Picker,
  SecureField,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"
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
  ProviderCredentialEnvelope,
  ProviderId,
  ProviderMeta,
  ProviderRouteCategory,
  SubscriptionAccount,
} from "../models/types"
import {
  buildCredentialEnvelope,
  generateAccountKeychainKey,
  loadStoredAccounts,
  saveEnvelopeToKeychain,
} from "../utils/credential_store"
import {
  getProviderMeta,
  groupProvidersAlphabetically,
  searchProviders,
} from "../utils/providers_catalog"
import {
  adaptiveProminentButtonStyle,
  adaptiveSecondaryButtonStyle,
  loginMethodBadgeText,
  routeCategoryTitle,
} from "../utils/theme"
import { ProviderIconView } from "./ProviderIconView"
import { DeviceCodeLoginSheet } from "./DeviceCodeLoginSheet"


export function AddAccountSheet(props: {
  initialProviderId?: ProviderId
  defaultSynchronizable: boolean
  startWithPicker?: boolean
  embedded?: boolean
  isPushed?: boolean
  zoomNamespace?: any
  navigationTransition?: { type: "zoom"; sourceID: string | number; namespace: any }
  onCancel: () => void
  onAccountCreated: (
    account: SubscriptionAccount,
    envelope: ProviderCredentialEnvelope
  ) => void
}) {
  const {
    initialProviderId,
    defaultSynchronizable,
    startWithPicker = false,
    onCancel,
    onAccountCreated,
  } = props

  const [isPickingProvider, setIsPickingProvider] =
    useState<boolean>(startWithPicker)
  const [selectedProviderId, setSelectedProviderId] =
    useState<ProviderId>(initialProviderId ?? "deepSeek")
  const [hasUserSelectedProvider, setHasUserSelectedProvider] =
    useState<boolean>(Boolean(initialProviderId && !startWithPicker))
  const meta = useMemo(
    () => getProviderMeta(selectedProviderId),
    [selectedProviderId]
  )

  const [displayName, setDisplayName] = useState<string>("")
  const [serverAddress, setServerAddress] = useState<string>("")
  const [selectedRegion, setSelectedRegion] = useState<string>(
    meta.regions?.[0]?.id ?? "cn"
  )
  const [rawCredential, setRawCredential] = useState<string>("")
  const [showPlainCredential, setShowPlainCredential] = useState<boolean>(false)
  const [synchronizable, setSynchronizable] = useState<boolean>(
    defaultSynchronizable
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPresentingBuiltInBrowser, setIsPresentingBuiltInBrowser] =
    useState<boolean>(false)

  // 子 Sheet 控制：设备码登录
  const [isDeviceLoginPresented, setIsDeviceLoginPresented] =
    useState<boolean>(false)
  const isEmbeddedPickerFlow = Boolean(props.embedded && startWithPicker)

  useEffect(() => {
    if (initialProviderId) {
      setSelectedProviderId(initialProviderId)
      setHasUserSelectedProvider(true)
      const nextMeta = getProviderMeta(initialProviderId)
      if (nextMeta.regions && nextMeta.regions.length > 0) {
        setSelectedRegion(nextMeta.regions[0].id)
      }
    }
    setDisplayName("")
    setServerAddress("")
    setRawCredential("")
    setErrorMessage(null)
  }, [initialProviderId])

  useEffect(() => {
    setIsPickingProvider(startWithPicker)
  }, [startWithPicker])

  const isWorkBuddyGlobal =
    selectedProviderId === "workBuddy" && selectedRegion === "global"
  const defaultDisplayName = isWorkBuddyGlobal
    ? "Workbuddy AI"
    : meta.displayName

  const handleSelectProvider = (newId: ProviderId) => {
    setSelectedProviderId(newId)
    setHasUserSelectedProvider(true)
    const nextMeta = getProviderMeta(newId)
    if (nextMeta.regions && nextMeta.regions.length > 0) {
      setSelectedRegion(nextMeta.regions[0].id)
    }
    setDisplayName("")
    setServerAddress("")
    setRawCredential("")
    setErrorMessage(null)
    setIsPickingProvider(false)
  }

  const handlePasteClipboard = async () => {
    const text = await Pasteboard.getString()
    if (text && text.trim()) {
      setRawCredential(text.trim())
      HapticFeedback.lightImpact()
    }
  }

  const handleImportFromKeychain = async () => {
    try {
      const picked = await Keychain.pick({
        title: "从钥匙串导入",
        prompt: `选择已保存在钥匙串中的 ${meta.displayName} 凭据或 API 密钥`,
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
          setRawCredential(parsed.accessToken.trim())
          if (parsed.metadata?.serverAddress && meta.requiresGatewayAddress) {
            setServerAddress(parsed.metadata.serverAddress)
          }
          if (parsed.metadata?.region && meta.requiresRegion) {
            setSelectedRegion(parsed.metadata.region)
          }
          if (parsed.metadata?.displayName && !displayName.trim()) {
            setDisplayName(parsed.metadata.displayName)
          }
          HapticFeedback.notificationSuccess()
          setErrorMessage(null)
          return
        }
      } catch {
        // 非 JSON 格式，直接按原生 API Key / Token 填入
      }

      setRawCredential(trimmed)
      HapticFeedback.notificationSuccess()
      setErrorMessage(null)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "从钥匙串导入失败")
      HapticFeedback.notificationError()
    }
  }

  const finalizeAccountWithEnvelope = (
    envelope: ProviderCredentialEnvelope
  ) => {
    const accountId = UUID.string()
    const effectiveRegion = meta.requiresRegion
      ? selectedRegion
      : envelope.metadata.region
    const isWbGlobal =
      selectedProviderId === "workBuddy" && effectiveRegion === "global"
    const fallbackName = isWbGlobal ? "Workbuddy AI" : defaultDisplayName
    const finalName =
      displayName.trim() ||
      (envelope.metadata.displayName
        ? `${fallbackName} (${envelope.metadata.displayName})`
        : fallbackName)

    const existingAccounts = loadStoredAccounts()
    const keychainKey = generateAccountKeychainKey({
      provider: selectedProviderId,
      accountId,
      displayName: finalName,
      envelope,
      existingAccounts,
    })

    const saved = saveEnvelopeToKeychain(keychainKey, envelope, synchronizable)
    if (!saved) {
      setErrorMessage("写入系统钥匙串 (Keychain) 失败，请检查权限")
      HapticFeedback.notificationError()
      return
    }
    const newAccount: SubscriptionAccount = {
      id: accountId,
      provider: selectedProviderId,
      displayName: finalName,
      credentialKeychainKey: keychainKey,
      createdAt: new Date().toISOString(),
      isEnabled: true,
      preferssynchronizableKeychain: synchronizable,
      serverAddress: envelope.metadata.serverAddress,
      region: effectiveRegion,
    }
    HapticFeedback.notificationSuccess()
    onAccountCreated(newAccount, envelope)
  }

  const handleSaveManual = () => {
    try {
      setErrorMessage(null)
      const envelope = buildCredentialEnvelope({
        provider: selectedProviderId,
        rawInput: rawCredential,
        serverAddress: meta.requiresGatewayAddress ? serverAddress : undefined,
        region: meta.requiresRegion ? selectedRegion : undefined,
      })
      finalizeAccountWithEnvelope(envelope)
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "凭证校验未通过，请检查输入格式"
      )
      HapticFeedback.notificationError()
    }
  }

  /**
   * 调用内置浏览器完成登录并在关闭窗口时自动提取 Auth Cookie
   */
  const handleBuiltInBrowserWebLogin = async () => {
    if (isPresentingBuiltInBrowser || !meta.webSessionProfile) return
    setIsPresentingBuiltInBrowser(true)
    setErrorMessage(null)
    const controller = new WebViewController({ ephemeral: true })
    try {
      void controller.loadURL(meta.webSessionProfile.loginURL)
      await controller.present({
        navigationTitle: `登录 ${meta.displayName}`,
        fullscreen: false,
      })
      const envelope = await extractWebSessionFromController(
        selectedProviderId,
        controller
      )
      finalizeAccountWithEnvelope(envelope)
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "未检测到有效登录状态，请确认已在页面内完成登录"
      )
      HapticFeedback.notificationError()
    } finally {
      controller.dispose()
      setIsPresentingBuiltInBrowser(false)
    }
  }

  /**
   * Google OAuth 网页授权（适用于 Antigravity 和 Gemini）
   */
  const handleGoogleOAuthWebLogin = async () => {
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
        navigationTitle: "Google 授权登录",
        fullscreen: false,
      })
      if (capturedCode) {
        const tokenResult = await exchangeAntigravityCode(capturedCode)
        const envelope: ProviderCredentialEnvelope = {
          provider: selectedProviderId,
          kind: "oauth",
          accessToken: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken,
          expiresAt: new Date(
            Date.now() + tokenResult.expiresIn * 1000
          ).toISOString(),
          metadata: {
            accountEmail: tokenResult.email,
          },
        }
        finalizeAccountWithEnvelope(envelope)
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

  /**
   * TRAE 网页 OAuth 授权（适用于 TRAE 中国站 / 国际站）
   */
  const handleTraeWebLogin = async () => {
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

    const authPlan = buildTraeAuthURL(selectedRegion)
    try {
      void controller.loadURL(authPlan.url)
      await controller.present({
        navigationTitle: `登录 TRAE (${selectedRegion === "global" ? "国际站" : "中国站"})`,
        fullscreen: false,
      })
      if (capturedRefreshToken) {
        const exchanged = await exchangeTraeToken(
          capturedRefreshToken,
          selectedRegion,
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
            region: selectedRegion,
            machineId: authPlan.machineId,
            deviceId: authPlan.deviceId,
            uid: capturedUid,
          },
        }
        finalizeAccountWithEnvelope(envelope)
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

  /**
   * OpenAI Codex 官方网页 OAuth 授权 (PKCE Flow)
   */
  const handleCodexWebLogin = async () => {
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
        navigationTitle: "OpenAI 授权登录",
        fullscreen: false,
      })
      if (capturedCode) {
        const tokenResult = await exchangeCodexWebOAuthCode(
          capturedCode,
          authPlan.codeVerifier
        )
        const extraMetadata: Record<string, string> = {}
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
        finalizeAccountWithEnvelope(envelope)
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

  const isGoogleOAuth =
    selectedProviderId === "antigravity" || selectedProviderId === "gemini"
  const isTraeAuth = selectedProviderId === "trae"
  const isCodexAuth = selectedProviderId === "codex"
  const supportsDeviceOrPollFlow =
    meta.loginMethod === "deviceCode" ||
    meta.id === "codex" ||
    meta.id === "cursor" ||
    meta.id === "grokBot" ||
    meta.id === "workBuddy" ||
    meta.id === "qoder" ||
    meta.id === "zhipu"

  const isTrueDeviceCode =
    selectedProviderId === "copilot" || selectedProviderId === "kimiCode"

  const supportsWebViewFlow = Boolean(meta.webSessionProfile)
  const hasAnyOnlineFlow =
    isGoogleOAuth ||
    isTraeAuth ||
    isCodexAuth ||
    supportsDeviceOrPollFlow ||
    supportsWebViewFlow

  const formContent = (
    <Form
      navigationTitle="添加 AI 供应商"
      navigationBarTitleDisplayMode="inline"
      navigationTransition={props.navigationTransition}
      toolbar={{
        cancellationAction: (props.embedded || props.isPushed) ? undefined : (
          <Button
            title={startWithPicker ? "选择供应商" : "取消"}
            systemImage={startWithPicker ? "chevron.left" : undefined}
            action={
              startWithPicker
                ? () => {
                    setIsPickingProvider(true)
                    setHasUserSelectedProvider(false)
                  }
                : onCancel
            }
          />
        ),
        confirmationAction: (
          <Button
            title="保存"
            disabled={!rawCredential.trim()}
            action={handleSaveManual}
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
                  provider={selectedProviderId}
                  region={selectedRegion}
                  embedded={true}
                  navigationTransition={
                    props.zoomNamespace
                      ? {
                          type: "zoom",
                          sourceID: "add-account-device-oauth",
                          namespace: props.zoomNamespace,
                        }
                      : undefined
                  }
                  onCancel={() => setIsDeviceLoginPresented(false)}
                  onCompleted={(envelope) => {
                    setIsDeviceLoginPresented(false)
                    finalizeAccountWithEnvelope(envelope)
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
                  provider={selectedProviderId}
                  region={selectedRegion}
                  onCancel={() => setIsDeviceLoginPresented(false)}
                  onCompleted={(envelope) => {
                    setIsDeviceLoginPresented(false)
                    finalizeAccountWithEnvelope(envelope)
                  }}
                />
              ),
            }
      }
    >
        <Section header={<Text>服务提供商</Text>}>
          <HStack alignment="center" spacing={12}>
            <ProviderIconView provider={selectedProviderId} size={40} />
            <VStack alignment="leading" spacing={2}>
              <Text font="headline" foregroundStyle="label" lineLimit={1}>
                {meta.displayName}
              </Text>
              <Text
                font="caption"
                foregroundStyle="secondaryLabel"
                lineLimit={1}
              >
                {`${routeCategoryTitle(meta.routeCategory)} · ${loginMethodBadgeText(meta.loginMethod)}`}
              </Text>
            </VStack>
            <Spacer />
            {!props.embedded ? (
              <Button
                buttonStyle="plain"
                action={() => setIsPickingProvider(true)}
              >
                <HStack spacing={4}>
                  <Text font="subheadline" foregroundStyle="secondaryLabel">
                    更换
                  </Text>
                  <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" />
                </HStack>
              </Button>
            ) : null}
          </HStack>

          <TextField
            title="备注名称"
            value={displayName}
            prompt={`默认：${defaultDisplayName}`}
            onChanged={setDisplayName}
          />
        </Section>

        {meta.requiresGatewayAddress ? (
          <Section
            header={<Text>网关地址</Text>}
            footer={
              <Text>
                远程网关要求 HTTPS 协议（仅 localhost / 127.0.0.1 允许 HTTP）
              </Text>
            }
          >
            <TextField
              title="服务器地址"
              value={serverAddress}
              prompt={`https://api.example.com:${meta.gatewayDefaultPort ?? "3000"}`}
              keyboardType="URL"
              textInputAutocapitalization="never"
              autocorrectionDisabled={true}
              onChanged={setServerAddress}
            />
          </Section>
        ) : null}

        {meta.requiresRegion && meta.regions ? (
          <Section header={<Text>服务地域</Text>}>
            <Picker
              title="接入地域"
              value={selectedRegion}
              onChanged={setSelectedRegion}
            >
              {meta.regions.map((reg) => (
                <Text key={reg.id} tag={reg.id}>
                  {reg.label}
                </Text>
              ))}
            </Picker>
          </Section>
        ) : null}

        {hasAnyOnlineFlow ? (
          <Section header={<Text>在线登录授权</Text>}>
            <VStack
              alignment="leading"
              spacing={10}
              listRowSeparator="hidden"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {isGoogleOAuth ? (
                <Button
                  buttonStyle={adaptiveProminentButtonStyle()}
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  disabled={isPresentingBuiltInBrowser}
                  action={handleGoogleOAuthWebLogin}
                >
                  <HStack
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    alignment="center"
                    spacing={8}
                    padding={{ vertical: 4 }}
                  >
                    <Image systemName="sparkles.tv.fill" font="subheadline" />
                    <Text
                      font="subheadline"
                      fontWeight="semibold"
                      lineLimit={1}
                      multilineTextAlignment="center"
                    >
                      {isPresentingBuiltInBrowser
                        ? "正在等待授权…"
                        : "Google 网页登录授权"}
                    </Text>
                  </HStack>
                </Button>
              ) : null}

              {isTraeAuth ? (
                <Button
                  buttonStyle={adaptiveProminentButtonStyle()}
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  disabled={isPresentingBuiltInBrowser}
                  action={handleTraeWebLogin}
                >
                  <HStack
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    alignment="center"
                    spacing={8}
                    padding={{ vertical: 4 }}
                  >
                    <Image
                      systemName="person.badge.key.fill"
                      font="subheadline"
                    />
                    <Text
                      font="subheadline"
                      fontWeight="semibold"
                      lineLimit={1}
                      multilineTextAlignment="center"
                    >
                      {isPresentingBuiltInBrowser
                        ? "正在等待登录…"
                        : "Trae 网页登录授权"}
                    </Text>
                  </HStack>
                </Button>
              ) : null}

              {isCodexAuth ? (
                <>
                  <Button
                    buttonStyle={adaptiveProminentButtonStyle()}
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    disabled={isPresentingBuiltInBrowser}
                    action={handleCodexWebLogin}
                  >
                    <HStack
                      frame={{ maxWidth: "infinity", alignment: "center" }}
                      alignment="center"
                      spacing={8}
                      padding={{ vertical: 4 }}
                    >
                      <Image
                        systemName="person.crop.circle.badge.checkmark"
                        font="subheadline"
                      />
                      <Text
                        font="subheadline"
                        fontWeight="semibold"
                        lineLimit={1}
                        multilineTextAlignment="center"
                      >
                        {isPresentingBuiltInBrowser
                          ? "正在等待登录…"
                          : "OpenAI 网页登录授权 (推荐)"}
                      </Text>
                    </HStack>
                  </Button>

                  <Divider />

                  <Button
                    buttonStyle={adaptiveSecondaryButtonStyle()}
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    matchedTransitionSource={
                      props.zoomNamespace
                        ? {
                            id: "add-account-device-oauth",
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
                      padding={{ vertical: 4 }}
                    >
                      <Image
                        systemName="qrcode.viewfinder"
                        font="subheadline"
                      />
                      <Text
                        font="subheadline"
                        fontWeight="medium"
                        lineLimit={1}
                        multilineTextAlignment="center"
                      >
                        设备码授权登录 (CLI 方式)
                      </Text>
                    </HStack>
                  </Button>
                </>
              ) : null}

              {!isCodexAuth && supportsDeviceOrPollFlow ? (
                <Button
                  buttonStyle={adaptiveProminentButtonStyle()}
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  matchedTransitionSource={
                    props.zoomNamespace
                      ? {
                          id: "add-account-device-oauth",
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
                    padding={{ vertical: 4 }}
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
                      lineLimit={1}
                      multilineTextAlignment="center"
                    >
                      {isTrueDeviceCode ? "设备码授权登录" : "网页登录授权"}
                    </Text>
                  </HStack>
                </Button>
              ) : null}

              {(isCodexAuth || supportsDeviceOrPollFlow) && supportsWebViewFlow ? (
                <Divider />
              ) : null}

              {supportsWebViewFlow ? (
                <Button
                  buttonStyle={
                    isCodexAuth || supportsDeviceOrPollFlow
                      ? adaptiveSecondaryButtonStyle()
                      : adaptiveProminentButtonStyle()
                  }
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  disabled={isPresentingBuiltInBrowser}
                  action={handleBuiltInBrowserWebLogin}
                >
                  <HStack
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    alignment="center"
                    spacing={8}
                    padding={{ vertical: 4 }}
                  >
                    <Image
                      systemName="person.badge.key.fill"
                      font="subheadline"
                    />
                    <Text
                      font="subheadline"
                      fontWeight="semibold"
                      lineLimit={1}
                      multilineTextAlignment="center"
                    >
                      {isPresentingBuiltInBrowser
                        ? "正在等待登录完成…"
                        : "网页登录获取凭证"}
                    </Text>
                  </HStack>
                </Button>
              ) : null}

              <Divider />

              <Button
                buttonStyle={adaptiveSecondaryButtonStyle()}
                frame={{ maxWidth: "infinity", alignment: "center" }}
                action={handleImportFromKeychain}
              >
                <HStack
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  alignment="center"
                  spacing={8}
                  padding={{ vertical: 4 }}
                >
                  <Image systemName="key.fill" font="subheadline" />
                  <Text
                    font="subheadline"
                    fontWeight="medium"
                    lineLimit={1}
                    multilineTextAlignment="center"
                  >
                    从钥匙串导入凭据
                  </Text>
                </HStack>
              </Button>
            </VStack>
          </Section>
        ) : (
          <Section header={<Text>登录与凭据导入</Text>}>
            <VStack
              alignment="leading"
              spacing={10}
              listRowSeparator="hidden"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              <Button
                buttonStyle={adaptiveSecondaryButtonStyle()}
                frame={{ maxWidth: "infinity", alignment: "center" }}
                action={handleImportFromKeychain}
              >
                <HStack
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  alignment="center"
                  spacing={8}
                  padding={{ vertical: 4 }}
                >
                  <Image systemName="key.fill" font="subheadline" />
                  <Text
                    font="subheadline"
                    fontWeight="medium"
                    lineLimit={1}
                    multilineTextAlignment="center"
                  >
                    从钥匙串导入凭据
                  </Text>
                </HStack>
              </Button>
            </VStack>
          </Section>
        )}

        <Section
          header={<Text>{meta.credentialLabel}</Text>}
          footer={
            meta.credentialHelp ? <Text>{meta.credentialHelp}</Text> : undefined
          }
        >
          {showPlainCredential ? (
            <TextField
              title={meta.credentialLabel}
              value={rawCredential}
              prompt={meta.credentialPrompt}
              textInputAutocapitalization="never"
              autocorrectionDisabled={true}
              onChanged={setRawCredential}
            />
          ) : (
            <SecureField
              title={meta.credentialLabel}
              value={rawCredential}
              prompt={meta.credentialPrompt}
              onChanged={setRawCredential}
            />
          )}

          <HStack>
            <Button
              title="粘贴剪贴板"
              systemImage="doc.on.clipboard"
              buttonStyle="borderless"
              action={handlePasteClipboard}
            />
            <Spacer />
            <Button
              title={showPlainCredential ? "隐藏明文" : "显示明文"}
              systemImage={showPlainCredential ? "eye.slash" : "eye"}
              buttonStyle="borderless"
              action={() => setShowPlainCredential(!showPlainCredential)}
            />
          </HStack>
        </Section>

        <Section header={<Text>钥匙串同步</Text>}>
          <Toggle
            title="允许 iCloud 钥匙串同步"
            value={synchronizable}
            onChanged={setSynchronizable}
          />
        </Section>

        {errorMessage ? (
          <Section header={<Text>提示</Text>}>
            <Text foregroundStyle="systemRed">{errorMessage}</Text>
          </Section>
        ) : null}
      </Form>
  )

  if (isEmbeddedPickerFlow) {
    return (
      <ProviderPickerSheet
        selectedId={selectedProviderId}
        embedded={true}
        zoomNamespace={props.zoomNamespace}
        navigationTransition={props.navigationTransition}
        onAccountCreated={onAccountCreated}
        onSelect={handleSelectProvider}
        onClose={onCancel}
      />
    )
  }

  if (isPickingProvider) {
    return (
      <ProviderPickerSheet
        selectedId={hasUserSelectedProvider ? selectedProviderId : null}
        embedded={props.embedded}
        zoomNamespace={props.zoomNamespace}
        navigationTransition={props.navigationTransition}
        onSelect={handleSelectProvider}
        onClose={onCancel}
      />
    )
  }

  if (props.embedded || props.isPushed) {
    return formContent
  }

  return <NavigationStack>{formContent}</NavigationStack>
}

export function ProviderPickerSheet(props: {
  selectedId?: ProviderId | null
  embedded?: boolean
  zoomNamespace?: any
  navigationTransition?: { type: "zoom"; sourceID: string | number; namespace: any }
  onAccountCreated?: (
    account: SubscriptionAccount,
    envelope: ProviderCredentialEnvelope
  ) => void
  onSelect: (id: ProviderId) => void
  onClose: () => void
}) {
  const { selectedId, onSelect, onClose, onAccountCreated, embedded = false } = props
  const [searchText, setSearchText] = useState<string>("")
  const [routeFilter, setRouteFilter] = useState<
    ProviderRouteCategory | "all"
  >("all")
  const [selectedProviderForForm, setSelectedProviderForForm] = useState<{
    provider: ProviderId
    nonce: number
  } | null>(null)

  const filteredProviders = useMemo(
    () => searchProviders(searchText, routeFilter),
    [searchText, routeFilter]
  )
  const grouped = useMemo(
    () => groupProvidersAlphabetically(filteredProviders),
    [filteredProviders]
  )

  const handleAddProvider = (providerId: ProviderId) => {
    setSelectedProviderForForm({
      provider: providerId,
      nonce: Date.now(),
    })
  }

  const listContent = (
    <List
      navigationTitle={`选择供应商 (${filteredProviders.length})`}
      navigationBarTitleDisplayMode="inline"
      navigationTransition={embedded ? props.navigationTransition : undefined}
      listStyle="insetGroup"
      listSectionIndexVisibility="automatic"
      searchable={{
        value: searchText,
        onChanged: setSearchText,
        prompt: "搜索 78 家 AI 供应商名称或域名",
      }}
      toolbar={{
        cancellationAction: embedded ? undefined : (
          <Button title="关闭" action={onClose} />
        ),
      }}
      navigationDestination={{
        isPresented: Boolean(selectedProviderForForm),
        onChanged: (open) => {
          if (!open) setSelectedProviderForForm(null)
        },
        content: selectedProviderForForm ? (
          <AddAccountSheet
            key={`add-form-${selectedProviderForForm.provider}-${selectedProviderForForm.nonce}`}
            initialProviderId={selectedProviderForForm.provider}
            defaultSynchronizable={false}
            startWithPicker={false}
            embedded={embedded}
            isPushed={true}
            zoomNamespace={props.zoomNamespace}
            navigationTransition={
              embedded && props.zoomNamespace
                ? {
                    type: "zoom",
                    sourceID: `picker-add-${selectedProviderForForm.provider}`,
                    namespace: props.zoomNamespace,
                  }
                : undefined
            }
            onCancel={() => setSelectedProviderForForm(null)}
            onAccountCreated={(account, envelope) => {
              setSelectedProviderForForm(null)
              onAccountCreated?.(account, envelope)
            }}
          />
        ) : (
          <Text> </Text>
        ),
      }}
    >
      <Section>
        <Picker
          title="接入路径筛选"
          value={routeFilter}
          onChanged={(v: string) =>
            setRouteFilter(v as ProviderRouteCategory | "all")
          }
        >
          <Text tag="all">全部路径 (78)</Text>
          <Text tag="direct_api">直连 API 密钥 (39)</Text>
          <Text tag="gateway">自建/聚合网关 (5)</Text>
          <Text tag="device_oauth">OAuth 设备码与轮询 (7)</Text>
          <Text tag="google_oauth">Google 原生 OAuth (2)</Text>
          <Text tag="web_session">Web 会话与工作台 (25)</Text>
        </Picker>
      </Section>

      {grouped.map((group) => (
        <Section
          key={group.letter}
          header={<Text>{group.letter}</Text>}
          sectionIndexLabel={group.letter}
        >
          {group.items.map((item: ProviderMeta) => (
            <DisclosureGroup
              key={item.id}
              label={
                <HStack alignment="center" spacing={12}>
                  <ProviderIconView provider={item.id} size={38} />
                  <VStack alignment="leading" spacing={3}>
                    <HStack spacing={6} alignment="center">
                      <Text font="headline" lineLimit={1}>
                        {item.displayName}
                      </Text>
                      <Text
                        font="caption2"
                        fontWeight="medium"
                        foregroundStyle="secondaryLabel"
                        padding={{ horizontal: 6, vertical: 1 }}
                        background={<Capsule fill="quaternarySystemFill" />}
                        lineLimit={1}
                      >
                        {loginMethodBadgeText(item.loginMethod)}
                      </Text>
                    </HStack>
                    <Text
                      font="caption"
                      foregroundStyle="secondaryLabel"
                      lineLimit={1}
                    >
                      {item.endpointSummary}
                    </Text>
                  </VStack>
                  <Spacer />
                  {selectedId === item.id ? (
                    <Image
                      systemName="checkmark"
                      font="subheadline"
                      fontWeight="semibold"
                      foregroundStyle="accentColor"
                    />
                  ) : null}
                </HStack>
              }
            >
              <VStack
                alignment="leading"
                spacing={10}
                padding={{ top: 8, bottom: 4 }}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                <LabeledContent
                  title="接入分类"
                  value={routeCategoryTitle(item.routeCategory)}
                />
                <LabeledContent
                  title="凭证类型"
                  value={item.credentialLabel}
                />
                <LabeledContent
                  title="认证机制"
                  value={item.authSummary}
                />
                <LabeledContent
                  title="直连端点"
                  value={item.endpointSummary}
                />

                {item.webSessionProfile ? (
                  <LabeledContent
                    title="Cookie 白名单"
                    value={item.webSessionProfile.cookieNames.join(", ")}
                  />
                ) : null}

                <Button
                  buttonStyle={adaptiveProminentButtonStyle()}
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  matchedTransitionSource={
                    embedded && props.zoomNamespace
                      ? {
                          id: `picker-add-${item.id}`,
                          namespace: props.zoomNamespace,
                        }
                      : undefined
                  }
                  action={() => handleAddProvider(item.id)}
                >
                  <HStack
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    alignment="center"
                    spacing={6}
                    padding={{ vertical: 2 }}
                  >
                    <Image systemName="plus.circle.fill" font="subheadline" />
                    <Text
                      font="subheadline"
                      fontWeight="semibold"
                      lineLimit={1}
                      multilineTextAlignment="center"
                    >
                      {`添加 ${item.displayName} 账号`}
                    </Text>
                  </HStack>
                </Button>
              </VStack>
            </DisclosureGroup>
          ))}
        </Section>
      ))}
    </List>
  )

  if (embedded) {
    return listContent
  }

  return <NavigationStack>{listContent}</NavigationStack>
}
