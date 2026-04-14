import {
  Button,
  HStack,
  Image,
  List,
  NavigationLink,
  NavigationStack,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"

import { LoginCenterView } from "./LoginCenterView"
import type { BiliAuthSession, BiliLoginMode, BiliPlaybackMode, QrLoginState } from "../types"

async function confirmDialog(options: { title: string; message: string }): Promise<boolean> {
  const runtimeDialog = (globalThis as any).Dialog
  if (runtimeDialog?.confirm) {
    return Boolean(await runtimeDialog.confirm(options))
  }
  return true
}

function AccountHeader(props: {
  auth: BiliAuthSession | null
  validating: boolean
  loginMode: BiliLoginMode
}) {
  const user = props.auth?.user

  if (user) {
    return (
      <HStack spacing={12} padding={{ top: 6, bottom: 6 }}>
        <Image
          imageUrl={user.face}
          resizable={true}
          scaleToFill={true}
          frame={{ width: 56, height: 56 }}
          clipShape={{ type: "rect", cornerRadius: 14 }}
          placeholder={<ProgressView progressViewStyle="circular" />}
        />
        <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
          <Text
            font="title3"
            foregroundStyle="#FB7299"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            {user.uname}
          </Text>
          <Text
            font="subheadline"
            foregroundStyle="secondaryLabel"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            UID {user.mid} · Lv{user.level}{user.vipLabel ? ` · ${user.vipLabel}` : ""}
          </Text>
        </VStack>
      </HStack>
    )
  }

  return (
    <VStack spacing={8} padding={{ top: 8, bottom: 8 }} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
      <Text font="headline" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        {props.validating ? "正在同步账号状态…" : "当前未登录"}
      </Text>
      <Text
        font="subheadline"
        foregroundStyle="secondaryLabel"
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      >
        {props.validating
          ? (props.loginMode === "webview" ? "正在校验当前网页登录状态。" : "正在使用已保存的 Cookie 校验账号有效性。")
          : props.loginMode === "webview" ? "当前已切换到网页登录模式。" : "登录页支持二维码登录和网页登录。"}
      </Text>
    </VStack>
  )
}

function AccountRow(props: {
  item: BiliAuthSession
  isActive: boolean
  onSwitch: () => Promise<void>
}) {
  const user = props.item.user
  return (
    <Button buttonStyle="plain" action={() => void props.onSwitch()}>
      <HStack spacing={12} padding={{ top: 8, bottom: 8 }}>
        {user?.face ? (
          <Image
            imageUrl={user.face}
            resizable={true}
            scaleToFill={true}
            frame={{ width: 42, height: 42 }}
            clipShape={{ type: "rect", cornerRadius: 12 }}
            placeholder={<ProgressView progressViewStyle="circular" />}
          />
        ) : (
          <ZStack
            frame={{ width: 42, height: 42 }}
            background={{ style: "#FBCFE8", shape: { type: "rect", cornerRadius: 12 } }}
          >
            <Text font="headline" foregroundStyle="#9D174D">B</Text>
          </ZStack>
        )}
        <VStack spacing={3} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
          <Text
            font="subheadline"
            foregroundStyle="#FB7299"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            {user?.uname ?? "未命名账号"}
          </Text>
          <Text
            font="caption"
            foregroundStyle="secondaryLabel"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            UID {user?.mid ?? "--"} · {props.item.updatedAt ? new Date(props.item.updatedAt).toLocaleString("zh-CN") : "未同步"}
          </Text>
        </VStack>
        <Spacer />
        {props.isActive ? (
          <Text
            font="caption"
            foregroundStyle="white"
            padding={{ top: 4, bottom: 4, leading: 8, trailing: 8 }}
            background={{ style: "#FB7299", shape: { type: "capsule", style: "continuous" } }}
          >
            当前
          </Text>
        ) : (
          <Text font="caption" foregroundStyle="#FB7299">切换</Text>
        )}
      </HStack>
    </Button>
  )
}

export function SettingsTabView(props: {
  auth: BiliAuthSession | null
  accounts: BiliAuthSession[]
  loginMode: BiliLoginMode
  validating: boolean
  loginBusy: boolean
  qrLogin: QrLoginState | null
  authMessage: string
  playbackMode: BiliPlaybackMode
  onExit: () => void
  onPlaybackModeChange: (mode: BiliPlaybackMode) => Promise<void>
  onLoginModeChange: (mode: BiliLoginMode) => Promise<void>
  onStartQrLogin: () => Promise<void>
  onStartWebViewLogin: () => Promise<void>
  onRefreshAccount: () => Promise<void>
  onClearAuth: () => Promise<void>
  onCancelQrLogin: () => void
  onSwitchAccount: (accountId: string) => Promise<void>
}) {
  async function confirmClearAuth() {
    const ok = await confirmDialog({
      title: "删除当前账号",
      message: "这会删除当前账号在本地保存的 Cookie。其他已保存账号不会受影响。是否继续？",
    })
    if (!ok) return
    await props.onClearAuth()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          topBarLeading: <Button
            title=""
            systemImage="xmark"
            action={props.onExit}
          />,
        }}
      >
        <Section header={<Text>账号</Text>} footer={props.authMessage ? <Text>{props.authMessage}</Text> : undefined}>
          <AccountHeader auth={props.auth} validating={props.validating} loginMode={props.loginMode} />
        </Section>

        <Section
          header={<Text>登录</Text>}
        >
          <NavigationLink
            destination={
              <LoginCenterView
                loginMode={props.loginMode}
                qrLogin={props.qrLogin}
                loginBusy={props.loginBusy}
                onStartQrLogin={props.onStartQrLogin}
                onCancelQrLogin={props.onCancelQrLogin}
                onStartWebViewLogin={props.onStartWebViewLogin}
                onChangeLoginMode={props.onLoginModeChange}
              />
            }
          >
            <HStack spacing={12} padding={{ top: 8, bottom: 8 }}>
              <VStack spacing={3} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
                <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  登录与添加账号
                </Text>
                <Text
                  font="caption"
                  foregroundStyle="secondaryLabel"
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                >
                  进入独立登录页，切换模式并完成二维码或网页登录
                </Text>
              </VStack>
            </HStack>
          </NavigationLink>
        </Section>

        <Section
          header={<Text>播放</Text>}
          footer={<Text>控制点开动态卡片时，是直接跳到哔哩哔哩，还是优先在 Scripting 里用原生播放器播放。默认推荐跳转播放。</Text>}
        >
          <Button
            buttonStyle="plain"
            action={() => void props.onPlaybackModeChange("external")}
            frame={{ maxWidth: "infinity" }}
          >
            <HStack
              spacing={12}
              padding={{ top: 8, bottom: 8 }}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              contentShape="rect"
            >
              <VStack spacing={3} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
                <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  跳转播放
                </Text>
                <Text
                  font="caption"
                  foregroundStyle="secondaryLabel"
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                >
                  默认方式，使用哔哩哔哩页面打开视频
                </Text>
              </VStack>
              <Spacer />
              {props.playbackMode === "external" ? (
                <Image systemName="checkmark.circle.fill" foregroundStyle="#FB7299" />
              ) : null}
            </HStack>
          </Button>

          <Button
            buttonStyle="plain"
            action={() => void props.onPlaybackModeChange("inline")}
            frame={{ maxWidth: "infinity" }}
          >
            <HStack
              spacing={12}
              padding={{ top: 8, bottom: 8 }}
              frame={{ maxWidth: "infinity", alignment: "leading" as any }}
              contentShape="rect"
            >
              <VStack spacing={3} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
                <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  应用内播放
                </Text>
                <Text
                  font="caption"
                  foregroundStyle="secondaryLabel"
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                >
                  优先在 Scripting 里直接播放视频
                </Text>
              </VStack>
              <Spacer />
              {props.playbackMode === "inline" ? (
                <Image systemName="checkmark.circle.fill" foregroundStyle="#FB7299" />
              ) : null}
            </HStack>
          </Button>
        </Section>

        <Section
          header={<Text>已保存账号</Text>}
          footer={<Text>{props.loginMode === "webview" ? "网页登录模式不会直接使用这里的账号，但你仍可点击任一账号切回二维码账号模式。" : "当前请求会使用“当前”账号的 Cookie。登录新账号后会自动加入这里。"}</Text>}
        >
          {props.accounts.length > 0 ? props.accounts.map((item) => (
            <AccountRow
              key={item.id}
              item={item}
              isActive={props.auth?.id === item.id}
              onSwitch={() => props.onSwitchAccount(item.id)}
            />
          )) : (
            <Text foregroundStyle="secondaryLabel">还没有已保存账号</Text>
          )}
        </Section>

        <Section header={<Text>操作</Text>} footer={<Text>本脚本只会把登录 Cookie 用在当前动态请求中，不会上传到其他服务。</Text>}>
          <Button
            title={props.validating ? "正在刷新账号状态…" : "刷新账号状态"}
            systemImage="person.crop.circle.badge.checkmark"
            disabled={!props.auth || props.validating}
            action={() => void props.onRefreshAccount()}
          />
          <Button
            title="删除当前账号"
            systemImage="trash"
            role="destructive"
            disabled={!props.auth?.cookieHeader || props.loginMode === "webview"}
            action={() => void confirmClearAuth()}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}
