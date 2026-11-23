import {
  Device,
  Divider,
  EmptyView,
  Rectangle,
  Section,
  Text,
  VStack,
  ZStack,
  type CommonViewProps,
  type Shape,
  type VirtualNode,
} from "scripting"

export const supportsLiquidGlass = Number.parseInt(Device.systemVersion, 10) >= 26
export const GLASS_CARD_SHAPE = { type: "rect", cornerRadius: 22, style: "continuous" } satisfies Shape
export const GLASS_CARD_APPEARANCE = {
  glassEffect: supportsLiquidGlass ? GLASS_CARD_SHAPE : undefined,
  background: supportsLiquidGlass ? undefined : {
    style: "secondarySystemGroupedBackground",
    shape: GLASS_CARD_SHAPE,
  },
} satisfies Pick<CommonViewProps, "glassEffect" | "background">

export const GRADIENT_SCROLL_APPEARANCE = {
  scrollContentBackground: "hidden",
  toolbarBackgroundVisibility: { visibility: "hidden", bars: ["navigationBar"] },
} satisfies Pick<CommonViewProps, "scrollContentBackground" | "toolbarBackgroundVisibility">

function transparentListRow(verticalInset: number) {
  return {
    listRowInsets: { top: verticalInset, bottom: verticalInset, leading: 16, trailing: 16 },
    listRowBackground: <Rectangle fill="clear" />,
    listRowSeparator: "hidden",
  } satisfies CommonViewProps
}

export function glassListRowAppearance() {
  return { ...GLASS_CARD_APPEARANCE, ...transparentListRow(5) }
}

export function PlainListText(props: { text: string; heading?: boolean }) {
  return (
    <Text
      font={props.heading ? "subheadline" : "footnote"}
      fontWeight={props.heading ? "semibold" : "regular"}
      foregroundStyle="secondaryLabel"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      {...transparentListRow(props.heading ? 8 : 4)}
    >
      {props.text}
    </Text>
  )
}

export function GlassListNotice(props: { text: string }) {
  return (
    <Text
      foregroundStyle="secondaryLabel"
      frame={{ maxWidth: "infinity", minHeight: 44, alignment: "leading" }}
      padding={{ leading: 16, trailing: 16 }}
      {...glassListRowAppearance()}
    >
      {props.text}
    </Text>
  )
}

export function GradientPage(props: { children: VirtualNode | (VirtualNode | null)[] }) {
  return (
    <ZStack>
      <Rectangle
        fill={{
          light: {
            stops: [
              { color: "#FFDAB2", location: 0 },
              { color: "#FFF1E3", location: 0.38 },
              { color: "#FBF7F4", location: 1 },
            ],
            startPoint: "topTrailing",
            endPoint: "bottomLeading",
          },
          dark: {
            stops: [
              { color: "#52331E", location: 0 },
              { color: "#2B211C", location: 0.38 },
              { color: "#171515", location: 1 },
            ],
            startPoint: "topTrailing",
            endPoint: "bottomLeading",
          },
        }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        ignoresSafeArea={{ regions: "container", edges: "all" }}
        allowsHitTesting={false}
        accessibilityHidden
      />
      {props.children}
    </ZStack>
  )
}

export function GlassSection(props: {
  header?: VirtualNode
  footer?: VirtualNode
  children: VirtualNode | VirtualNode[]
}) {
  const rows = Array.isArray(props.children) ? props.children : [props.children]

  return (
    <Section header={props.header} footer={props.footer}>
      <VStack
        spacing={0}
        frame={{ maxWidth: "infinity" }}
        padding={{ top: 5, bottom: 5 }}
        {...GLASS_CARD_APPEARANCE}
        listRowInsets={0}
        listRowBackground={<EmptyView />}
        listRowSeparator="hidden"
      >
        {rows.map((row, index) => (
          <VStack key={index} spacing={0} padding={{ leading: 16, trailing: 16 }}>
            {index > 0 ? <Divider /> : null}
            <VStack frame={{ maxWidth: "infinity", minHeight: 44, alignment: "leading" }}>
              {row}
            </VStack>
          </VStack>
        ))}
      </VStack>
    </Section>
  )
}
