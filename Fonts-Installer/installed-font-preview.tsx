import {
  Button,
  Device,
  Navigation,
  NavigationStack,
  ScrollView,
  Text,
  VStack,
  ZStack,
} from "scripting"
import { colors, CustomGradientBackground } from "./theme"

const isIOS26OrLater = Number.parseInt(Device.systemVersion.split(".")[0] || "0", 10) >= 26

function PreviewCard(props: { children: JSX.Element | Array<JSX.Element | null> }) {
  return (
    <VStack
      spacing={22}
      padding={24}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      {...(isIOS26OrLater
        ? { glassEffect: { type: "rect", cornerRadius: 24 } as any }
        : {
            background: {
              style: colors.nativeCard,
              shape: { type: "rect", cornerRadius: 20 },
            },
          })}
    >
      {props.children}
    </VStack>
  )
}

function InstalledFontPreviewView({
  postScriptName,
  supportsChinese,
}: {
  postScriptName: string
  supportsChinese: boolean
}) {
  const dismiss = Navigation.useDismiss()

  return (
    <NavigationStack>
      <ZStack
        navigationTitle="字体预览"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ cancellationAction: <Button title="关闭" action={() => dismiss()} /> }}
      >
        <CustomGradientBackground />
        <ScrollView>
          <VStack
            spacing={18}
            padding={{ top: 20, bottom: 36, leading: 18, trailing: 18 }}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            <VStack spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text font="title2" fontWeight="bold" foregroundStyle={colors.primary}>
                {postScriptName}
              </Text>
              <Text font="subheadline" foregroundStyle={colors.secondary}>
                系统已安装字体 · PostScript 名称
              </Text>
            </VStack>

            <PreviewCard>
              <Text
                font={{ name: postScriptName, size: 52 }}
                foregroundStyle={colors.primary}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                {supportsChinese ? "字体预览 Aa" : "Font Preview Aa"}
              </Text>
              {supportsChinese ? (
                <Text
                  font={{ name: postScriptName, size: 30 }}
                  foregroundStyle={colors.primary}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  天地玄黄，宇宙洪荒。\n春风又绿江南岸。
                </Text>
              ) : null}
              <Text
                font={{ name: postScriptName, size: 26 }}
                foregroundStyle={colors.primary}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                The quick brown fox jumps over the lazy dog.
              </Text>
              <Text
                font={{ name: postScriptName, size: 20 }}
                foregroundStyle={colors.primary}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789\n.,:;!? @ # ¥ $ % &amp; ( ) [ ] { }
              </Text>
            </PreviewCard>
          </VStack>
        </ScrollView>
      </ZStack>
    </NavigationStack>
  )
}

export async function presentInstalledFontPreview(
  postScriptName: string,
  supportsChinese = false,
): Promise<void> {
  await Navigation.present({
    element: (
      <InstalledFontPreviewView
        postScriptName={postScriptName}
        supportsChinese={supportsChinese}
      />
    ),
  })
}
