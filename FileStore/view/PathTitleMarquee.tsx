import { Text, ZStack, useObservable, useMemo, useEffect } from "scripting";
import { getEstimatedHeadlineTextWidth } from "./GridFileName";

export interface PathTitleMarqueeProps {
  path: string;
  /** 是否处于双栏紧凑宽度模式 */
  isDualMode?: boolean;
  /** 是否处于当前焦点页面 */
  isFocused?: boolean;
}

/**
 * 顶部当前文件夹路径跑马灯组件
 * - 紧凑/双栏分栏模式下限制可视宽度为 78pt（适配分栏左右两侧按钮安全间距，杜绝遮挡），常规单栏模式为 180pt；
 * - 路径超长且处于当前焦点页面时，在固定宽度视口内平滑往返滚动；
 * - 注意：此处的路径滚动不跟随设置中的网格文件名滚动开关，只要路径超长无法完整显示就必须触发自动平滑滚动；
 * - 页面切换焦点时自动重启动画，切换文件夹（path 变化）时通过 key={path} 干净重置到起始位置；
 * - 纯 View 封装，作为 Menu 的 label 使用时 100% 保留原生点击与长按呼出菜单能力。
 */
export function PathTitleMarquee({ path, isDualMode, isFocused = true }: PathTitleMarqueeProps) {
  // 双栏模式每栏宽度约 180~200pt，两边按钮与外边距占用后，中间标题安全视口为 78pt；单栏安全视口为 180pt
  const maxWidth = isDualMode ? 78 : 180;
  const estimatedWidth = useMemo(() => getEstimatedHeadlineTextWidth(path), [path]);
  const isOverflow = estimatedWidth > maxWidth;

  if (!isOverflow || !isFocused) {
    return (
      <ZStack frame={{ width: maxWidth, height: 26, alignment: "center" }} clipped>
        <Text font="headline" lineLimit={1} truncationMode="middle">
          {path}
        </Text>
      </ZStack>
    );
  }

  return (
    <ScrollingPathTitle
      key={`${path}-${isDualMode}`}
      path={path}
      maxWidth={maxWidth}
      estimatedWidth={estimatedWidth}
    />
  );
}

function ScrollingPathTitle({
  path,
  maxWidth,
  estimatedWidth,
}: {
  path: string;
  maxWidth: number;
  estimatedWidth: number;
}) {
  const scrollDistance = Math.max(0, Math.floor(estimatedWidth - maxWidth));
  const duration = Math.max(2.5, Math.min(12, scrollDistance / 24));

  const offsetX = useObservable(0);

  const animationObj = useMemo(() => {
    try {
      const Anim = typeof Animation !== "undefined" ? Animation : (globalThis as any).Animation;
      return Anim?.smooth({ duration })?.repeatForever(true);
    } catch {
      return undefined;
    }
  }, [duration]);

  const animationConfig = useMemo(() => {
    return {
      offset: { x: offsetX.value, y: 0 },
      animation: animationObj
        ? {
            animation: animationObj,
            value: offsetX.value,
          }
        : undefined,
    };
  }, [offsetX.value, animationObj]);

  useEffect(() => {
    // 挂载后始终从起始位置 0 开始，延时 1.2 秒后启动自动往返平滑滚动
    offsetX.setValue(0);
    const timer = setTimeout(() => {
      offsetX.setValue(-scrollDistance);
    }, 1200);
    return () => {
      clearTimeout(timer);
    };
  }, [path, scrollDistance]);

  return (
    <ZStack
      alignment="leading"
      frame={{ width: maxWidth, height: 26, alignment: "leading" }}
      clipped
      contentShape="rect"
    >
      <Text
        font="headline"
        lineLimit={1}
        fixedSize={{ horizontal: true, vertical: false }}
        foregroundStyle="label"
        {...animationConfig}
      >
        {path}
      </Text>
    </ZStack>
  );
}
