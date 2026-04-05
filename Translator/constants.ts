import type { LanguageOption, TranslationEngineOption } from "./types"

export const AUTO_LANGUAGE: LanguageOption = {
  code: "auto",
  label: "自动检测",
  promptName: "Auto detect",
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "zh-Hans", label: "简体中文", promptName: "Simplified Chinese" },
  { code: "zh-Hant", label: "繁体中文", promptName: "Traditional Chinese" },
  { code: "en", label: "英语", promptName: "English" },
  { code: "ja", label: "日语", promptName: "Japanese" },
  { code: "ko", label: "韩语", promptName: "Korean" },
  { code: "cs", label: "捷克语", promptName: "Czech" },
  { code: "da", label: "丹麦语", promptName: "Danish" },
  { code: "fr", label: "法语", promptName: "French" },
  { code: "de", label: "德语", promptName: "German" },
  { code: "el", label: "希腊语", promptName: "Greek" },
  { code: "es", label: "西班牙语", promptName: "Spanish" },
  { code: "fi", label: "芬兰语", promptName: "Finnish" },
  { code: "he", label: "希伯来语", promptName: "Hebrew" },
  { code: "hu", label: "匈牙利语", promptName: "Hungarian" },
  { code: "it", label: "意大利语", promptName: "Italian" },
  { code: "no", label: "挪威语", promptName: "Norwegian" },
  { code: "pt", label: "葡萄牙语", promptName: "Portuguese" },
  { code: "ro", label: "罗马尼亚语", promptName: "Romanian" },
  { code: "ru", label: "俄语", promptName: "Russian" },
  { code: "sv", label: "瑞典语", promptName: "Swedish" },
  { code: "ar", label: "阿拉伯语", promptName: "Arabic" },
  { code: "nl", label: "荷兰语", promptName: "Dutch" },
  { code: "pl", label: "波兰语", promptName: "Polish" },
  { code: "tr", label: "土耳其语", promptName: "Turkish" },
  { code: "uk", label: "乌克兰语", promptName: "Ukrainian" },
  { code: "vi", label: "越南语", promptName: "Vietnamese" },
  { code: "th", label: "泰语", promptName: "Thai" },
  { code: "id", label: "印度尼西亚语", promptName: "Indonesian" },
  { code: "ms", label: "马来语", promptName: "Malay" },
  { code: "hi", label: "印地语", promptName: "Hindi" },
]

export const TRANSLATION_ENGINE_OPTIONS: TranslationEngineOption[] = [
  {
    id: "apple_intelligence",
    label: "Apple Intelligence",
    systemImage: "apple.intelligence",
    isDefault: true,
  },
  {
    id: "system_translation",
    label: "System Translate",
    systemImage: "apple.logo",
    isDefault: true,
  },
  {
    id: "google_translate",
    label: "Google Translate",
    systemImage: "g.circle",
    isDefault: true,
  },
]
