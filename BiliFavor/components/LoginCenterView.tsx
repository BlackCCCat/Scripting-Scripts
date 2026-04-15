import {
  Button,
  HStack,
  Image,
  List,
  QRImage,
  RoundedRectangle,
  Section,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"

import type { BiliLoginMode, QrLoginState } from "../types"

function QrLoginBlock(props: {
  qrLogin: QrLoginState | null
  busy: boolean
  onStartQrLogin: () => Promise<void>
  onCancelQrLogin: () => void
}) {
  if (!props.qrLogin) {
    return (
      <ZStack frame={{ maxWidth: "infinity", minHeight: 220 }}>
        <RoundedRectangle
          cornerRadius={20}
          fill="secondarySystemBackground"
          stroke="separator"
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        />
        <VStack spacing={12} padding={{ top: 22, bottom: 22, leading: 18, trailing: 18 }} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
          <Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            扫码登录
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            二维码登录会直接把 Cookie 保存到本地账号列表，适合多账号切换。
          </Text>
          <Button
            title={props.busy ? "正在获取…" : "获取登录二维码"}
            systemImage="qrcode"
            disabled={props.busy}
            action={() => void props.onStartQrLogin()}
          />
        </VStack>
      </ZStack>
    )
  }

  return (
    <ZStack frame={{ maxWidth: "infinity", minHeight: 360 }}>
      <RoundedRectangle
        cornerRadius={20}
        fill="secondarySystemBackground"
        stroke="separator"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      />
      <VStack spacing={12} padding={{ top: 20, bottom: 20, leading: 18, trailing: 18 }} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          {props.qrLogin.phase === "cancelled" ? "已取消扫码登录" : "扫码登录哔哩哔哩"}
        </Text>
        {props.qrLogin.url ? (
          <VStack
            padding={12}
            frame={{ maxWidth: "infinity", alignment: "center" as any }}
            background={{ style: "white", shape: { type: "rect", cornerRadius: 18 } }}
          >
            <QRImage data={props.qrLogin.url} size={220} />
          </VStack>
        ) : null}
        <Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          {props.qrLogin.message}
        </Text>
        {props.qrLogin.expiresAt ? (
          <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            过期时间：{new Date(props.qrLogin.expiresAt).toLocaleTimeString("zh-CN")}
          </Text>
        ) : null}
        <HStack spacing={12}>
          <Button
            title={props.qrLogin.phase === "cancelled" ? "重新开始" : "重新生成"}
            systemImage="arrow.clockwise"
            disabled={props.busy}
            action={() => void props.onStartQrLogin()}
          />
          {props.qrLogin.phase !== "cancelled" ? (
            <Button
              title="取消"
              role="cancel"
              disabled={props.busy}
              action={props.onCancelQrLogin}
            />
          ) : null}
        </HStack>
      </VStack>
    </ZStack>
  )
}

function WebViewLoginBlock(props: {
  busy: boolean
  onStartWebViewLogin: () => Promise<void>
}) {
  return (
    <ZStack frame={{ maxWidth: "infinity", minHeight: 200 }}>
      <RoundedRectangle
        cornerRadius={20}
        fill="secondarySystemBackground"
        stroke="separator"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      />
      <VStack spacing={12} padding={{ top: 22, bottom: 22, leading: 18, trailing: 18 }} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          网页登录
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          通过 WebView 保持网页登录状态。适合直接在网页环境里请求动态数据，不依赖本地导出完整 Cookie。
        </Text>
        <Button
          title={props.busy ? "正在打开…" : "打开网页登录"}
          systemImage="globe"
          disabled={props.busy}
          action={() => void props.onStartWebViewLogin()}
        />
      </VStack>
    </ZStack>
  )
}

function LoginModeRow(props: {
  title: string
  subtitle: string
  selected: boolean
  onPress: () => Promise<void>
}) {
  return (
    <Button buttonStyle="plain" action={() => void props.onPress()} frame={{ maxWidth: "infinity" }}>
      <HStack
        spacing={12}
        padding={{ top: 8, bottom: 8 }}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        contentShape="rect"
      >
        <VStack spacing={3} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
          <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {props.title}
          </Text>
          <Text
            font="caption"
            foregroundStyle="secondaryLabel"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            {props.subtitle}
          </Text>
        </VStack>
        <Spacer />
        {props.selected ? (
          <Image systemName="checkmark.circle.fill" foregroundStyle="#FB7299" />
        ) : null}
      </HStack>
    </Button>
  )
}

export function LoginCenterView(props: {
  loginMode: BiliLoginMode
  qrLogin: QrLoginState | null
  loginBusy: boolean
  onStartQrLogin: () => Promise<void>
  onCancelQrLogin: () => void
  onStartWebViewLogin: () => Promise<void>
  onChangeLoginMode: (mode: BiliLoginMode) => Promise<void>
}) {
  return (
    <List navigationTitle="登录" navigationBarTitleDisplayMode="inline">
      <Section
        header={<Text>登录模式</Text>}
        footer={<Text>可在二维码和网页登录之间切换。</Text>}
      >
        <LoginModeRow
          title="二维码账号模式"
          subtitle="保存本地账号，适合多账号切换。"
          selected={props.loginMode === "cookie"}
          onPress={() => props.onChangeLoginMode("cookie")}
        />
        <LoginModeRow
          title="网页登录模式"
          subtitle="复用 WebView 登录状态来拉取动态。"
          selected={props.loginMode === "webview"}
          onPress={() => props.onChangeLoginMode("webview")}
        />
      </Section>

      <Section
        header={<Text>二维码登录</Text>}
        footer={<Text>扫码成功后会自动保存到账号列表。</Text>}
      >
        <QrLoginBlock
          qrLogin={props.qrLogin}
          busy={props.loginBusy}
          onStartQrLogin={props.onStartQrLogin}
          onCancelQrLogin={props.onCancelQrLogin}
        />
      </Section>

      <Section
        header={<Text>网页登录</Text>}
        footer={<Text>登录后会自动切到网页登录模式。</Text>}
      >
        <WebViewLoginBlock
          busy={props.loginBusy}
          onStartWebViewLogin={props.onStartWebViewLogin}
        />
      </Section>
    </List>
  )
}
