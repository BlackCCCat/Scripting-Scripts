import {
  cardWidth,
  maxRightInteractiveLift,
  screenWidth,
  trashTargetOffset,
} from "./constants"
import type { CardMotion, PointOffset } from "./types"

export function formatDate(timestamp: number | null): string {
  if (!timestamp) return "未知时间"

  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  const hour = `${date.getHours()}`.padStart(2, "0")
  const minute = `${date.getMinutes()}`.padStart(2, "0")

  return `${year}-${month}-${day} ${hour}:${minute}`
}

export function nextCardOpacity(offset: PointOffset): number {
  const distance = Math.abs(offset.x)
  return Math.min(1, 0.52 + distance / 260)
}

export function nextCardScale(offset: PointOffset): number {
  const distance = Math.abs(offset.x)
  return Math.min(1, 0.955 + distance / 2400)
}

export function nextCardOffsetY(offset: PointOffset): number {
  const distance = Math.abs(offset.x)
  return Math.max(0, 12 - distance / 22)
}

export function interactiveMotion(translation: PointOffset): CardMotion {
  const x = translation.x
  const y = translation.y
  const absX = Math.abs(x)
  const absY = Math.abs(y)

  const isHorizontal = absX > absY

  if (isHorizontal) {
    if (x > 0) {
      // Swiping right (go back) - Current card remains static in the center!
      return {
        offset: { x: 0, y: 0 },
        scale: 1,
        opacity: 1,
      }
    }
    // Horizontal page switching (left to skip)
    const progress = Math.min(1, absX / 240)
    return {
      offset: {
        x: x,
        y: y * 0.08,
      },
      scale: Math.max(0.92, 1 - progress * 0.08),
      opacity: Math.max(0.7, 1 - progress * 0.3),
    }
  } else {
    // Vertical deleting (up/down)
    const progress = Math.min(1, absY / 240)
    // Pull towards the trash target slightly to give visual hint
    const targetX = trashTargetOffset.x
    const targetY = trashTargetOffset.y
    return {
      offset: {
        x: x * 0.08 + targetX * progress * 0.3,
        y: y + (targetY - y) * progress * 0.2,
      },
      scale: Math.max(0.7, 1 - progress * 0.3),
      opacity: Math.max(0.6, 1 - progress * 0.4),
    }
  }
}

export function trashFlightMotion(_currentOffset: PointOffset): CardMotion {
  return {
    offset: trashTargetOffset,
    scale: 0.035,
    opacity: 0,
  }
}
