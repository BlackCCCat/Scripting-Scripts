import { Text, ZStack, VStack, useObservable, useMemo, useEffect } from "scripting";
import { readSettings } from "../manager/Settings";

/**
 * 精确估算 footnote（约 13pt）字号下的单行文本渲染总宽度（pt）
 * 基于 iOS 系统字体 SF Pro Text 与 PingFang SC 13pt 真实度量值校准：
 * - CJK 统一表意文字及全角标点：13.0pt（1 em）
 * - 大写字母：约 8.6pt（M: 11.2pt, W: 10.5pt, I: 3.6pt）
 * - 数字 0-9：约 7.9pt
 * - 小写字母：普通约 7.2pt，宽字母 m: 11.2pt, w: 10.5pt，窄字母 r/t/f: 4.8pt，超窄 i/j/l: 3.6pt
 * - 标点与符号：空格/点/斜杠/冒号等约 3.6pt，连字符 4.8pt
 */
export function getEstimatedFootnoteTextWidth(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // 代理对（Emoji 等扩展字符）
    if (code >= 0xd800 && code <= 0xdbff) {
      width += 15;
      i++; // 跳过低位代理
      continue;
    }
    // CJK 与全角字符
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
      (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
      (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容
      (code >= 0xff01 && code <= 0xff60) || // 全角标点/符号
      (code >= 0x3000 && code <= 0x303f) || // CJK 符号和标点
      (code >= 0xac00 && code <= 0xd7af)    // 韩文音节
    ) {
      width += 13.0;
      continue;
    }
    // 极窄字符: i, j, l, I, 空格, 点, 逗号, 冒号, 分号, 感叹号, 竖线, 单引号, 斜杠
    if (
      code === 105 || // i
      code === 106 || // j
      code === 108 || // l
      code === 73  || // I
      code === 32  || // 空格
      code === 46  || // .
      code === 44  || // ,
      code === 58  || // :
      code === 59  || // ;
      code === 33  || // !
      code === 124 || // |
      code === 39  || // '
      code === 47     // /
    ) {
      width += 3.6;
    } else if (
      code === 102 || // f
      code === 114 || // r
      code === 116 || // t
      code === 45  || // -
      code === 40  || // (
      code === 41     // )
    ) {
      width += 4.8;
    } else if (code === 109 || code === 77) {
      // m, M
      width += 11.2;
    } else if (code === 119 || code === 87) {
      // w, W
      width += 10.5;
    } else if (code >= 65 && code <= 90) {
      // 其它大写英文字母 A-Z
      width += 8.6;
    } else if (code >= 48 && code <= 57) {
      // 数字 0-9
      width += 7.9;
    } else {
      // 其它小写字母与常见字符
      width += 7.2;
    }
  }
  return width;
}

/**
 * 估算 headline（约 17pt）字号下的文本渲染宽度（pt）
 * 基于 SF Pro / PingFang SC 17pt 测算（约等于 footnote 13pt 宽度的 1.308 倍）
 */
export function getEstimatedHeadlineTextWidth(text: string): number {
  if (!text) return 0;
  return Math.ceil(getEstimatedFootnoteTextWidth(text) * (17 / 13));
}

// 网格图标正下方的固定可视宽度：与 64pt 图标及 80pt 最小列宽适配，确保左右与相邻网格保持至少 18pt 物理隔离
const CARD_TEXT_WIDTH = 74;

interface GridFileNameProps {
  name: string;
  /** 是否启用滚动（可选，默认跟随设置中的 gridFileNameMarquee） */
  marqueeEnabled?: boolean;
  /** 是否处于焦点状态（切换 Tab / 页面切回时自动重启滚动） */
  isFocused?: boolean;
}

export function GridFileName({ name, marqueeEnabled, isFocused = true }: GridFileNameProps) {
  const isMarqueeActive = marqueeEnabled ?? (readSettings().gridFileNameMarquee ?? true);
  const estimatedWidth = useMemo(() => getEstimatedFootnoteTextWidth(name), [name]);
  const isOverflow = estimatedWidth > CARD_TEXT_WIDTH;

  if (!isMarqueeActive) {
    // 仅在用户主动关闭设置时使用两行折行：配置 truncationMode="middle"（首尾显示，中间以 ... 替代）
    return (
      <VStack alignment="center" frame={{ width: CARD_TEXT_WIDTH, height: 34 }}>
        <Text
          font="footnote"
          lineLimit={2}
          multilineTextAlignment="center"
          truncationMode="middle"
          foregroundStyle="label"
        >
          {name}
        </Text>
      </VStack>
    );
  }

  if (!isOverflow || !isFocused) {
    // 单行能完整容纳，或处于后台非焦点状态：居中单行静态展示，保证切页时绝对单行，绝不折成多行
    return (
      <VStack alignment="center" frame={{ width: CARD_TEXT_WIDTH, height: 34 }}>
        <Text
          font="footnote"
          lineLimit={1}
          multilineTextAlignment="center"
          truncationMode="middle"
          foregroundStyle="label"
        >
          {name}
        </Text>
      </VStack>
    );
  }

  // 启用了滚动、单行放不下、且处于当前前台焦点页面：挂载全新实例，从头（起始位置 0）开始干净启动往返滚动
  return (
    <ScrollingGridFileName
      key={name}
      name={name}
      estimatedWidth={estimatedWidth}
    />
  );
}

function ScrollingGridFileName({
  name,
  estimatedWidth,
}: {
  name: string;
  estimatedWidth: number;
}) {
  // 滚动距离：文本实际宽度超出 74pt 视口的部分
  // 真实排版存在字偶距紧缩（Kerning），无字距累加宽度略大 2~3pt。扣除 2pt 安全缓冲以确保右端精准对齐最后字符，绝不滑出留白
  const scrollDistance = Math.max(0, Math.floor(estimatedWidth - CARD_TEXT_WIDTH - 2));
  // 滚动速度控制在 ~20pt/s，平滑且文字清晰可读
  const duration = Math.max(2.5, Math.min(10, scrollDistance / 20));

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
  }, [name, scrollDistance]);

  return (
    <ZStack
      alignment="leading"
      frame={{ width: CARD_TEXT_WIDTH, height: 34, alignment: "leading" }}
      clipped
      contentShape="rect"
    >
      <Text
        font="footnote"
        lineLimit={1}
        fixedSize={{ horizontal: true, vertical: false }}
        foregroundStyle="label"
        {...animationConfig}
      >
        {name}
      </Text>
    </ZStack>
  );
}
