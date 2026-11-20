import {
  ForEach,
  HStack,
  Image,
  LazyVStack,
  ScrollView,
  Text,
  useEffect,
  useObservable,
  VStack,
} from "scripting"
import type { VirtualNode } from "scripting"

import type { FavoriteField, PrivateFieldRule } from "../utils/favorite_fields"
import { displayFavoriteFieldValue } from "../utils/favorite_fields"

export function FavoriteFieldsPanel(props: {
  fields: FavoriteField[]
  privateKeywords: PrivateFieldRule[]
  nativeGlassEffect: boolean
  hideScrollEffects?: boolean
  onSelect: (field: FavoriteField) => void
  renderContextMenu?: (field: FavoriteField) => VirtualNode
}) {
  const cornerRadius = 10
  const fields = useObservable(props.fields)
  useEffect(() => {
    if (fields.value !== props.fields) fields.setValue(props.fields)
  }, [props.fields])
  return (
    <ScrollView
      axes="vertical"
      scrollIndicator="hidden"
      scrollContentBackground={props.hideScrollEffects ? "hidden" : undefined}
      scrollEdgeEffectHidden={props.hideScrollEffects ? true : undefined}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      <LazyVStack spacing={7} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
        <ForEach
          data={fields}
          builder={(field) => {
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
                      {displayFavoriteFieldValue(field, props.privateKeywords)}
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
