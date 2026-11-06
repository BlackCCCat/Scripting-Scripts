import type { PhotoTextBlock } from "./photo_translation"

function isAdjacentText(first: PhotoTextBlock, second: PhotoTextBlock) {
  const a = first.box
  const b = second.box
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width))
  const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height))

  // OCR rows close to each other may share a sentence; separate columns stay independent.
  const adjacentRows = overlapX >= Math.min(a.width, b.width) * 0.3
    && gapY <= Math.max(0.025, Math.max(a.height, b.height) * 1.5)
  const sameRow = overlapY >= Math.min(a.height, b.height) * 0.4 && gapX <= 0.025
  return adjacentRows || sameRow
}

export function photoContext(blocks: PhotoTextBlock[], index: number) {
  const collect = (step: -1 | 1) => {
    const neighbors: string[] = []
    let cursor = index
    for (let count = 0; count < 2; count += 1) {
      const next = cursor + step
      if (next < 0 || next >= blocks.length || !isAdjacentText(blocks[cursor], blocks[next])) break
      neighbors.push(blocks[next].text)
      cursor = next
    }
    if (step < 0) neighbors.reverse()
    const text = neighbors.join(" ")
    return step < 0 ? text.slice(-180) : text.slice(0, 180)
  }

  const before = collect(-1)
  const after = collect(1)
  return before || after ? { before, after } : undefined
}
