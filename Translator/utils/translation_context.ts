import type { TranslationRequest } from "../types"

export function photoContextInstructions(request: TranslationRequest) {
  const { before, after } = request.photoContext ?? {}
  if (!before && !after) return []

  return [
    "The following OCR text is context only. Use it to understand a sentence spanning lines.",
    "Translate only the current text inside <text>; never include or translate the context in the output.",
    ...(before ? [`Previous OCR text: ${JSON.stringify(before)}`] : []),
    ...(after ? [`Next OCR text: ${JSON.stringify(after)}`] : []),
  ]
}
