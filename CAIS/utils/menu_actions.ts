import type {
  CaisSettings,
  KeyboardCustomAction,
  KeyboardMenuBuiltinAction,
} from "../types"
import { arabicNumberToChineseAmount, makeRegex, runJavaScriptTransform, runNetworkRequest } from "./custom_action"
import { hashString } from "./common"
import { renderRuntimeTemplate } from "./template"

export const CONFIGURABLE_MENU_BUILTIN_ACTIONS: KeyboardMenuBuiltinAction[] = [
  "tokenize",
  "base64Encode",
  "base64Decode",
  "cleanWhitespace",
  "removeBlankLines",
  "splitLines",
  "uppercase",
  "lowercase",
  "textBold",
  "textItalic",
  "textBoldItalic",
  "textMonospaced",
  "monospacedDigits",
  "textUnderline",
  "textStrikethrough",
  "extractLinks",
  "chineseAmount",
  "openUrl",
  "openUrlInApp",
]

export const MENU_BUILTIN_GROUPS: Array<{
  id: string
  title: string
  systemImage: string
  actions: KeyboardMenuBuiltinAction[]
}> = [
  {
    id: "textProcessing",
    title: "文本处理",
    systemImage: "text.alignleft",
    actions: ["tokenize", "base64Encode", "base64Decode", "cleanWhitespace", "removeBlankLines", "splitLines"],
  },
  {
    id: "textFormatting",
    title: "文本转换",
    systemImage: "textformat",
    actions: [
      "uppercase", "lowercase", "textBold", "textItalic", "textBoldItalic",
      "textMonospaced", "monospacedDigits", "textUnderline", "textStrikethrough", "chineseAmount",
    ],
  },
  {
    id: "links",
    title: "链接",
    systemImage: "link",
    actions: ["extractLinks", "openUrl", "openUrlInApp"],
  },
]

export function groupMenuBuiltins(actions: KeyboardMenuBuiltinAction[], ungrouped: KeyboardMenuBuiltinAction[] = []) {
  const ungroupedSet = new Set(ungrouped)
  return MENU_BUILTIN_GROUPS.map((group) => ({
    ...group,
    actions: actions.filter((action) => group.actions.includes(action) && !ungroupedSet.has(action)),
  })).filter((group) => group.actions.length > 0)
}

export type MenuActionResult =
  | { kind: "text"; text: string; writeToClipboard?: boolean }
  | { kind: "texts"; texts: string[] }
  | { kind: "image"; image: UIImage; imageContentHash?: string }
  | { kind: "openUrl"; url: string; inApp?: boolean }
  | { kind: "none"; message?: string }

export function getOrderedMenuBuiltins(settings: CaisSettings): KeyboardMenuBuiltinAction[] {
  const order = settings.keyboardMenu.builtinOrder?.filter(
    (key) => CONFIGURABLE_MENU_BUILTIN_ACTIONS.includes(key),
  )
  if (!order?.length) return CONFIGURABLE_MENU_BUILTIN_ACTIONS
  const result: KeyboardMenuBuiltinAction[] = order.filter((key) => key !== "tokenize")
  result.unshift("tokenize")
  const insertAfter = (anchor: KeyboardMenuBuiltinAction, action: KeyboardMenuBuiltinAction) => {
    if (result.includes(action)) return
    const index = result.indexOf(anchor)
    if (index >= 0) {
      result.splice(index + 1, 0, action)
    } else {
      result.push(action)
    }
  }
  insertAfter("cleanWhitespace", "removeBlankLines")
  insertAfter("removeBlankLines", "splitLines")
  for (const action of CONFIGURABLE_MENU_BUILTIN_ACTIONS) {
    if (!result.includes(action)) result.push(action)
  }
  return result
}

export function menuBuiltinTitle(action: KeyboardMenuBuiltinAction): string {
  switch (action) {
    case "tokenize": return "分词"
    case "base64Encode": return "Base64 编码"
    case "base64Decode": return "Base64 解码"
    case "cleanWhitespace": return "移除空格"
    case "removeBlankLines": return "移除空行"
    case "splitLines": return "按行拆分"
    case "uppercase": return "转为大写"
    case "lowercase": return "转为小写"
    case "textBold": return "转为粗体"
    case "textItalic": return "转为斜体"
    case "textBoldItalic": return "转为粗斜体"
    case "textMonospaced": return "转为等宽字体"
    case "monospacedDigits": return "数字转等宽字体"
    case "textUnderline": return "添加下划线"
    case "textStrikethrough": return "添加删除线"
    case "extractLinks": return "提取链接"
    case "chineseAmount": return "中文大写金额"
    case "openUrl": return "在 Safari 打开"
    case "openUrlInApp": return "在内置浏览器打开"
    case "pin": return "置顶"
    case "favorite": return "收藏"
  }
}

export function menuBuiltinSystemImage(action: KeyboardMenuBuiltinAction): string {
  switch (action) {
    case "tokenize": return "text.magnifyingglass"
    case "base64Encode": return "curlybraces.square"
    case "base64Decode": return "arrow.down.doc"
    case "cleanWhitespace": return "text.badge.checkmark"
    case "removeBlankLines": return "text.badge.minus"
    case "splitLines": return "list.bullet.rectangle"
    case "uppercase": return "textformat.size.larger"
    case "lowercase": return "textformat.size.smaller"
    case "textBold": return "bold"
    case "textItalic": return "italic"
    case "textBoldItalic": return "b.circle.fill"
    case "textMonospaced": return "character.cursor.ibeam"
    case "monospacedDigits": return "number"
    case "textUnderline": return "underline"
    case "textStrikethrough": return "strikethrough"
    case "extractLinks": return "link.badge.plus"
    case "chineseAmount": return "chineseyuanrenminbisign"
    case "openUrl": return "safari"
    case "openUrlInApp": return "safari.fill"
    case "pin": return "pin"
    case "favorite": return "star"
  }
}

export function customActionSystemImage(action: KeyboardCustomAction): string {
  if (action.mode === "regexExtract") return "text.magnifyingglass"
  if (action.mode === "regexRemove") return "text.badge.minus"
  if (action.mode === "javascript") return "curlybraces"
  if (action.mode === "networkRequest") return "network"
  return "wand.and.stars"
}

function stripDataUri(value: string): string {
  return value.trim().replace(/^data:[^,]+,/, "")
}

function dataToRawText(data: Data | null): string | null {
  if (!data) return null
  return data.toRawString("utf-8")
}

function mapLatinStyle(
  source: string,
  uppercaseStart: number,
  lowercaseStart: number,
  digitStart?: number,
  lowercaseSpecials: Record<string, string> = {},
): string {
  return Array.from(source, (char) => {
    if (char >= "A" && char <= "Z") {
      return String.fromCodePoint(uppercaseStart + char.charCodeAt(0) - 65)
    }
    if (char >= "a" && char <= "z") {
      if (lowercaseSpecials[char]) return lowercaseSpecials[char]
      const index = char.charCodeAt(0) - 97
      return String.fromCodePoint(lowercaseStart + index)
    }
    if (digitStart != null && char >= "0" && char <= "9") {
      return String.fromCodePoint(digitStart + char.charCodeAt(0) - 48)
    }
    return char
  }).join("")
}

export function applyBuiltinMenuAction(options: {
  action: KeyboardMenuBuiltinAction
  source: string
  imagePath?: string
  isImage: boolean
}): MenuActionResult | null {
  const { action, source, imagePath, isImage } = options
  switch (action) {
    case "base64Encode": {
      if (isImage && imagePath) {
        const data = Data.fromFile(imagePath)
        if (!data) throw new Error("图片文件不可读取")
        return { kind: "text", text: data.toBase64String() }
      }
      if (isImage) throw new Error("图片文件不可读取")
      const data = Data.fromRawString(source, "utf-8")
      if (!data) throw new Error("文本无法编码")
      return { kind: "text", text: data.toBase64String() }
    }
    case "base64Decode": {
      if (isImage) return null
      const data = Data.fromBase64String(stripDataUri(source))
      const text = dataToRawText(data)
      if (text) return { kind: "text", text }
      const image = UIImage.fromBase64String(stripDataUri(source))
      if (!image) throw new Error("Base64 内容无法识别为文本或图片")
      return {
        kind: "image",
        image,
        imageContentHash: data ? hashString(data.toBase64String()) : undefined,
      }
    }
    case "cleanWhitespace":
      if (isImage) return null
      return { kind: "text", text: source.replace(/\s+/g, "") }
    case "removeBlankLines":
      if (isImage) return null
      return { kind: "text", text: source.split("\n").filter((line) => line.trim()).join("\n") }
    case "splitLines":
      if (isImage) return null
      return { kind: "texts", texts: source.split("\n").filter((line) => line.trim()) }
    case "uppercase":
      if (isImage) return null
      return { kind: "text", text: source.toUpperCase() }
    case "lowercase":
      if (isImage) return null
      return { kind: "text", text: source.toLowerCase() }
    case "textBold":
      if (isImage) return null
      return { kind: "text", text: mapLatinStyle(source, 0x1D400, 0x1D41A, 0x1D7CE) }
    case "textItalic":
      if (isImage) return null
      return { kind: "text", text: mapLatinStyle(source, 0x1D434, 0x1D44E, undefined, { h: "ℎ" }) }
    case "textBoldItalic":
      if (isImage) return null
      return { kind: "text", text: mapLatinStyle(source, 0x1D468, 0x1D482) }
    case "textMonospaced":
      if (isImage) return null
      return { kind: "text", text: mapLatinStyle(source, 0x1D670, 0x1D68A, 0x1D7F6) }
    case "monospacedDigits":
      if (isImage) return null
      return {
        kind: "text",
        text: Array.from(source, (char) => char >= "0" && char <= "9"
          ? String.fromCodePoint(0x1D7F6 + char.charCodeAt(0) - 48)
          : char).join(""),
      }
    case "textUnderline":
      if (isImage) return null
      return { kind: "text", text: Array.from(source, (char) => /\s/.test(char) ? char : `${char}\u0332`).join("") }
    case "textStrikethrough":
      if (isImage) return null
      return { kind: "text", text: Array.from(source, (char) => /\s/.test(char) ? char : `${char}\u0336`).join("") }
    case "extractLinks": {
      if (isImage) return null
      const matches = source.match(/(?:https?:\/\/|www\.)[^\s<>"'`]+/gi) ?? []
      const links = [...new Set(matches.map((match) => {
        const trimmed = match.replace(/[),.;!?，。；！？、]+$/g, "")
        return trimmed.startsWith("www.") ? `https://${trimmed}` : trimmed
      }).filter(Boolean))]
      return { kind: "texts", texts: links }
    }
    case "chineseAmount":
      if (isImage) return null
      return { kind: "text", text: arabicNumberToChineseAmount(source) }
    case "openUrl":
      if (isImage) return null
      return { kind: "openUrl", url: source }
    case "openUrlInApp":
      if (isImage) return null
      return { kind: "openUrl", url: source, inApp: true }
    case "tokenize":
      return null
    default:
      return null
  }
}

export async function presentInAppBrowser(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅支持打开 HTTP 或 HTTPS 链接")
  }
  const browser = new WebViewController()
  try {
    const loading = browser.loadURL(parsed.href)
    void loading.then((loaded) => {
      if (!loaded) console.error("[CAIS] In-app browser failed to load", parsed.href)
    }).catch((error) => {
      console.error("[CAIS] In-app browser load error", error)
    })
    await browser.present({ fullscreen: false, navigationTitle: parsed.hostname })
  } finally {
    browser.dispose()
  }
}

export async function applyCustomMenuAction(action: KeyboardCustomAction, source: string): Promise<MenuActionResult | null> {
  if (action.mode === "regexExtract" || action.mode === "regexRemove") {
    const pattern = String(action.regex ?? "").trim()
    if (!pattern) throw new Error("正则表达式为空")
    if (action.mode === "regexRemove") {
      return { kind: "text", text: source.replace(makeRegex(pattern, Boolean(action.regexRemoveAll)), "") }
    }
    const match = source.match(makeRegex(pattern))
    if (!match) throw new Error("没有匹配结果")
    return { kind: "text", text: match[1] ?? match[0] }
  }
  if (action.mode === "javascript") {
    const result = runJavaScriptTransform(String(action.script ?? ""), source)
    return { kind: "text", text: result.text }
  }
  if (action.mode === "networkRequest") {
    const result = await runNetworkRequest(String(action.script ?? ""), source)
    if (!result?.text) return { kind: "none", message: "没有返回内容" }
    return { kind: "text", text: result.text, writeToClipboard: action.writeToClipboard }
  }
  return { kind: "text", text: renderRuntimeTemplate(action.template, source) }
}
