import {
  AlarmLiveActivity,
  type AlarmLiveActivityAction,
  type AlarmLiveActivityState,
  Button,
  HStack,
  Image,
  Label,
  LiveActivityUI,
  LiveActivityUIExpandedBottom,
  LiveActivityUIExpandedCenter,
  Spacer,
  ProgressView,
  Text,
  TimerIntervalLabel,
  VStack,
} from "scripting"

import {
  CancelPomodoroTimerIntent,
  StopPomodoroTimerIntent,
} from "./app_intents"
import { COUNT_UP_WINDOW_MS } from "./constants"

const ALARM_LIVE_ACTIVITY_NAME = "CalendarPomodoroAlarmActivity"

type PomodoroAlarmMetadata = {
  title?: string
  calendarTitle?: string
  startAt?: string
  duration?: string
  unlimited?: string
}

function asDate(value: Date | number | string | null | undefined) {
  if (value instanceof Date) return value
  if (value == null) return new Date()
  return new Date(value)
}

function isUnlimited(state: AlarmLiveActivityState<PomodoroAlarmMetadata>) {
  return state.metadata.unlimited === "true"
}

function alarmTitle(state: AlarmLiveActivityState<PomodoroAlarmMetadata>) {
  return state.metadata.title ?? state.presentation.countdown?.title ?? state.title
}

function alarmCalendarTitle(state: AlarmLiveActivityState<PomodoroAlarmMetadata>) {
  return state.metadata.calendarTitle ?? ""
}

function alarmIconName(state: AlarmLiveActivityState<PomodoroAlarmMetadata>) {
  if (isUnlimited(state)) return "infinity"
  return "timer"
}

function alarmTint(state: AlarmLiveActivityState<PomodoroAlarmMetadata>) {
  if (isUnlimited(state)) return "systemPurple"
  return "systemOrange"
}

function AlarmTimerLabel({
  state,
  compact,
}: {
  state: AlarmLiveActivityState<PomodoroAlarmMetadata>
  compact?: boolean
}) {
  const pausedAt = state.mode === "paused" ? new Date() : undefined

  if (isUnlimited(state)) {
    const startAt = Number(state.metadata.startAt ?? Date.now())
    const duration = Number(state.metadata.duration ?? 0)
    const elapsedWhenPaused =
      state.paused
        ? Math.max(0, duration - state.paused.remainingDuration) * 1000
        : 0
    const from = state.mode === "paused"
      ? new Date(Date.now() - elapsedWhenPaused)
      : new Date(startAt)
    return (
      <TimerIntervalLabel
        from={from}
        to={new Date(from.getTime() + COUNT_UP_WINDOW_MS)}
        pauseTime={pausedAt}
        countsDown={false}
        showsHours={compact ? false : undefined}
        foregroundStyle={alarmTint(state)}
      />
    )
  }

  if (state.mode === "paused" && state.paused) {
    return (
      <Text foregroundStyle={alarmTint(state)} monospacedDigit>
        {Math.ceil(state.paused.remainingDuration / 60)}m
      </Text>
    )
  }

  const fireDate = asDate(state.countdown?.fireDate)
  return (
    <TimerIntervalLabel
      from={new Date()}
      to={fireDate}
      countsDown
      showsHours={compact ? false : undefined}
      foregroundStyle={alarmTint(state)}
    />
  )
}

function ActionButton({
  action,
  fallbackImage,
  role,
  title,
}: {
  action: AlarmLiveActivityAction
  fallbackImage: string
  role?: "destructive"
  title?: string
}) {
  return (
    <Button
      intent={action.intent}
      role={role}
      buttonStyle={role === "destructive" ? undefined : "glassProminent"}
      controlSize="small"
    >
      <Label title={title ?? action.title} systemImage={action.systemImageName ?? fallbackImage} />
    </Button>
  )
}

function AlarmActionButtons({ state }: { state: AlarmLiveActivityState<PomodoroAlarmMetadata> }) {
  return (
    <HStack spacing={8}>
      {state.actions.pause ? (
        <ActionButton action={state.actions.pause} fallbackImage="pause.fill" title="暂停" />
      ) : null}
      {state.actions.resume ? (
        <ActionButton action={state.actions.resume} fallbackImage="play.fill" title="继续" />
      ) : null}
      <Button
        intent={CancelPomodoroTimerIntent({ alarmId: state.alarmID })}
        role="destructive"
        controlSize="small"
      >
        <Label title="取消" systemImage="xmark" />
      </Button>
      <Button
        intent={StopPomodoroTimerIntent({ alarmId: state.alarmID })}
        role="destructive"
        controlSize="small"
      >
        <Label title="停止" systemImage="stop.fill" />
      </Button>
    </HStack>
  )
}

function LockScreenContent(state: AlarmLiveActivityState<PomodoroAlarmMetadata>) {
  const title = alarmTitle(state)
  const displayTitle = title.length > 12 ? `${title.slice(0, 12)}...` : title
  const calendarTitle = alarmCalendarTitle(state)
  const isCountingDown = !isUnlimited(state) && state.mode === "countdown" && state.countdown != null
  const fireDate = asDate(state.countdown?.fireDate)
  const timerStart = new Date(
    fireDate.getTime() - (state.countdown?.totalCountdownDuration ?? 0) * 1000,
  )

  return (
    <VStack alignment="leading" spacing={14} padding={16}>
      <HStack spacing={12}>
        <Image systemName={alarmIconName(state)} foregroundStyle={alarmTint(state)} imageScale="large" />
        <VStack alignment="leading" spacing={2}>
          <Text font="caption" foregroundStyle="secondaryLabel" textCase="uppercase">
            {calendarTitle || "Calendar Pomodoro"}
          </Text>
          <Text font="headline" fontWeight="semibold" foregroundStyle={alarmTint(state)} lineLimit={1}>
            {displayTitle}
          </Text>
        </VStack>
        <AlarmTimerLabel state={state} />
        <Spacer />
        <Text foregroundStyle="secondaryLabel" lineLimit={1}>
          {isUnlimited(state) ? "不限时" : "专注"}
        </Text>
      </HStack>

      {isCountingDown ? (
        <ProgressView
          timerFrom={timerStart}
          timerTo={fireDate}
          countsDown
          progressViewStyle="linear"
          tint={alarmTint(state)}
        />
      ) : null}

      <HStack spacing={8}>
        <AlarmActionButtons state={state} />
      </HStack>
    </VStack>
  )
}

AlarmLiveActivity.register<PomodoroAlarmMetadata>(ALARM_LIVE_ACTIVITY_NAME, (state) => {
  const iconNode = (
    <Image systemName={alarmIconName(state)} foregroundStyle={alarmTint(state)} imageScale="large" />
  )

  return (
    <LiveActivityUI
      content={<LockScreenContent {...state} />}
      compactLeading={
        <HStack spacing={0} frame={{ width: 24, alignment: "center" }}>
          {iconNode}
        </HStack>
      }
      compactTrailing={
        <HStack
          spacing={0}
          frame={{ minWidth: 0, idealWidth: 56, maxWidth: 64, alignment: "trailing" }}
        >
          <AlarmTimerLabel state={state} compact />
        </HStack>
      }
      minimal={
        <HStack spacing={0} frame={{ width: 24, alignment: "center" }}>
          {iconNode}
        </HStack>
      }
    >
      <LiveActivityUIExpandedCenter>
        <HStack
          spacing={6}
          frame={{ minWidth: 0, idealWidth: 96, maxWidth: 110, alignment: "center" }}
        >
          {iconNode}
          <AlarmTimerLabel state={state} />
        </HStack>
      </LiveActivityUIExpandedCenter>
      <LiveActivityUIExpandedBottom>
        <AlarmActionButtons state={state} />
      </LiveActivityUIExpandedBottom>
    </LiveActivityUI>
  )
})
