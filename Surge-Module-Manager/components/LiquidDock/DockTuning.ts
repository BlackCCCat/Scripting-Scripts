// Telegram-iOS 279f89e：TabBarComponent / LiquidLens / CAAnimationUtils。
// 0.4s 的 .spring 实际落到这个 timing curve；不是 CASpringAnimation 的默认参数。
export const telegramDock = {
 duration: .4,
 curve: [.38, .7, .125, 1] as const,
 restingInset: 4,
 liftedInset: 4,
 iconLiftScale: 1.15,
 // ContextGesture: beginDelay=.12，再推进.2秒 activation。
 contextHoldMs: 320,
} as const

// 本项目窄底栏的视觉标定：系统 inset 不是额外 padding，不能把 TG 的
// 内缩／外扩之和再叠加整栏缩放。只保留轻微浮起，位移形变另行计算。
export const dockPressure = {
 expansion: 4,
 railScale: 1.025,
 iconScale: 1.08,
} as const

// 系统轮廓未公开：参考 MetalLensView 的速度驱动阻尼模型，独立适配到槽距/秒。
// k=170、c=14、mass=1；原实现像素速度不能直接当作 Scripting 的 pt/s 使用。
export const liquidDeformation = {
 frequency: Math.sqrt(170),
 damping: 14 / (2 * Math.sqrt(170)),
 velocityScale: .055,
 maxStretch: .22,
} as const
