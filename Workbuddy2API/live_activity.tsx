import { Button, HStack, Image, LiveActivity, LiveActivityUI, LiveActivityUIExpandedBottom, Rectangle, Spacer, Text, VStack, type LiveActivityUIBuilder } from "scripting"
import { StopServiceIntent } from "./app_intents"
import { SERVICE_ACTIVITY_NAME, type ServiceActivityState } from "./local/serviceControl"

export { SERVICE_ACTIVITY_NAME, type ServiceActivityState } from "./local/serviceControl"

function ServiceCard(state: ServiceActivityState) {
  const color = state.keptAlive ? "systemGreen" : "systemOrange"
  return <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
    <HStack spacing={10}>
      <Image systemName="server.rack" foregroundStyle={color} font="title3" />
      <VStack alignment="leading" spacing={2}>
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
          {state.keptAlive ? "HTTP API 运行中" : "HTTP API 前台运行"}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel">WorkBuddy2API</Text>
      </VStack>
      <Spacer minLength={8} />
      <Text font="subheadline" fontWeight="semibold" foregroundStyle={color}>{`:${state.port}`}</Text>
    </HStack>
    <Rectangle fill="separator" frame={{ maxWidth: "infinity", height: 0.5 }} />
    <HStack spacing={8}>
      <Text font="caption" foregroundStyle="secondaryLabel">{state.lan ? "局域网访问" : "仅本机访问"}</Text>
      <Spacer minLength={8} />
      <Text font="caption" foregroundStyle="secondaryLabel">{state.keptAlive ? "后台保活中" : "后台保活不可用"}</Text>
    </HStack>
    <Button title="停止 HTTP API" systemImage="stop.fill" intent={StopServiceIntent({ runId: state.runId })}
      buttonStyle="bordered" tint="systemRed" frame={{ maxWidth: "infinity" }} />
  </VStack>
}

const builder: LiveActivityUIBuilder<ServiceActivityState> = state => (
  <LiveActivityUI
    keylineTint={state.keptAlive ? "systemGreen" : "systemOrange"}
    dynamicIslandContentMargins={{ expanded: { horizontal: 20, bottom: 16 } }}
    content={<VStack padding={{ vertical: 14, horizontal: 16 }} activityBackgroundTint={{ light: "clear", dark: "clear" }}>
      <ServiceCard {...state} />
    </VStack>}
    compactLeading={<Image systemName="server.rack" foregroundStyle={state.keptAlive ? "systemGreen" : "systemOrange"} />}
    compactTrailing={<Text font="caption" fontWeight="medium" foregroundStyle={state.keptAlive ? "systemGreen" : "systemOrange"}>{state.port}</Text>}
    minimal={<Image systemName="server.rack" foregroundStyle={state.keptAlive ? "systemGreen" : "systemOrange"} />}
  >
    <LiveActivityUIExpandedBottom><VStack padding={{ bottom: 8 }}><ServiceCard {...state} /></VStack></LiveActivityUIExpandedBottom>
  </LiveActivityUI>
)

export const ServiceLiveActivity = LiveActivity.register(SERVICE_ACTIVITY_NAME, builder)
