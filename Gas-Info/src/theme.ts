/** 全局配色与样式常量，统一橙色主题（参考设计图） */

import type { Color } from "scripting"

export const Theme = {
  /** 主橙色 */
  orange: "#F08A24",
  /** 头部卡片渐变 */
  headerGradient: ["#FBA94C", "#F0820F"] as Color[],
  /** 价格数字、强调文本橙色 */
  priceOrange: "#F0820F",
  /** 头部卡片内分组背景 */
  headerChipBg: "rgba(255,255,255,0.18)",
  /** 次级文本 */
  secondary: "secondaryLabel",
  /** 页面背景 */
  pageBg: "systemBackground",
  /** 液态玻璃卡片形状 */
  glassHeaderCard: { type: "rect", cornerRadius: 22 },
  glassCard: { type: "rect", cornerRadius: 14 },
  glassSmallCard: { type: "rect", cornerRadius: 12 },
  glassCircle: { type: "circle" },
} as const
