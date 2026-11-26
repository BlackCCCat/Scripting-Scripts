import {
  Button,
  Circle,
  HStack,
  Image,
  LiveActivity,
  LiveActivityUI,
  LiveActivityUIExpandedBottom,
  LiveActivityUIExpandedCenter,
  LiveActivityUIExpandedLeading,
  Rectangle,
  Spacer,
  Text,
  TimerIntervalLabel,
  VStack,
  ZStack,
  type Color,
  type Font,
  type LiveActivityUIBuilder,
} from "scripting";
import { RelocStopSpoofingIntent } from "./app_intents";

export interface RelocActivityState {
  kind?: "simulation" | "pairing";
  pin?: string;
  placeName: string;
  latitude: number;
  longitude: number;
  statusLabel: string;
  packetsAcknowledged: number;
  startedAt: number;
  isError: boolean;
}

const TIMER_SPAN_MS = 24 * 3600 * 1000;

function accentColor(state: RelocActivityState): Color {
  if (state.isError) return "systemOrange";
  if (state.statusLabel.includes("模拟中")) return "systemGreen";
  return "systemBlue";
}

function coordinateText(state: RelocActivityState): string {
  return `${state.latitude.toFixed(5)}, ${state.longitude.toFixed(5)}`;
}

function ElapsedTimer(props: { startedAt: number; font: Font; width: number }) {
  return (
    <TimerIntervalLabel
      from={new Date(props.startedAt)}
      to={new Date(props.startedAt + TIMER_SPAN_MS)}
      countsDown={false}
      font={props.font}
      multilineTextAlignment="trailing"
      frame={{ width: props.width, alignment: "trailing" }}
    />
  );
}

function RoundIcon(props: { systemName: string; fill: Color }) {
  return (
    <ZStack frame={{ width: 36, height: 36 }}>
      <Circle fill={props.fill} frame={{ width: 36, height: 36 }} />
      <Image systemName={props.systemName} foregroundStyle="white" font="subheadline" />
    </ZStack>
  );
}

function SimulationCard(state: RelocActivityState) {
  const accent = accentColor(state);
  const coord = coordinateText(state);
  return (
    <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
      <HStack spacing={10}>
        <RoundIcon
          systemName={state.isError ? "exclamationmark.triangle.fill" : "mappin.and.ellipse"}
          fill={accent}
        />
        <VStack alignment="leading" spacing={1}>
          <Text font="subheadline" fontWeight="semibold" lineLimit={1}>
            {state.statusLabel || "位置模拟中"}
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            {state.placeName || coord}
          </Text>
        </VStack>
        <Spacer minLength={8} />
        <Button intent={RelocStopSpoofingIntent(undefined)} buttonStyle="plain">
          <RoundIcon systemName="location.slash.fill" fill="systemRed" />
        </Button>
      </HStack>

      <Rectangle fill="separator" frame={{ maxWidth: "infinity", height: 0.5 }} />

      <HStack spacing={4} padding={{ horizontal: 4 }}>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {`${state.placeName ? coord : ""}${state.placeName ? " · " : ""}ACK ${state.packetsAcknowledged}`}
        </Text>
        <Spacer minLength={8} />
        <Text font="caption" foregroundStyle="secondaryLabel">已持续</Text>
        <ElapsedTimer startedAt={state.startedAt} font="caption" width={52} />
      </HStack>
    </VStack>
  );
}

function pairingUI(state: RelocActivityState) {
  const pin = state.pin ?? "";
  return (
    <LiveActivityUI
      content={
        <VStack
          alignment="leading"
          spacing={6}
          padding={{ vertical: 12, horizontal: 14 }}
          activityBackgroundTint={{ light: "clear", dark: "clear" }}
        >
          <HStack spacing={10}>
            <Image systemName="personalhotspot" foregroundStyle="systemBlue" font="title2" />
            <VStack alignment="leading" spacing={2}>
              <Text font="caption" foregroundStyle="secondaryLabel">配对 PIN</Text>
              <Text font="title2" fontWeight="bold" fontDesign="monospaced">{pin}</Text>
            </VStack>
            <Spacer />
          </HStack>
          <Text font="caption2" foregroundStyle="secondaryLabel">
            设置 → 隐私与安全性 → 开发者 → 配对
          </Text>
        </VStack>
      }
      compactLeading={<Image systemName="personalhotspot" foregroundStyle="systemBlue" />}
      compactTrailing={<Text font="caption2" fontDesign="monospaced" foregroundStyle="systemBlue">{pin}</Text>}
      minimal={<Image systemName="personalhotspot" foregroundStyle="systemBlue" />}
    >
      <LiveActivityUIExpandedLeading>
        <Image systemName="personalhotspot" foregroundStyle="systemBlue" font="title2" />
      </LiveActivityUIExpandedLeading>
      <LiveActivityUIExpandedCenter>
        <VStack alignment="leading" spacing={2}>
          <Text font="caption2" foregroundStyle="secondaryLabel">配对 PIN</Text>
          <Text font="title3" fontWeight="bold" fontDesign="monospaced">{pin}</Text>
        </VStack>
      </LiveActivityUIExpandedCenter>
      <LiveActivityUIExpandedBottom>
        <Text font="caption2" foregroundStyle="secondaryLabel">
          设置 → 隐私与安全性 → 开发者 → 配对
        </Text>
      </LiveActivityUIExpandedBottom>
    </LiveActivityUI>
  );
}

const simulationUI: LiveActivityUIBuilder<RelocActivityState> = (state) => (
  <LiveActivityUI
    keylineTint={accentColor(state)}
    dynamicIslandContentMargins={{ expanded: { horizontal: 20, bottom: 16 } }}
    content={
      <VStack
        padding={{ vertical: 14, horizontal: 16 }}
        activityBackgroundTint={{ light: "clear", dark: "clear" }}
      >
        <SimulationCard {...state} />
      </VStack>
    }
    compactLeading={
      <Image
        systemName={state.isError ? "exclamationmark.triangle.fill" : "location.fill"}
        foregroundStyle={accentColor(state)}
      />
    }
    compactTrailing={<ElapsedTimer startedAt={state.startedAt} font="footnote" width={54} />}
    minimal={
      <Image
        systemName={state.isError ? "exclamationmark.triangle.fill" : "location.fill"}
        foregroundStyle={accentColor(state)}
      />
    }
  >
    <LiveActivityUIExpandedBottom>
      <VStack padding={{ bottom: 8 }}>
        <SimulationCard {...state} />
      </VStack>
    </LiveActivityUIExpandedBottom>
  </LiveActivityUI>
);

const builder: LiveActivityUIBuilder<RelocActivityState> = (state) =>
  state.kind === "pairing" ? pairingUI(state) : simulationUI(state);

export const RelocLiveActivity = LiveActivity.register("RelocActivity", builder);
