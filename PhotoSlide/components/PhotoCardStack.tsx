import {
  ZStack,
  VStack,
  Text,
  Image,
  ProgressView,
} from "scripting"
import { CARD_CORNER_RADIUS, cardHeight, cardWidth } from "../constants"
import type { PhotoItem, PointOffset } from "../types"
import { nextCardOffsetY, nextCardOpacity, nextCardScale } from "../utils"

type PhotoCardStackProps = {
  currentItem: PhotoItem
  nextItem?: PhotoItem
  dragOffset: PointOffset
  cardScale: number
  cardOpacity: number
  onDragChanged: (value: any) => void
  onDragEnded: (value: any) => void
}

function PhotoImageCard({
  image,
  scaleEffect,
  offset,
  opacity,
  shadowOpacity,
  zIndex,
}: {
  image: UIImage | null
  scaleEffect: number
  offset: PointOffset
  opacity: number
  shadowOpacity: number
  zIndex: number
}) {
  return (
    <ZStack
      frame={{ width: cardWidth, height: cardHeight }}
      background="black"
      clipShape={{ type: "rect", cornerRadius: CARD_CORNER_RADIUS, style: "continuous" }}
      shadow={{ color: `rgba(0,0,0,${shadowOpacity})`, radius: 10, y: 4 }}
      offset={offset}
      scaleEffect={scaleEffect}
      opacity={opacity}
      zIndex={zIndex}
      allowsHitTesting={false}
    >
      {image ? (
        <Image
          image={image}
          resizable
          scaleToFit
          frame={{ width: cardWidth, height: cardHeight }}
          clipShape={{ type: "rect", cornerRadius: CARD_CORNER_RADIUS, style: "continuous" }}
          allowsHitTesting={false}
        />
      ) : (
        <VStack spacing={10}>
          <ProgressView />
          <Text font={13} foregroundStyle="tertiaryLabel">
            正在准备下一张…
          </Text>
        </VStack>
      )}
    </ZStack>
  )
}

function FixedGestureLayer({
  onDragChanged,
  onDragEnded,
}: {
  onDragChanged: (value: any) => void
  onDragEnded: (value: any) => void
}) {
  return (
    <ZStack
      frame={{ width: cardWidth, height: cardHeight }}
      background="clear"
      contentShape={{ type: "rect", cornerRadius: CARD_CORNER_RADIUS, style: "continuous" }}
      onDragGesture={{
        minDistance: 3,
        coordinateSpace: "local",
        onChanged: onDragChanged,
        onEnded: onDragEnded,
      }}
      zIndex={10}
    />
  )
}

export function PhotoCardStack({
  currentItem,
  nextItem,
  dragOffset,
  cardScale,
  cardOpacity,
  onDragChanged,
  onDragEnded,
}: PhotoCardStackProps) {
  return (
    <ZStack frame={{ width: cardWidth, height: cardHeight }}>
      <PhotoImageCard
        image={nextItem?.image ?? null}
        scaleEffect={nextCardScale(dragOffset)}
        offset={{ x: 0, y: nextCardOffsetY(dragOffset) }}
        opacity={nextCardOpacity(dragOffset)}
        shadowOpacity={0.08}
        zIndex={1}
      />

      <PhotoImageCard
        image={currentItem.image}
        scaleEffect={cardScale}
        offset={dragOffset}
        opacity={cardOpacity}
        shadowOpacity={0.12}
        zIndex={2}
      />

      <FixedGestureLayer
        onDragChanged={onDragChanged}
        onDragEnded={onDragEnded}
      />
    </ZStack>
  )
}
