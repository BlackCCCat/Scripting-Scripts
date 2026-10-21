import {
  ZStack,
  VStack,
  Text,
  Image,
  ProgressView,
  Rectangle,
  gradient,
  useEffect,
  useState,
} from "scripting"
import { CARD_CORNER_RADIUS, SWIPE_THRESHOLD, cardWidth } from "../constants"
import type { CardMotionController, PointOffset } from "../types"
import { nextCardOffsetY, nextCardOpacity, nextCardScale } from "../utils"

const greenEdgeGradient = gradient("linear", {
  colors: ["rgba(52,199,89,0.85)", "rgba(52,199,89,0)"],
  startPoint: "top",
  endPoint: "bottom",
})
const redEdgeGradient = gradient("linear", {
  colors: ["rgba(255,59,48,0.85)", "rgba(255,59,48,0)"],
  startPoint: "bottom",
  endPoint: "top",
})
const edgeHeight = 72

type PhotoCardStackProps = {
  height: number
  currentImage: UIImage | null
  nextImage: UIImage | null
  showSkippedOnly: boolean
  motionController: CardMotionController
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
  height,
  highlight,
}: {
  image: UIImage | null
  scaleEffect: number
  offset: PointOffset
  opacity: number
  shadowOpacity: number
  zIndex: number
  height: number
  highlight?: { color: "green" | "red"; opacity: number }
}) {
  return (
    <ZStack
      frame={{ width: cardWidth, height }}
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
          frame={{ width: cardWidth, height }}
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
      {highlight ? (
        <Rectangle
          fill={highlight.color === "green" ? greenEdgeGradient : redEdgeGradient}
          frame={{ width: cardWidth, height: edgeHeight }}
          offset={{ x: 0, y: (highlight.color === "green" ? edgeHeight - height : height - edgeHeight) / 2 }}
          opacity={highlight.opacity}
          allowsHitTesting={false}
        />
      ) : null}
    </ZStack>
  )
}

function FixedGestureLayer({
  onDragChanged,
  onDragEnded,
  height,
}: {
  onDragChanged: (value: any) => void
  onDragEnded: (value: any) => void
  height: number
}) {
  return (
    <ZStack
      frame={{ width: cardWidth, height }}
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
  height,
  currentImage,
  nextImage,
  showSkippedOnly,
  motionController,
  onDragChanged,
  onDragEnded,
}: PhotoCardStackProps) {
  const [motion, setMotion] = useState(() => motionController.value)
  useEffect(() => {
    // Keep high-frequency gesture updates inside the two-card subtree.
    motionController.onChange = setMotion
    setMotion(motionController.value)
    return () => {
      if (motionController.onChange === setMotion) motionController.onChange = undefined
    }
  }, [motionController])
  const { offset: dragOffset, scale: cardScale, opacity: cardOpacity } = motion
  const verticalDrag = Math.abs(dragOffset.y) > Math.abs(dragOffset.x)
  const highlightOpacity = verticalDrag && (dragOffset.y < 0 || !showSkippedOnly)
    ? Math.min(1, Math.abs(dragOffset.y) / SWIPE_THRESHOLD)
    : 0

  return (
    <ZStack frame={{ width: cardWidth, height }}>
      <PhotoImageCard
        height={height}
        image={nextImage}
        scaleEffect={nextCardScale(dragOffset)}
        offset={{ x: 0, y: nextCardOffsetY(dragOffset) }}
        opacity={nextCardOpacity(dragOffset)}
        shadowOpacity={0.08}
        zIndex={1}
      />

      <PhotoImageCard
        height={height}
        image={currentImage}
        scaleEffect={cardScale}
        offset={dragOffset}
        opacity={cardOpacity}
        shadowOpacity={0.12}
        zIndex={2}
        highlight={{ color: verticalDrag && dragOffset.y > 0 ? "green" : "red", opacity: highlightOpacity }}
      />

      <FixedGestureLayer
        height={height}
        onDragChanged={onDragChanged}
        onDragEnded={onDragEnded}
      />
    </ZStack>
  )
}
