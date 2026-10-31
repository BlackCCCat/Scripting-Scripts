import {
  Button,
  Divider,
  Form,
  HStack,
  Image,
  LabeledContent,
  NavigationStack,
  ProgressView,
  Section,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import {
  beginDeviceOrPollLogin,
  pollDeviceOrPollLogin,
} from "../services/provider_auth"
import {
  ProviderCredentialEnvelope,
  ProviderId,
  ProviderLoginSession,
} from "../models/types"
import { getProviderMeta } from "../utils/providers_catalog"
import { ProviderIconView } from "./ProviderIconView"
import {
  adaptiveProminentButtonStyle,
  adaptiveSecondaryButtonStyle,
} from "../utils/theme"

export function DeviceCodeLoginSheet(props: {
  provider: ProviderId
  region?: string
  embedded?: boolean
  navigationTransition?: { type: "zoom"; sourceID: string | number; namespace: any }
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

  const content = (
    <Form
      navigationTransition={props.navigationTransition}
      navigationTitle={`${meta.displayName} ${session?.userCode || isTrueDevice ? "设备码授权" : "网页授权"}`}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: props.embedded ? undefined : (
          <Button title="关闭" action={onCancel} />
        ),
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
  )

  if (props.embedded) {
    return content
  }

  return <NavigationStack>{content}</NavigationStack>
}
