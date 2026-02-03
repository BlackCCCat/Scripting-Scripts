// Scripting Live Activity UI 组件：
// - LiveActivity/LiveActivityUI 用于注册与描述灵动岛/锁屏 UI
// - HStack/Text/Image/TimerIntervalLabel 等用于布局与计时展示
import {
  HStack,
  Image,
  LiveActivity,
  LiveActivityUI,
  LiveActivityUIExpandedCenter,
  Spacer,
  Text,
  TimerIntervalLabel,
} from "scripting"

// Live Activity 状态类型
import type { TimerActivityState } from "./types"

export function registerTimerActivity() {
  // 注册 Live Activity：名称需与主脚本启动时一致
  return LiveActivity.register<TimerActivityState>("calendar-loger-timer", (state) => {
    // 将时间戳转换为 Date，供 TimerIntervalLabel 使用
    const fromDate = new Date(state.from)
    const toDate = new Date(state.to)
    const pauseDate = state.pauseTime ? new Date(state.pauseTime) : undefined
    // 标题过长时裁剪，避免锁屏溢出
    const displayTitle = state.title.length > 12 ? `${state.title.slice(0, 12)}...` : state.title
    // 日历名称可能为空
    const calendarTitle = state.calendarTitle ?? ""
    // 倒计时蓝色，正计时绿色
    const accentColor = state.countsDown ? "systemBlue" : "systemGreen"
    // 图标：倒计时用 restart，正计时用 play
    const iconName = state.countsDown ? "restart" : "play"

    // 默认计时标签（支持暂停）
    const timerNode = (
      <TimerIntervalLabel
        from={fromDate}
        to={toDate}
        pauseTime={pauseDate}
        countsDown={state.countsDown}
        foregroundStyle={accentColor}
      />
    )

    // 紧凑态使用不显示小时，减小宽度
    const compactTimerNode = (
      <TimerIntervalLabel
        from={fromDate}
        to={toDate}
        pauseTime={pauseDate}
        countsDown={state.countsDown}
        showsHours={false}
        foregroundStyle={accentColor}
      />
    )

    // 统一的图标节点
    const iconNode = (
      <Image systemName={iconName} foregroundStyle={accentColor} imageScale="large" />
    )

    // 紧凑态左侧（仅图标）
    const compactLeadingNode = (
      <HStack spacing={0} frame={{ width: 22, alignment: "center" }}>
        {iconNode}
      </HStack>
    )

    // 紧凑态右侧（计时文本），限制宽度避免灵动岛过宽
    const compactTrailingNode = (
      <HStack
        spacing={0}
        frame={{ minWidth: 0, idealWidth: 56, maxWidth: 64, alignment: "trailing" }}
      >
        {compactTimerNode}
      </HStack>
    )

    // 最小化态（只显示图标）
    const minimalNode = (
      <HStack spacing={0} frame={{ width: 22, alignment: "center" }}>
        {iconNode}
      </HStack>
    )

    // 锁屏/顶部横幅内容（单行）
    const lockScreenContent = (
      <HStack spacing={8} padding={{ top: 6, bottom: 6, leading: 12, trailing: 12 }}>
        {iconNode}
        <Text font="headline" foregroundStyle={accentColor} lineLimit={1}>
          {displayTitle}
        </Text>
        {timerNode}
        <Spacer />
        {calendarTitle ? (
          <Text foregroundStyle="secondaryLabel" lineLimit={1}>
            {calendarTitle}
          </Text>
        ) : null}
      </HStack>
    )

    // 灵动岛展开态（中间区域）
    const islandExpandedContent = (
      <HStack
        spacing={6}
        frame={{ minWidth: 0, idealWidth: 96, maxWidth: 110, alignment: "center" }}
      >
        {iconNode}
        {timerNode}
      </HStack>
    )

    // Live Activity 各区域的 UI 组合
    return (
      <LiveActivityUI
        content={lockScreenContent}
        compactLeading={compactLeadingNode}
        compactTrailing={compactTrailingNode}
        minimal={minimalNode}
      >
        <LiveActivityUIExpandedCenter>
          {islandExpandedContent}
        </LiveActivityUIExpandedCenter>
      </LiveActivityUI>
    )
  })
}
