import {
  AlarmLiveActivity,
  type AlarmLiveActivityAction,
  type AlarmLiveActivityState,
  type Color,
  Button,
  HStack,
  Image,
  Label,
  LiveActivityUI,
  LiveActivityUIExpandedBottom,
  LiveActivityUIExpandedCenter,
  LiveActivityUIExpandedLeading,
  LiveActivityUIExpandedTrailing,
  ProgressView,
  Spacer,
  Text,
  TimerIntervalLabel,
  VStack,
} from "scripting"
import { StopCustomAlarmIntent } from "./app_intents"

function dateValue(value: Date | number | string | null | undefined) {
  if (value instanceof Date) return value
  if (value == null) return new Date()
  return new Date(value)
}

function LockScreenRemainingLabel({
  state,
  font,
  tint,
}: {
  state: AlarmLiveActivityState
  font: "caption" | "title" | "title2" | "headline" | "subheadline"
  tint: Color
}) {
  if (state.countdown?.fireDate) {
    return (
      <TimerIntervalLabel
        from={new Date()}
        to={dateValue(state.countdown.fireDate)}
        countsDown
        showsHours={false}
        font={font}
        fontWeight="bold"
        fontDesign="rounded"
        monospacedDigit
        foregroundStyle={tint}
      />
    )
  }

  if (state.paused) {
    const minutes = Math.ceil(state.paused.remainingDuration / 60)
    return (
      <Text
        font={font}
        fontWeight="bold"
        fontDesign="rounded"
        monospacedDigit
        foregroundStyle={tint}
      >
        {minutes}分
      </Text>
    )
  }

  return (
    <Text font={font} fontWeight="semibold" foregroundStyle={tint}>
      {state.mode === "alerting" ? "响铃" : "已排"}
    </Text>
  )
}

function IslandRemainingLabel({
  state,
  font,
  tint,
  isCompact,
}: {
  state: AlarmLiveActivityState
  font: "caption" | "subheadline"
  tint: Color
  isCompact?: boolean
}) {
  if (state.countdown?.fireDate) {
    return (
      <TimerIntervalLabel
        from={new Date()}
        to={dateValue(state.countdown.fireDate)}
        countsDown
        showsHours={false}
        font={font}
        fontWeight="bold"
        fontDesign="rounded"
        monospacedDigit
        foregroundStyle={tint}
        frame={isCompact ? { width: 45, alignment: "trailing" } : { width: 55, alignment: "trailing" }}
      />
    )
  }

  if (state.paused) {
    const minutes = Math.ceil(state.paused.remainingDuration / 60)
    return (
      <Text
        font={font}
        fontWeight="bold"
        fontDesign="rounded"
        monospacedDigit
        foregroundStyle={tint}
        frame={isCompact ? { width: 45, alignment: "trailing" } : { width: 55, alignment: "trailing" }}
      >
        {minutes}分
      </Text>
    )
  }

  return (
    <Text font={font} fontWeight="semibold" foregroundStyle={tint}>
      {state.mode === "alerting" ? "响铃" : "已排"}
    </Text>
  )
}

function ActionButton({
  action,
  fallbackImage,
  title,
  role,
}: {
  action: AlarmLiveActivityAction
  fallbackImage: string
  title?: string
  role?: "destructive"
}) {
  return (
    <Button
      intent={action.intent}
      role={role}
      buttonStyle={role === "destructive" ? undefined : "glassProminent"}
      controlSize="small"
    >
      <Label
        title={title ?? action.title}
        systemImage={action.systemImageName ?? fallbackImage}
      />
    </Button>
  )
}

function AlarmControlButtons({ state }: { state: AlarmLiveActivityState }) {
  return (
    <HStack spacing={8}>
      {state.actions.pause && (
        <ActionButton
          action={state.actions.pause}
          fallbackImage="pause.fill"
          title="暂停"
        />
      )}
      {state.actions.resume && (
        <ActionButton
          action={state.actions.resume}
          fallbackImage="play.fill"
          title="继续"
        />
      )}
    </HStack>
  )
}

function StopAlarmButton({ state }: { state: AlarmLiveActivityState }) {
  const logicalAlarmId = state.metadata.logicalAlarmId
  if (!logicalAlarmId) {
    return <ActionButton action={state.actions.stop} fallbackImage="xmark" role="destructive" title="关闭" />
  }

  return (
    <Button
      intent={StopCustomAlarmIntent({
        alarmId: state.alarmID,
        logicalAlarmId,
      })}
      role="destructive"
      controlSize="small"
    >
      <Label title="关闭" systemImage="xmark" />
    </Button>
  )
}

function LockScreenView(state: AlarmLiveActivityState) {
  const tint: Color = state.tintColor ?? "#FF9500"
  const isCountingDown = state.mode === "countdown" && state.countdown != null
  const isPaused = state.mode === "paused" && state.paused != null

  let iconName = "bell.circle.fill"
  if (isCountingDown) iconName = "timer.circle.fill"
  if (isPaused) iconName = "pause.circle.fill"

  let titleText = state.title
  if (state.mode === "paused") {
    titleText = state.presentation.paused?.title ?? "推迟已暂停"
  } else if (state.mode === "countdown") {
    titleText = state.presentation.countdown?.title ?? "推迟提醒中"
  } else if (state.mode === "alerting") {
    titleText = state.presentation.alert.title ?? state.title
  }

  let timerStart = new Date()
  let fireDate = new Date()
  if (state.countdown) {
    fireDate = dateValue(state.countdown.fireDate)
    timerStart = new Date(fireDate.getTime() - (state.countdown.totalCountdownDuration ?? 0) * 1000)
  }

  return (
    <VStack alignment="leading" spacing={12} padding={{ top: 12, bottom: 12, leading: 16, trailing: 16 }}>
      <HStack spacing={10}>
        <Image
          systemName={iconName}
          foregroundStyle={tint}
          imageScale="large"
        />
        <VStack alignment="leading" spacing={2}>
          <Text font="headline" fontWeight="semibold" lineLimit={1}>
            {titleText}
          </Text>
        </VStack>
        <Spacer />
        <LockScreenRemainingLabel state={state} font="title2" tint={tint} />
      </HStack>

      {isCountingDown && (
        <ProgressView
          timerFrom={timerStart}
          timerTo={fireDate}
          countsDown
          progressViewStyle="linear"
          tint={tint}
        />
      )}

      <HStack spacing={8}>
        <AlarmControlButtons state={state} />
        <Spacer />
        <StopAlarmButton state={state} />
      </HStack>
    </VStack>
  )
}

AlarmLiveActivity.register("CustomAlarmActivity", state => {
  const tint: Color = state.tintColor ?? "#FF9500"

  return (
    <LiveActivityUI
      content={<LockScreenView {...state} />}
      compactLeading={
        <Image systemName="timer" foregroundStyle={tint} />
      }
      compactTrailing={
        <IslandRemainingLabel state={state} font="caption" tint={tint} isCompact />
      }
      minimal={
        <Image
          systemName={state.mode === "paused" ? "pause.fill" : "timer"}
          foregroundStyle={tint}
        />
      }>
      <LiveActivityUIExpandedLeading>
        <HStack padding={{ leading: 20 }}>
          <Text font="subheadline" fontWeight="semibold" lineLimit={1}>
            推迟中
          </Text>
        </HStack>
      </LiveActivityUIExpandedLeading>
      <LiveActivityUIExpandedTrailing>
        <HStack padding={{ trailing: 20 }}>
          <IslandRemainingLabel state={state} font="subheadline" tint={tint} />
        </HStack>
      </LiveActivityUIExpandedTrailing>
      <LiveActivityUIExpandedCenter>
        <Image
          systemName={state.mode === "paused" ? "pause.fill" : "timer"}
          foregroundStyle={tint}
        />
      </LiveActivityUIExpandedCenter>
      <LiveActivityUIExpandedBottom>
        <HStack spacing={8}>
          <AlarmControlButtons state={state} />
          <Spacer />
          <StopAlarmButton state={state} />
        </HStack>
      </LiveActivityUIExpandedBottom>
    </LiveActivityUI>
  )
})
