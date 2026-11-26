import {
  Button,
  Circle,
  HStack,
  Image,
  ProgressView,
  Text,
  VStack,
  ZStack,
  type Color,
} from "scripting";
import { RELOC_COLORS, isIOS26OrLater, topCircleButtonStyle } from "./theme";

/**
 * 对应原项目 SettingsIconBadge：28×28 圆角彩色图标徽章。
 */
export function SettingsIconBadge(props: { systemName: string; color: Color }) {
  const shape = {
    type: "rect" as const,
    cornerRadius: 7,
    style: "continuous" as const,
  };
  return (
    <ZStack
      frame={{ width: 28, height: 28 }}
      background={{
        style: { color: props.color, gradient: true },
        shape,
      }}
      clipShape={shape}
    >
      <Image
        systemName={props.systemName}
        font="footnote"
        fontWeight="semibold"
        foregroundStyle="white"
      />
    </ZStack>
  );
}

/**
 * 对应原项目 MapHUDIconButton：42×42 圆形悬浮按钮，热区覆盖整个圆形区域。
 */
export function MapHUDIconButton(props: {
  systemName: string;
  foregroundColor?: Color;
  activeColor?: Color;
  action: () => void;
}) {
  return (
    <Button
      buttonStyle="plain"
      action={() => {
        HapticFeedback.lightImpact();
        props.action();
      }}
    >
      <ZStack
        frame={{ width: 42, height: 42 }}
        contentShape="circle"
        {...topCircleButtonStyle(props.activeColor)}
      >
        <Image
          systemName={props.systemName}
          font="callout"
          fontWeight="semibold"
          foregroundStyle={props.activeColor ? "white" : (props.foregroundColor ?? "label")}
        />
      </ZStack>
    </Button>
  );
}

/**
 * 对应原项目 RelocPrimaryButton：
 * iOS 26+ 使用原生 Liquid Glass (`glassProminent` / `glass`)；低版本回退为 `borderedProminent` / `bordered`。
 * 布局与 contentShape 位于 Button label 内部，确保整颗按钮任意位置均可点击触发。
 */
export function RelocPrimaryButton(props: {
  title: string;
  systemImage?: string;
  tint?: Color;
  variant?: "prominent" | "glass";
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  action: () => void;
}) {
  const useGlass = isIOS26OrLater();
  const variant = props.variant ?? "prominent";
  const buttonStyle = useGlass
    ? variant === "glass"
      ? "glass"
      : "glassProminent"
    : variant === "glass"
      ? "bordered"
      : "borderedProminent";

  const labelColor: Color = variant === "prominent" ? "white" : "label";
  const rectShape = {
    type: "rect" as const,
    cornerRadius: 14,
    style: "continuous" as const,
  };

  return (
    <Button
      disabled={props.disabled}
      buttonStyle={buttonStyle}
      tint={variant === "prominent" ? (props.tint ?? RELOC_COLORS.accent) : undefined}
      buttonBorderShape={{ roundedRectangleRadius: 14 }}
      controlSize="large"
      action={() => {
        HapticFeedback.mediumImpact();
        props.action();
      }}
    >
      <HStack
        spacing={7}
        frame={props.compact ? undefined : { maxWidth: "infinity" }}
        padding={{ vertical: 4, horizontal: props.compact ? 8 : 4 }}
        contentShape={rectShape}
      >
        {props.loading ? (
          <ProgressView controlSize="small" tint={labelColor} />
        ) : props.systemImage ? (
          <Image
            systemName={props.systemImage}
            font="subheadline"
            fontWeight="semibold"
            foregroundStyle={labelColor}
          />
        ) : null}
        <Text font="subheadline" fontWeight="semibold" foregroundStyle={labelColor} lineLimit={1}>
          {props.title}
        </Text>
      </HStack>
    </Button>
  );
}

/**
 * 对应原项目 stepSectionHeader：带数字编号胶囊的分组标题。
 */
export function StepSectionHeader(props: { number: string; title: string }) {
  return (
    <HStack spacing={6}>
      <Text
        font="caption2"
        fontWeight="heavy"
        fontDesign="monospaced"
        foregroundStyle={RELOC_COLORS.accent}
        padding={{ horizontal: 6, vertical: 2 }}
        background={{ style: "rgba(43, 115, 245, 0.15)", shape: "capsule" }}
      >
        {props.number}
      </Text>
      <Text font="caption" fontWeight="bold">
        {props.title}
      </Text>
    </HStack>
  );
}

/**
 * 对应原项目 MetricTile：Hero 卡片三列状态小块。
 */
export function MetricTile(props: { title: string; value: string; tint: Color }) {
  const shape = {
    type: "rect" as const,
    cornerRadius: 11,
    style: "continuous" as const,
  };
  return (
    <VStack
      alignment="leading"
      spacing={3}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      padding={9}
      background={{ style: "rgba(142, 142, 147, 0.11)", shape }}
      clipShape={shape}
    >
      <Text font="caption2" foregroundStyle="secondaryLabel">
        {props.title}
      </Text>
      <Text font="caption" fontWeight="bold" monospacedDigit lineLimit={1} foregroundStyle={props.tint}>
        {props.value}
      </Text>
    </VStack>
  );
}

/**
 * 对应原项目 PulsingStatusDot：带柔光光晕的状态点。
 */
export function StatusDot(props: { color: Color; active: boolean }) {
  return (
    <ZStack frame={{ width: 16, height: 16 }}>
      {props.active ? (
        <Circle
          fill={props.color}
          opacity={0.28}
          frame={{ width: 15, height: 15 }}
        />
      ) : null}
      <Circle fill={props.color} frame={{ width: 8, height: 8 }} />
    </ZStack>
  );
}
