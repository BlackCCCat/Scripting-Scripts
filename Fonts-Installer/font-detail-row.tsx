import { Button, HStack, Text } from "scripting"
import { colors } from "./theme"

export function FontDetailRow(props: {
  label: string
  value: string
  trailing?: JSX.Element
}) {
  return (
    <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text
        font="subheadline"
        foregroundStyle={colors.secondary}
        frame={{ width: 92, alignment: "leading" }}
      >
        {props.label}
      </Text>
      <Text
        font="subheadline"
        foregroundStyle={colors.primary}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        lineLimit={1}
        truncationMode="tail"
        layoutPriority={0}
      >
        {props.value}
      </Text>
      {props.trailing ?? null}
    </HStack>
  )
}

export function CopyFontValueButton(props: {
  accessibilityLabel: string
  disabled?: boolean
  action: () => void
}) {
  return (
    <Button
      title=""
      systemImage="doc.on.doc"
      accessibilityLabel={props.accessibilityLabel}
      buttonStyle="plain"
      foregroundStyle={colors.accent}
      disabled={props.disabled}
      fixedSize={{ horizontal: true, vertical: true }}
      layoutPriority={1}
      action={props.action}
    />
  )
}
