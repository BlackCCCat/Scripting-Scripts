// Scripting Photos uses limit: 0 to fetch every matching PHAsset.
// Images are still decoded lazily around the current card only.
export const FETCH_LIMIT = 0
export const SWIPE_THRESHOLD = 96
export const CARD_CORNER_RADIUS = 22

export const screenWidth = Device.screen.width
export const screenHeight = Device.screen.height
export const cardWidth = Math.min(screenWidth - 24, 480)
export const cardHeight = Math.max(300, Math.min(screenHeight - 280, 640))

// Toolbar trailing trash icon is near the screen's upper-right corner.
// These factors keep the flying card visible long enough, then make it disappear near the button.
export const trashTargetOffset = {
  x: screenWidth * 0.42,
  y: -screenHeight * 0.58,
}

export const maxRightInteractiveLift = Math.min(screenHeight * 0.34, 260)

export const skipTargetOffset = {
  x: -screenWidth * 0.86,
  y: 0,
}
