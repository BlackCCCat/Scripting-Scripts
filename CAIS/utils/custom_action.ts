const TEMPLATE_KEYS = ["text", "date", "time", "datetime", "timestamp"]
const MAX_TRANSFORM_TEXT_LENGTH = 10000
const CN_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"]
const CN_UNITS = ["", "拾", "佰", "仟"]
const CN_SECTION_UNITS = ["", "万", "亿", "兆"]

export type JavaScriptTransformResult = {
  text: string
}

export const JAVASCRIPT_ACTION_EXAMPLE = `function transform(text) {
  return {
    text: text.trim()
  }
}`

function parseRegexPattern(pattern: string): { source: string; flags: string } {
  const trimmed = pattern.trim()
  const wrapped = trimmed.match(/^\/(.+)\/([dgimsuvy]*)$/)
  if (wrapped) return { source: wrapped[1], flags: wrapped[2] }
  return { source: trimmed, flags: "" }
}

export function makeRegex(pattern: string, forceGlobal = false): RegExp {
  const error = validateRegexPattern(pattern, forceGlobal)
  if (error) throw new Error(error)
  const parsed = parseRegexPattern(pattern)
  const flags = forceGlobal && !parsed.flags.includes("g") ? `${parsed.flags}g` : parsed.flags
  return new RegExp(parsed.source, flags || undefined)
}

export function validateRegexPattern(pattern: string, forceGlobal = false): string | null {
  try {
    const parsed = parseRegexPattern(pattern)
    const runtimeFlags = forceGlobal && !parsed.flags.includes("g") ? `${parsed.flags}g` : parsed.flags
    new RegExp(parsed.source, runtimeFlags || undefined)
    const strictFlags = parsed.flags.includes("u") || parsed.flags.includes("v")
      ? runtimeFlags
      : `${runtimeFlags}u`
    new RegExp(parsed.source, strictFlags)
    return null
  } catch (error: any) {
    const message = String(error?.message ?? error ?? "正则表达式无效")
    if (message.includes("Incomplete quantifier") || message.includes("Lone quantifier")) {
      return "正则表达式量词不完整；如果要匹配 {，请写作 \\{"
    }
    return message
  }
}

export function validateRuntimeTemplate(template: string): string | null {
  const stripped = template.replace(/\{\{([^{}]+)\}\}/g, (_match, key) => {
    const fixedKey = String(key)
    return TEMPLATE_KEYS.includes(fixedKey) ? "" : `{{${fixedKey}}}`
  })
  const invalid = stripped.match(/\{\{([^{}]+)\}\}/)
  if (invalid) return `不支持的模板变量：${invalid[1]}`
  if (stripped.includes("{{") || stripped.includes("}}")) {
    return "模板变量格式不完整，请使用 {{text}} 这样的格式"
  }
  return null
}

export function runJavaScriptTransform(code: string, text: string): JavaScriptTransformResult {
  const body = code.trim()
  if (!body) throw new Error("请输入 JavaScript 函数")
  const factory = new Function(`"use strict";\n${body}\nreturn typeof transform === "function" ? transform : null`)
  const transform = factory() as ((text: string) => unknown) | null
  if (!transform) throw new Error("请定义名为 transform 的函数")
  if (transform.length > 1) throw new Error("transform 只能声明一个参数 text")
  const raw = transform(text)
  if (raw && typeof (raw as any).then === "function") {
    throw new Error("暂不支持 async/Promise，请返回普通对象")
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("transform 必须返回对象，例如 return { text }")
  }
  const result = raw as JavaScriptTransformResult
  if (!("text" in result)) {
    throw new Error("返回对象需要包含 text")
  }
  const output: JavaScriptTransformResult = { text: String(result.text ?? "") }
  if (output.text != null && output.text.length > MAX_TRANSFORM_TEXT_LENGTH) {
    throw new Error(`返回文本不能超过 ${MAX_TRANSFORM_TEXT_LENGTH} 字`)
  }
  return output
}

function sectionToChinese(section: string): string {
  let result = ""
  let zeroPending = false
  const chars = section.padStart(4, "0").split("")
  for (let index = 0; index < chars.length; index += 1) {
    const digit = Number(chars[index])
    const unitIndex = chars.length - index - 1
    if (!digit) {
      zeroPending = result.length > 0
      continue
    }
    if (zeroPending) {
      result += CN_DIGITS[0]
      zeroPending = false
    }
    result += CN_DIGITS[digit] + CN_UNITS[unitIndex]
  }
  return result
}

function integerToChinese(integerPart: string): string {
  const fixed = integerPart.replace(/^0+/, "") || "0"
  if (fixed === "0") return CN_DIGITS[0]
  const sections: string[] = []
  for (let end = fixed.length; end > 0; end -= 4) {
    sections.unshift(fixed.slice(Math.max(0, end - 4), end))
  }
  if (sections.length > CN_SECTION_UNITS.length) throw new Error("数字过大")
  let result = ""
  let zeroPending = false
  sections.forEach((section, index) => {
    const sectionValue = Number(section)
    const unit = CN_SECTION_UNITS[sections.length - index - 1] ?? ""
    if (!sectionValue) {
      zeroPending = result.length > 0
      return
    }
    if (zeroPending) {
      result += CN_DIGITS[0]
      zeroPending = false
    }
    if (result && sectionValue < 1000 && !result.endsWith(CN_DIGITS[0])) {
      result += CN_DIGITS[0]
    }
    result += sectionToChinese(section) + unit
  })
  return result.replace(/零+/g, "零").replace(/零$/g, "")
}

export function arabicNumberToChineseAmount(value: string): string {
  const normalized = value.trim().replace(/[,\s￥¥]/g, "").replace(/^RMB/i, "")
  const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d{0,}))?$/)
  if (!match) throw new Error("请输入有效数字")
  const sign = match[1] === "-" ? "负" : ""
  const integerPart = match[2]
  const fraction = String(match[3] ?? "").padEnd(2, "0").slice(0, 2)
  const jiao = Number(fraction[0] ?? "0")
  const fen = Number(fraction[1] ?? "0")
  let result = `${sign}${integerToChinese(integerPart)}元`
  if (!jiao && !fen) return `${result}整`
  if (jiao) result += `${CN_DIGITS[jiao]}角`
  else if (/[1-9]/.test(integerPart) && fen) result += "零"
  if (fen) result += `${CN_DIGITS[fen]}分`
  return result
}
