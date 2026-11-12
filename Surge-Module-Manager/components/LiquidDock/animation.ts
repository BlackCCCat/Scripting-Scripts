export const selectionDockAnimation = (): Animation => Animation.smooth({ duration: 0.4, extraBounce: 0 })

// 给内部形变留下可辨认的蓄力阶段；与气泡按压、编辑图标形变分别驱动。
export const dockIconSelectionAnimation = (anticipating: boolean): Animation => anticipating
  ? Animation.easeOut(0.17)
  : Animation.spring({ duration: 0.5, bounce: 0.26 })

// Tab保留已验收的0.2秒按压。菜单与回落同时起动，采用TG上下文菜单独立的展开节奏。
export const dockPressAnimation = (): Animation => Animation.spring({ duration: 0.2, bounce: 0.06 })
export { anchoredMenuAnimation as dockMenuAnimation } from "../AnchoredMenu/animation"
