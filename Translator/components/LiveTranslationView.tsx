import {
  Button,
  EmptyView,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  ScrollView,
  Spacer,
  Text,
  VStack,
  useObservable,
} from "scripting"

import { AUTO_LANGUAGE, LANGUAGE_OPTIONS } from "../constants"
import type { TranslatorEngineEntry } from "../types"
import { LIVE_PIP_SIZES } from "../utils/live_translation"
import { EngineIcon } from "./EngineIcon"
import { TranslationHistoryView } from "./TranslationHistoryView"

export function LiveTranslationView(props: {
  engines: TranslatorEngineEntry[]
  engineId: string
  onEngineChanged: (id: string) => void
  sourceLanguageCode: string
  onSourceChanged: (code: string) => void
  targetLanguageCode: string
  onTargetChanged: (code: string) => void
  sizeIndex: number
  onSizeChanged: (index: number) => void
  preview: ReturnType<typeof useObservable<string>>
  active: boolean
  onToggle: () => void
}) {
  const dismiss = Navigation.useDismiss()
  const selectedEngine = props.engines.find((engine) => engine.id === props.engineId)
  const size = LIVE_PIP_SIZES[props.sizeIndex] ?? LIVE_PIP_SIZES[3]
  const previewScale = Math.min(Math.min(Device.screen.width - 48, 344) / size.width, 175 / size.height)
  const useGlassButton = Number.parseInt(Device.systemVersion, 10) >= 26

  return (
    <NavigationStack>
      <List
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        listSectionSpacing={14}
        toolbar={{
          topBarLeading: (
            <Button action={() => dismiss()}>
              <Image systemName="xmark" fontWeight="semibold" foregroundStyle="red" />
            </Button>
          ),
          topBarTrailing: <Button title="历史" action={() => {
            void Navigation.present({ element: <TranslationHistoryView origin="live" /> })
          }} />,
        }}
      >
        <Section header={<Text>浮窗预览</Text>}>
          <HStack
            frame={{ maxWidth: "infinity", height: 175 }}
            listRowInsets={{ top: 4, bottom: 4, leading: 4, trailing: 4 }}
          >
            <Spacer />
            <VStack
              frame={{ width: size.width * previewScale, height: size.height * previewScale, alignment: "topLeading" }}
              background="systemGroupedBackground"
              clipShape={{ type: "rect", cornerRadius: 16 }}
            >
              <ScrollView
                frame={{ width: size.width * previewScale, height: size.height * previewScale }}
                scrollIndicator="visible"
              >
                <Text
                  font="body"
                  padding={10}
                  frame={{ width: size.width * previewScale - 20, alignment: "topLeading" }}
                  fixedSize={{ horizontal: false, vertical: true }}
                  multilineTextAlignment="leading"
                  foregroundStyle={props.active ? "label" : "secondaryLabel"}
                >
                  {props.preview.value}
                </Text>
              </ScrollView>
            </VStack>
            <Spacer />
          </HStack>
        </Section>

        <Section>
          <Picker
            title=""
            accessibilityLabel="浮窗大小"
            pickerStyle="segmented"
            value={props.sizeIndex}
            onChanged={props.onSizeChanged}
            disabled={props.active}
            listRowBackground={<EmptyView />}
            listRowInsets={0}
          >
            {LIVE_PIP_SIZES.map((size, index) => (
              <Image key={size.label} tag={index} systemName={size.systemImage} accessibilityLabel={size.label} />
            ))}
          </Picker>
        </Section>

        <Section header={<Text>语言</Text>}>
          <Picker
            title="源语言"
            pickerStyle="menu"
            value={props.sourceLanguageCode}
            onChanged={props.onSourceChanged}
          >
            {[AUTO_LANGUAGE, ...LANGUAGE_OPTIONS].map((option) => (
              <Text key={option.code} tag={option.code}>{option.label}-{option.promptName}</Text>
            ))}
          </Picker>
          <Picker
            title="目标语言"
            pickerStyle="menu"
            value={props.targetLanguageCode}
            onChanged={props.onTargetChanged}
          >
            <Text tag="auto">自动切换（中文 ↔ 英语）</Text>
            {LANGUAGE_OPTIONS.map((option) => (
              <Text key={option.code} tag={option.code}>{option.label}-{option.promptName}</Text>
            ))}
          </Picker>
        </Section>

        <Section
          header={<Text>翻译引擎</Text>}
          footer={<Text>启动后复制的文本会交给所选引擎翻译，外部引擎可能联网。关闭浮窗即可停止监听。</Text>}
        >
          {props.engines.length ? (
            <HStack spacing={12}>
              {selectedEngine ? <EngineIcon kind={selectedEngine.kind} mode={selectedEngine.config?.compatibilityMode} size={22} /> : null}
              <Text lineLimit={1} truncationMode="tail">{selectedEngine?.label ?? "选择引擎"}</Text>
              <Spacer />
              <Menu
                label={
                  <HStack spacing={4}>
                    <Text foregroundStyle="accentColor">选择</Text>
                    <Image systemName="chevron.up.chevron.down" font="caption2" foregroundStyle="accentColor" />
                  </HStack>
                }
              >
                {props.engines.map((engine) => (
                  <Button key={engine.id} action={() => props.onEngineChanged(engine.id)}>
                    <HStack spacing={8}>
                      <EngineIcon kind={engine.kind} mode={engine.config?.compatibilityMode} size={20} />
                      <Text>{engine.label}</Text>
                      {engine.id === props.engineId ? <Image systemName="checkmark" /> : null}
                    </HStack>
                  </Button>
                ))}
              </Menu>
            </HStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">请先在设置中启用可用的翻译引擎。</Text>
          )}
        </Section>

        <HStack
          frame={{ maxWidth: "infinity" }}
          listRowBackground={<EmptyView />}
          listRowSeparator="hidden"
        >
          <Spacer />
          <Button
            buttonStyle={useGlassButton ? "glassProminent" : "borderedProminent"}
            buttonBorderShape="capsule"
            controlSize="large"
            tint={props.active ? "systemRed" : "systemBlue"}
            disabled={!selectedEngine}
            action={props.onToggle}
          >
            <HStack spacing={8} frame={{ width: 220, alignment: "center" }}>
              <Image systemName={props.active ? "stop.fill" : "pip.enter"} />
              <Text>{props.active ? "停止浮窗翻译" : "启动浮窗翻译"}</Text>
            </HStack>
          </Button>
          <Spacer />
        </HStack>
      </List>
    </NavigationStack>
  )
}
