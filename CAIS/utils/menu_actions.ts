import type {
  CaisSettings,
  KeyboardCustomAction,
  KeyboardMenuBuiltinAction,
} from "../types"
import { arabicNumberToChineseAmount, makeRegex, runJavaScriptTransform } from "./custom_action"
import { renderRuntimeTemplate } from "./template"

export const CONFIGURABLE_MENU_BUILTIN_ACTIONS: KeyboardMenuBuiltinAction[] = [
  "base64Encode",
  "base64Decode",
  "cleanWhitespace",
  "removeBlankLines",
  "splitLines",
  "uppercase",
  "lowercase",
  "chineseAmount",
  "openUrl",
]

export type MenuActionResult =
  | { kind: "text"; text: string }
  | { kind: "texts"; texts: string[] }
  | { kind: "image"; image: UIImage }
  | { kind: "openUrl"; url: string }

export function getOrderedMenuBuiltins(settings: CaisSettings): KeyboardMenuBuiltinAction[] {
  const order = settings.keyboardMenu.builtinOrder?.filter(
    (key) => CONFIGURABLE_MENU_BUILTIN_ACTIONS.includes(key),
  )
  if (!order?.length) return CONFIGURABLE_MENU_BUILTIN_ACTIONS
  const result = [...order]
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
    case "base64Encode": return "Base64 编码"
    case "base64Decode": return "Base64 解码"
    case "cleanWhitespace": return "移除空格"
    case "removeBlankLines": return "移除空行"
    case "splitLines": return "按行拆分"
    case "uppercase": return "转为大写"
    case "lowercase": return "转为小写"
    case "chineseAmount": return "中文大写金额"
    case "openUrl": return "打开链接"
    case "pin": return "置顶"
    case "favorite": return "收藏"
  }
}

export function menuBuiltinSystemImage(action: KeyboardMenuBuiltinAction): string {
  switch (action) {
    case "base64Encode": return "curlybraces.square"
    case "base64Decode": return "arrow.down.doc"
    case "cleanWhitespace": return "text.badge.checkmark"
    case "removeBlankLines": return "text.badge.minus"
    case "splitLines": return "list.bullet.rectangle"
    case "uppercase": return "textformat.size.larger"
    case "lowercase": return "textformat.size.smaller"
    case "chineseAmount": return "chineseyuanrenminbisign"
    case "openUrl": return "safari"
    case "pin": return "pin"
    case "favorite": return "star"
  }
}

export function customActionSystemImage(action: KeyboardCustomAction): string {
  if (action.mode === "regexExtract") return "text.magnifyingglass"
  if (action.mode === "regexRemove") return "text.badge.minus"
  if (action.mode === "javascript") return "curlybraces"
  return "wand.and.stars"
}

function stripDataUri(value: string): string {
  return value.trim().replace(/^data:[^,]+,/, "")
}

function dataToRawText(data: Data | null): string | null {
  if (!data) return null
  return data.toRawString("utf-8")
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
      return { kind: "image", image }
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
    case "chineseAmount":
      if (isImage) return null
      return { kind: "text", text: arabicNumberToChineseAmount(source) }
    case "openUrl":
      if (isImage) return null
      return { kind: "openUrl", url: source }
    default:
      return null
  }
}

export function applyCustomMenuAction(action: KeyboardCustomAction, source: string): MenuActionResult | null {
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
  return { kind: "text", text: renderRuntimeTemplate(action.template, source) }
}
