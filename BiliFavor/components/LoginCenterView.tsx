import {
  Button,
  HStack,
  List,
  QRImage,
  RoundedRectangle,
  Section,
  Text,
  VStack,
  ZStack,
} from "scripting"

import type { QrLoginState } from "../types"

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
        <VStack spacing={12} padding={{ top: 22, bottom: 22, leading: 18, trailing: 18 }}>
          <Text font="headline">扫码登录</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">
            二维码登录不需要额外验证码，适合直接添加新账号。
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
      <VStack spacing={12} padding={{ top: 20, bottom: 20, leading: 18, trailing: 18 }}>
        <Text font="headline">
          {props.qrLogin.phase === "cancelled" ? "已取消扫码登录" : "扫码登录哔哩哔哩"}
        </Text>
        {props.qrLogin.url ? (
          <VStack
            padding={12}
            background={{ style: "white", shape: { type: "rect", cornerRadius: 18 } }}
          >
            <QRImage data={props.qrLogin.url} size={220} />
          </VStack>
        ) : null}
        <Text font="subheadline" foregroundStyle="secondaryLabel">
          {props.qrLogin.message}
        </Text>
        {props.qrLogin.expiresAt ? (
          <Text font="caption" foregroundStyle="secondaryLabel">
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

export function LoginCenterView(props: {
  qrLogin: QrLoginState | null
  loginBusy: boolean
  onStartQrLogin: () => Promise<void>
  onCancelQrLogin: () => void
}) {
  return (
    <List navigationTitle="登录" navigationBarTitleDisplayMode="inline">
      <Section
        header={<Text>二维码登录</Text>}
        footer={<Text>扫码登录成功后会直接保存 Cookie，并加入已保存账号列表。</Text>}
      >
        <QrLoginBlock
          qrLogin={props.qrLogin}
          busy={props.loginBusy}
          onStartQrLogin={props.onStartQrLogin}
          onCancelQrLogin={props.onCancelQrLogin}
        />
      </Section>
    </List>
  )
}
