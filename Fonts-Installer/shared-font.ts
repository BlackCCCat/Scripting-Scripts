import { Path } from "scripting"

const supportedExtensions = new Set([".ttf", ".otf"])

// Only remove a bookmark whose path exactly matches this Intent's input.
export function removeBookmarksForSharedFont(sourcePath: string): number {
  if (!supportedExtensions.has(Path.extname(sourcePath).toLowerCase())) return 0

  const normalizedSourcePath = Path.normalize(sourcePath)
  let removedCount = 0
  for (const bookmark of FileManager.getAllFileBookmarks()) {
    if (Path.normalize(bookmark.path) !== normalizedSourcePath) continue
    if (FileManager.removeFileBookmark(bookmark.name)) removedCount += 1
  }
  return removedCount
}
