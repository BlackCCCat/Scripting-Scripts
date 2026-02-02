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

import type { TimerActivityState } from "./types"

export function registerTimerActivity() {
  return LiveActivity.register<TimerActivityState>("calendar-loger-timer", (state) => {
    const fromDate = new Date(state.from)
    const toDate = new Date(state.to)
    const pauseDate = state.pauseTime ? new Date(state.pauseTime) : undefined
    const displayTitle = state.title.length > 12 ? `${state.title.slice(0, 12)}...` : state.title
    const calendarTitle = state.calendarTitle ?? ""
    const accentColor = state.countsDown ? "systemBlue" : "systemGreen"
    const iconName = state.countsDown ? "restart" : "play"

    const timerNode = (
      <TimerIntervalLabel
        from={fromDate}
        to={toDate}
        pauseTime={pauseDate}
        countsDown={state.countsDown}
        foregroundStyle={accentColor}
      />
    )

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

    const iconNode = (
      <Image systemName={iconName} foregroundStyle={accentColor} imageScale="large" />
    )

    const compactLeadingNode = (
      <HStack spacing={0} frame={{ width: 22, alignment: "center" }}>
        {iconNode}
      </HStack>
    )

    const compactTrailingNode = (
      <HStack
        spacing={0}
        frame={{ minWidth: 0, idealWidth: 56, maxWidth: 64, alignment: "trailing" }}
      >
        {compactTimerNode}
      </HStack>
    )

    const minimalNode = (
      <HStack spacing={0} frame={{ width: 22, alignment: "center" }}>
        {iconNode}
      </HStack>
    )

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

    const islandExpandedContent = (
      <HStack
        spacing={6}
        frame={{ minWidth: 0, idealWidth: 96, maxWidth: 110, alignment: "center" }}
      >
        {iconNode}
        {timerNode}
      </HStack>
    )

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
