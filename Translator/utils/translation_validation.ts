import type { TranslationRequest } from "../types"

export function isLikelyUntranslated(
  request: TranslationRequest,
  translatedText: string,
  minimumLength = 8
) {
  if (
    request.sourceLanguageCode !== "auto" &&
    request.sourceLanguageCode === request.targetLanguageCode
  ) return false

  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase()
  const source = normalize(request.sourceText)
  const translated = normalize(translatedText)
  if (!source || source !== translated) return false
  if (!/\p{L}/u.test(source) || /^https?:\/\/\S+$/i.test(source)) return false

  const chineseToEnglish = request.sourceLanguageCode.startsWith("zh") &&
    request.targetLanguageCode === "en"
  return source.length >= minimumLength || /\s/.test(source) ||
    (chineseToEnglish && /[\u4e00-\u9fff]{2}/.test(source))
}
