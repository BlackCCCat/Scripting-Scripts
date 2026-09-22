import {
  ForEach,
  HStack,
  Image,
  LazyVStack,
  ScrollView,
  Text,
  VStack,
} from "scripting"
import type { VirtualNode } from "scripting"

import type { FavoriteField } from "../utils/favorite_fields"

export function FavoriteFieldsPanel(props: {
  fields: FavoriteField[]
  nativeGlassEffect: boolean
  onSelect: (field: FavoriteField) => void
  renderContextMenu?: (field: FavoriteField) => VirtualNode
}) {
  const cornerRadius = 10
  return (
    <ScrollView axes="vertical" scrollIndicator="hidden" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <LazyVStack spacing={7} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <ForEach
          count={props.fields.length}
          itemBuilder={(index) => {
            const field = props.fields[index]
            if (!field) return null as any
            return (
              <HStack
                key={field.id}
                spacing={0}
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                background={"rgba(0,0,0,0.001)" as any}
                contentShape="rect"
                onTapGesture={() => props.onSelect(field)}
                contextMenu={props.renderContextMenu ? {
                  menuItems: props.renderContextMenu(field),
                } : undefined}
              >
                <HStack
                  spacing={10}
                  frame={{ maxWidth: "infinity", alignment: "center" as any }}
                  padding={10}
                  background={props.nativeGlassEffect
                    ? "clear" as any
                    : { style: "secondarySystemBackground", shape: { type: "rect", cornerRadius } }}
                  glassEffect={props.nativeGlassEffect
                    ? { type: "rect", cornerRadius } as any
                    : undefined}
                  clipShape={{ type: "rect", cornerRadius } as any}
                >
                  <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    <Text
                      font="caption"
                      foregroundStyle="secondaryLabel"
                      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                      multilineTextAlignment="leading"
                    >
                      {field.name}
                    </Text>
                    <Text
                      font="subheadline"
                      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                      multilineTextAlignment="leading"
                    >
                      {field.value}
                    </Text>
                  </VStack>
                  <Image systemName="text.cursor" foregroundStyle="systemBlue" />
                </HStack>
              </HStack>
            )
          }}
        />
      </LazyVStack>
    </ScrollView>
  )
}
