import type {
  TranslationProgressCallbacks,
  TranslationRequest,
  TranslationResult,
} from "../types"

type TranslateChunkOptions = {
  maxChunkLength?: number
  concurrency?: number
  translateChunk: (
    request: TranslationRequest,
    callbacks?: TranslationProgressCallbacks
  ) => Promise<TranslationResult>
}

function findChunkBoundary(text: string, maxLength: number) {
  const candidates = [
    text.lastIndexOf("\n\n", maxLength),
    text.lastIndexOf("\n", maxLength),
    text.lastIndexOf("。", maxLength),
    text.lastIndexOf("！", maxLength),
    text.lastIndexOf("？", maxLength),
    text.lastIndexOf(". ", maxLength),
    text.lastIndexOf("! ", maxLength),
    text.lastIndexOf("? ", maxLength),
    text.lastIndexOf("；", maxLength),
    text.lastIndexOf(";", maxLength),
    text.lastIndexOf("，", maxLength),
    text.lastIndexOf(", ", maxLength),
    text.lastIndexOf(" ", maxLength),
  ]

  const boundary = candidates.find((index) => index >= Math.floor(maxLength * 0.55))
  if (boundary == null || boundary < 1) {
    return maxLength
  }

  if (text.startsWith("\n\n", boundary)) {
    return boundary + 2
  }

  if (
    text.startsWith(". ", boundary) ||
    text.startsWith("! ", boundary) ||
    text.startsWith("? ", boundary) ||
    text.startsWith(", ", boundary)
  ) {
    return boundary + 1
  }

  return boundary + 1
}

export function splitTranslationText(text: string, maxLength = 700) {
  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxLength) {
    const boundary = findChunkBoundary(remaining, maxLength)
    chunks.push(remaining.slice(0, boundary))
    remaining = remaining.slice(boundary)
  }

  if (remaining.length > 0) {
    chunks.push(remaining)
  }

  return chunks.filter((chunk) => chunk.length > 0)
}

function buildVisiblePartialText(completedChunks: string[], partialChunks: string[]) {
  let combined = ""

  for (let index = 0; index < completedChunks.length; index += 1) {
    if (completedChunks[index]) {
      combined += completedChunks[index]
      continue
    }

    if (partialChunks[index]) {
      combined += partialChunks[index]
    }
    break
  }

  return combined
}

export async function translateChunkedText(
  request: TranslationRequest,
  options: TranslateChunkOptions,
  callbacks?: TranslationProgressCallbacks
): Promise<TranslationResult> {
  const chunks = splitTranslationText(request.sourceText, options.maxChunkLength ?? 700)
  if (chunks.length === 1) {
    return await options.translateChunk(request, callbacks)
  }

  const completedChunks = new Array<string>(chunks.length).fill("")
  const partialChunks = new Array<string>(chunks.length).fill("")
  let nextChunkIndex = 0
  let lastVisiblePartialText = ""

  async function emitVisiblePartialText() {
    if (!callbacks?.onPartialText) return

    const text = buildVisiblePartialText(completedChunks, partialChunks)
    if (!text || text === lastVisiblePartialText) return

    lastVisiblePartialText = text
    await callbacks.onPartialText(text)
  }

  async function worker() {
    while (true) {
      const index = nextChunkIndex
      nextChunkIndex += 1
      if (index >= chunks.length) return

      const result = await options.translateChunk(
        {
          ...request,
          sourceText: chunks[index],
        },
        callbacks?.onPartialText ? {
          onPartialText: async (text: string) => {
            partialChunks[index] = text
            await emitVisiblePartialText()
          },
        } : undefined
      )

      completedChunks[index] = result.translatedText
      partialChunks[index] = ""
      await emitVisiblePartialText()
    }
  }

  const workerCount = Math.max(1, Math.min(options.concurrency ?? 1, chunks.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return {
    translatedText: completedChunks.join(""),
  }
}
