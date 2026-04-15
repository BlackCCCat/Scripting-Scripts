import type { MatchMode } from "./regex"

export type RegexTemplate = {
  title: string
  pattern: string
  mode: MatchMode
  sampleText?: string
  replacementTemplate?: string
}

export const REGEX_TEMPLATES: RegexTemplate[] = [
  {
    title: "手机号（11位）",
    pattern: String.raw`[0-9]{11}`,
    mode: "full",
    sampleText: "13800138000",
  },
  {
    title: "URL 链接",
    pattern: String.raw`https?://[^\s]+|www\.[^\s]+`,
    mode: "search",
    sampleText: "访问 https://www.example.com 获取详情",
  },
  {
    title: "邮箱地址",
    pattern: String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`,
    mode: "search",
    sampleText: "联系邮箱：demo@example.com",
  },
  {
    title: "纯数字",
    pattern: String.raw`\d+`,
    mode: "full",
    sampleText: "123456",
  },
  {
    title: "中国身份证",
    pattern: String.raw`[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]`,
    mode: "full",
    sampleText: "11010119900307123X",
  },
]
