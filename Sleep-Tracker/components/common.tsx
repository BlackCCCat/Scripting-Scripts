import { Button, HStack, Spacer, Text, VStack } from "scripting"
import { palette, scoreEmoji, scoreTone } from "../theme"

export function SoftCard(props: {
  title?: string
  subtitle?: string
  trailing?: JSX.Element | null
  padding?: number
  children?: JSX.Element | JSX.Element[] | null
}) {
  return (
    <VStack
      spacing={12}
      padding={props.padding ?? 18}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      background={{ style: palette.card, shape: { type: "rect", cornerRadius: 24 } }}
      shadow={{ color: "rgba(0,0,0,0.16)", radius: 16, y: 6 }}
    >
      {props.title || props.subtitle || props.trailing ? (
        <HStack alignment="top" spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <VStack spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            {props.title ? (
              <Text font="title3" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                {props.title}
              </Text>
            ) : null}
            {props.subtitle ? (
              <Text font="caption" foregroundStyle={palette.mutedInk} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                {props.subtitle}
              </Text>
            ) : null}
          </VStack>
          {props.trailing ?? null}
        </HStack>
      ) : null}
      {props.children ?? null}
    </VStack>
  )
}

export function MetricTile(props: {
  label: string
  value: string
  hint?: string
  tone?: string
}) {
  return (
    <VStack
      spacing={4}
      padding={14}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      background={{ style: palette.cardSoft, shape: { type: "rect", cornerRadius: 18 } }}
    >
      <Text font="caption" foregroundStyle={palette.mutedInk} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        {props.label}
      </Text>
      <Text font="title2" foregroundStyle={(props.tone ?? palette.sleepCore) as any} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        {props.value}
      </Text>
      {props.hint ? (
        <Text font="caption2" foregroundStyle={palette.mutedInk} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          {props.hint}
        </Text>
      ) : null}
    </VStack>
  )
}

export function ScoreHero(props: {
  score: number | null
  title: string
  subtitle: string
}) {
  return (
    <SoftCard
      title={props.title}
      subtitle={props.subtitle}
      trailing={<Text font="title2">{scoreEmoji(props.score)}</Text>}
    >
      <HStack alignment="bottom" spacing={6}>
        <Text font={{ size: 64, weight: "light" } as any} foregroundStyle={scoreTone(props.score) as any}>
          {props.score == null ? "--" : String(props.score)}
        </Text>
        <Text font="title3" foregroundStyle={palette.mutedInk}>
          %
        </Text>
        <Spacer />
      </HStack>
    </SoftCard>
  )
}

export function HorizontalMetricBar(props: {
  label: string
  value: string
  ratio: number
  tone?: string
  hint?: string
  labelTone?: string
  valueTone?: string
  showMarker?: boolean
}) {
  const safeRatio = Math.max(0, Math.min(1, props.ratio))
  return (
    <VStack spacing={6}>
      <HStack>
        <HStack spacing={6}>
          {props.showMarker ? <Text foregroundStyle={(props.tone ?? palette.accent) as any}>●</Text> : null}
          <Text font="body" foregroundStyle={(props.labelTone ?? palette.ink) as any}>
            {props.label}
          </Text>
        </HStack>
        <Spacer />
        <Text font="body" foregroundStyle={(props.valueTone ?? palette.mutedInk) as any}>
          {props.value}
        </Text>
      </HStack>
      <HStack
        frame={{ width: "100%" as any, height: 12 }}
        background={{ style: palette.line, shape: { type: "rect", cornerRadius: 999 } }}
      >
        <HStack
          frame={{ width: `${Math.max(6, safeRatio * 100)}%` as any, height: 12 }}
          background={{ style: (props.tone ?? palette.accent) as any, shape: { type: "rect", cornerRadius: 999 } }}
        />
      </HStack>
      {props.hint ? (
        <Text font="caption2" foregroundStyle={palette.mutedInk}>
          {props.hint}
        </Text>
      ) : null}
    </VStack>
  )
}

export function DatePill(props: {
  id?: string
  labelTop: string
  labelBottom: string
  selected?: boolean
  onPress?: () => void
}) {
  return (
    <Button {...({ id: props.id } as any)} buttonStyle="plain" action={() => props.onPress?.()}>
      <VStack
        spacing={2}
        padding={{ horizontal: 10, vertical: 10 }}
        frame={{ minWidth: 44, alignment: "center" as any }}
        background={{
          style: (props.selected ? palette.accentSoft : "transparent") as any,
          shape: { type: "rect", cornerRadius: 18 },
        }}
      >
        <Text font="caption" foregroundStyle={props.selected ? palette.accentDeep : palette.mutedInk}>
          {props.labelTop}
        </Text>
        <Text font="headline" foregroundStyle={props.selected ? palette.accent : palette.mutedInk}>
          {props.labelBottom}
        </Text>
      </VStack>
    </Button>
  )
}

export function SegmentedChip(props: {
  label: string
  selected?: boolean
  onPress?: () => void
}) {
  return (
    <Button buttonStyle="plain" action={() => props.onPress?.()}>
      <Text
        padding={{ horizontal: 18, vertical: 10 }}
        background={{
          style: (props.selected ? palette.card : "transparent") as any,
          shape: { type: "rect", cornerRadius: 18 },
        }}
        foregroundStyle={props.selected ? palette.ink : palette.mutedInk}
      >
        {props.label}
      </Text>
    </Button>
  )
}
