import {
  Button,
  Divider,
  Form,
  HStack,
  Image,
  LabeledContent,
  List,
  NavigationStack,
  Picker,
  ProgressView,
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
  beginDeviceOrPollLogin,
  buildAntigravityAuthURL,
  buildCodexWebAuthPlan,
  buildTraeAuthURL,
  exchangeAntigravityCode,
  exchangeCodexWebOAuthCode,
  exchangeTraeToken,
  extractWebSessionFromController,
  pollDeviceOrPollLogin,
} from "../services/provider_auth"
import {
  ProviderCredentialEnvelope,
  ProviderId,
  ProviderLoginSession,
  ProviderMeta,
  ProviderRouteCategory,
  SubscriptionAccount,
} from "../models/types"
import {
  buildCredentialEnvelope,
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


export function AddAccountSheet(props: {
  initialProviderId?: ProviderId
  defaultSynchronizable: boolean
  startWithPicker?: boolean
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

  const finalizeAccountWithEnvelope = (
    envelope: ProviderCredentialEnvelope
  ) => {
    const accountId = UUID.string()
    const keychainKey = `ai_dashboard.cred.${accountId}`
    const effectiveRegion = meta.requiresRegion
      ? selectedRegion
      : envelope.metadata.region
    const isWbGlobal =
      selectedProviderId === "workBuddy" && effectiveRegion === "global"
    const fallbackName = isWbGlobal ? "Workbuddy AI" : meta.displayName
    const finalName = displayName.trim() || fallbackName
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
    meta.id === "qoder"

  const isTrueDeviceCode =
    selectedProviderId === "copilot" || selectedProviderId === "kimiCode"

  const supportsWebViewFlow = Boolean(meta.webSessionProfile)
  const hasAnyOnlineFlow =
    isGoogleOAuth ||
    isTraeAuth ||
    isCodexAuth ||
    supportsDeviceOrPollFlow ||
    supportsWebViewFlow

  if (isPickingProvider) {
    return (
      <ProviderPickerSheet
        selectedId={hasUserSelectedProvider ? selectedProviderId : null}
        onSelect={handleSelectProvider}
        onClose={onCancel}
      />
    )
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="添加 AI 供应商"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: (
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
        sheet={{
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
        }}
      >
        <Section header={<Text>服务提供商</Text>}>
          <Button
            buttonStyle="plain"
            action={() => setIsPickingProvider(true)}
          >
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
              <Text font="subheadline" foregroundStyle="accentColor">
                更换
              </Text>
              <Image
                systemName="chevron.right"
                font="caption"
                foregroundStyle="tertiaryLabel"
              />
            </HStack>
          </Button>

          <TextField
            title="备注名称"
            value={displayName}
            prompt={`默认：${meta.displayName}`}
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
            </VStack>
          </Section>
        ) : null}

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
    </NavigationStack>
  )
}

export function ProviderPickerSheet(props: {
  selectedId?: ProviderId | null
  onSelect: (id: ProviderId) => void
  onClose: () => void
}) {
  const { selectedId, onSelect, onClose } = props
  const [searchText, setSearchText] = useState<string>("")
  const [routeFilter, setRouteFilter] = useState<
    ProviderRouteCategory | "all"
  >("all")

  const filteredProviders = useMemo(
    () => searchProviders(searchText, routeFilter),
    [searchText, routeFilter]
  )
  const grouped = useMemo(
    () => groupProvidersAlphabetically(filteredProviders),
    [filteredProviders]
  )

  return (
    <NavigationStack>
      <List
        navigationTitle={`选择供应商 (${filteredProviders.length})`}
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        listSectionIndexVisibility="automatic"
        searchable={{
          value: searchText,
          onChanged: setSearchText,
          prompt: "搜索 78 家 AI 供应商名称或域名",
        }}
        toolbar={{
          cancellationAction: <Button title="关闭" action={onClose} />,
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
              <Button
                key={item.id}
                buttonStyle="plain"
                action={() => onSelect(item.id)}
              >
                <HStack alignment="center" spacing={12}>
                  <ProviderIconView provider={item.id} size={34} />
                  <VStack alignment="leading" spacing={2}>
                    <Text font="body" foregroundStyle="label" lineLimit={1}>
                      {item.displayName}
                    </Text>
                    <Text
                      font="caption2"
                      foregroundStyle="secondaryLabel"
                      lineLimit={1}
                    >
                      {`${loginMethodBadgeText(item.loginMethod)} · ${item.endpointSummary}`}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Image
                    systemName="chevron.right"
                    font="caption"
                    foregroundStyle="tertiaryLabel"
                  />
                </HStack>
              </Button>
            ))}
          </Section>
        ))}
      </List>
    </NavigationStack>
  )
}

function DeviceCodeLoginSheet(props: {
  provider: ProviderId
  region?: string
  onCancel: () => void
  onCompleted: (envelope: ProviderCredentialEnvelope) => void
}) {
  const { provider, region, onCancel, onCompleted } = props
  const meta = getProviderMeta(provider)
  const isTrueDevice =
    provider === "copilot" || provider === "kimiCode" || provider === "codex"
  const [session, setSession] = useState<ProviderLoginSession | null>(null)
  const [statusText, setStatusText] = useState<string>(
    "正在申请授权会话…"
  )
  const [isPolling, setIsPolling] = useState<boolean>(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const created = await beginDeviceOrPollLogin(
          provider,
          UUID.string(),
          region
        )
        if (cancelled) return
        setSession(created)
        setStatusText(
          created.userCode
            ? "已生成设备授权码，点击打开授权页面进行确认"
            : "点击打开网页完成登录授权后，将自动同步凭证"
        )
      } catch (err) {
        if (cancelled) return
        setErrorText(
          err instanceof Error ? err.message : "发起授权失败"
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [provider, region])

  const handleCopyCode = async () => {
    if (session?.userCode) {
      await Pasteboard.setString(session.userCode)
      HapticFeedback.lightImpact()
      setStatusText(`已复制授权码 ${session.userCode}`)
    }
  }

  const handlePollOnce = async (targetSession?: ProviderLoginSession) => {
    const activeSession = targetSession ?? session
    if (!activeSession || isPolling) return
    setIsPolling(true)
    setErrorText(null)
    try {
      const progress = await pollDeviceOrPollLogin(activeSession)
      if (progress.status === "completed") {
        const parsed = JSON.parse(
          progress.credential
        ) as ProviderCredentialEnvelope
        onCompleted(parsed)
        return
      }
      setStatusText(
        activeSession.userCode
          ? "尚未检测到授权完成，请在浏览器中输入设备码确认后再验证"
          : "尚未检测到授权完成，请在浏览器中完成登录授权后再点击验证"
      )
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "验证授权状态失败")
    } finally {
      setIsPolling(false)
    }
  }

  const handleOpenAuthPage = async () => {
    if (!session?.authorizationURL) return
    if (session.userCode) {
      await Pasteboard.setString(session.userCode)
      HapticFeedback.lightImpact()
    }
    // 在应用内通过原生 SFSafariViewController 打开授权页面 (App 内 Safari)
    try {
      await Safari.present(session.authorizationURL, false)
    } catch {
      await Safari.openURL(session.authorizationURL)
    }
    // 用户在应用内关闭 Safari 窗口后，自动核对一次授权结果
    await handlePollOnce(session)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle={`${meta.displayName} ${session?.userCode || isTrueDevice ? "设备码授权" : "网页授权"}`}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={onCancel} />,
        }}
      >
        <Section>
          <HStack alignment="center" spacing={12}>
            <ProviderIconView provider={provider} size={40} />
            <VStack alignment="leading" spacing={2}>
              <Text font="headline">{meta.displayName}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {statusText}
              </Text>
            </VStack>
          </HStack>
        </Section>

        {session ? (
          <Section
            header={
              <Text>
                {session.userCode ? "设备授权码与在线验证" : "网页授权在线验证"}
              </Text>
            }
          >
            <VStack
              alignment="leading"
              spacing={10}
              listRowSeparator="hidden"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {session.userCode ? (
                <LabeledContent
                  title="设备授权码"
                  value={session.userCode}
                />
              ) : null}

              {session.userCode ? <Divider /> : null}

              {session.userCode ? (
                <Button
                  buttonStyle={adaptiveSecondaryButtonStyle()}
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  action={handleCopyCode}
                >
                  <HStack
                    frame={{ maxWidth: "infinity", alignment: "center" }}
                    alignment="center"
                    spacing={6}
                    padding={{ vertical: 2 }}
                  >
                    <Image systemName="doc.on.doc" font="subheadline" />
                    <Text
                      font="subheadline"
                      fontWeight="medium"
                      lineLimit={1}
                      multilineTextAlignment="center"
                    >
                      复制授权码
                    </Text>
                  </HStack>
                </Button>
              ) : null}

              {session.userCode ? <Divider /> : null}

              <Button
                buttonStyle={adaptiveProminentButtonStyle()}
                frame={{ maxWidth: "infinity", alignment: "center" }}
                action={handleOpenAuthPage}
              >
                <HStack
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  alignment="center"
                  spacing={6}
                  padding={{ vertical: 4 }}
                >
                  <Image systemName="safari" font="subheadline" />
                  <Text
                    font="subheadline"
                    fontWeight="semibold"
                    lineLimit={1}
                    multilineTextAlignment="center"
                  >
                    {session.userCode ? "打开授权页面" : "打开网页登录"}
                  </Text>
                </HStack>
              </Button>

              <Divider />

              <Button
                buttonStyle={adaptiveSecondaryButtonStyle()}
                frame={{ maxWidth: "infinity", alignment: "center" }}
                disabled={isPolling}
                action={() => handlePollOnce()}
              >
                <HStack
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  alignment="center"
                  spacing={6}
                  padding={{ vertical: 4 }}
                >
                  <Image systemName="checkmark.seal.fill" font="subheadline" />
                  <Text
                    font="subheadline"
                    fontWeight="medium"
                    lineLimit={1}
                    multilineTextAlignment="center"
                  >
                    {isPolling ? "正在核对授权结果…" : "已完成授权，立即验证"}
                  </Text>
                </HStack>
              </Button>
            </VStack>
          </Section>
        ) : (
          <Section>
            <HStack spacing={10}>
              <ProgressView progressViewStyle="circular" />
              <Text foregroundStyle="secondaryLabel">{statusText}</Text>
            </HStack>
          </Section>
        )}

        {errorText ? (
          <Section header={<Text>错误详情</Text>}>
            <Text foregroundStyle="systemRed">{errorText}</Text>
          </Section>
        ) : null}
      </Form>
    </NavigationStack>
  )
}
