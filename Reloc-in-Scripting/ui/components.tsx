import {
  Button,
  Circle,
  HStack,
  Image,
  Menu,
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
  loading?: boolean;
  action: () => void;
}) {
  const iconTint: Color = props.activeColor ? "white" : (props.foregroundColor ?? "label");
  return (
    <Button
      buttonStyle="plain"
      disabled={props.loading}
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
        {props.loading ? (
          <ProgressView controlSize="small" tint={iconTint} />
        ) : (
          <Image
            systemName={props.systemName}
            font="callout"
            fontWeight="semibold"
            foregroundStyle={iconTint}
          />
        )}
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

const HOME_TAB_ITEMS = [
  { tag: 0, title: "定位", systemImage: "location.north.circle.fill" },
  { tag: 1, title: "设备连接", systemImage: "antenna.radiowaves.left.and.right" },
  { tag: 2, title: "实测与日志", systemImage: "waveform.path.ecg" },
] as const;

/**
 * Scripting 首页模式下用于三页切换的原生菜单按钮（统一位于页面左上角，使用与底部 Tab 一致的图标）：
 * - mapCircle：放在定位页左上角搜索栏左侧（42×42 玻璃圆形按钮）
 * - toolbar：放在设备连接 / 实测与日志页导航栏左上角
 */
export function HomePageSwitcherMenu(props: {
  currentTab: number;
  onSelectTab: (tab: number) => void;
  style?: "mapCircle" | "toolbar";
}) {
  const mode = props.style ?? "mapCircle";
  const currentItem = HOME_TAB_ITEMS.find((item) => item.tag === props.currentTab) ?? HOME_TAB_ITEMS[0];

  return (
    <Menu
      label={
        mode === "toolbar" ? (
          <Image systemName={currentItem.systemImage} />
        ) : (
          <ZStack frame={{ width: 42, height: 42 }} contentShape="circle" {...topCircleButtonStyle()}>
            <Image
              systemName={currentItem.systemImage}
              font="callout"
              fontWeight="semibold"
              foregroundStyle={RELOC_COLORS.accent}
            />
          </ZStack>
        )
      }
    >
      {HOME_TAB_ITEMS.map((item) => (
        <Button
          key={item.tag}
          action={() => {
            HapticFeedback.lightImpact();
            props.onSelectTab(item.tag);
          }}
        >
          <HStack>
            <Image systemName={props.currentTab === item.tag ? "checkmark" : item.systemImage} />
            <Text>{item.title}</Text>
          </HStack>
        </Button>
      ))}
    </Menu>
  );
}

/**
 * 导航栏左上角操作区（兼容主屏幕切换菜单与普通模式退出脚本按钮）。
 */
export function ToolbarLeadingActions(props: {
  homeTabSwitcher?: { currentTab: number; onSelectTab: (tab: number) => void };
  onClose?: () => void;
}) {
  if (props.homeTabSwitcher && props.onClose) {
    return (
      <HStack spacing={10}>
        <HomePageSwitcherMenu
          currentTab={props.homeTabSwitcher.currentTab}
          onSelectTab={props.homeTabSwitcher.onSelectTab}
          style="toolbar"
        />
        <Button action={props.onClose}>
          <Image systemName="xmark" foregroundStyle={RELOC_COLORS.crimson} />
        </Button>
      </HStack>
    );
  }
  if (props.onClose) {
    return (
      <Button action={props.onClose}>
        <Image systemName="xmark" foregroundStyle={RELOC_COLORS.crimson} />
      </Button>
    );
  }
  if (props.homeTabSwitcher) {
    return (
      <HomePageSwitcherMenu
        currentTab={props.homeTabSwitcher.currentTab}
        onSelectTab={props.homeTabSwitcher.onSelectTab}
        style="toolbar"
      />
    );
  }
  return null;
}
