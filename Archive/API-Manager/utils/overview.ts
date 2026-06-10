import type { Color } from "scripting"
import type { ApiEntry, CheckStatus } from "../types"

export type OverviewSummary = {
  green: number
  yellow: number
  red: number
  checking: number
  unknown: number
}

export type OverviewItem = {
  key: "green" | "yellow" | "red" | "checking" | "unknown"
  label: string
  count: number
  color: Color
}

export function statusCountKey(
  status: CheckStatus
): "green" | "yellow" | "red" | "checking" | "unknown" {
  if (status === "green") return "green"
  if (status === "yellow") return "yellow"
  if (status === "red") return "red"
  if (status === "checking") return "checking"
  return "unknown"
}

export function buildOverviewSummary(entries: ApiEntry[]): OverviewSummary {
  const result: OverviewSummary = {
    green: 0,
    yellow: 0,
    red: 0,
    checking: 0,
    unknown: 0,
  }
  for (const entry of entries) {
    result[statusCountKey(entry.check.status)] += 1
  }
  return result
}

export function buildOverviewItems(summary: OverviewSummary): OverviewItem[] {
  return [
    { key: "green", label: "可用", count: summary.green, color: "systemGreen" },
    { key: "yellow", label: "API失效", count: summary.yellow, color: "systemYellow" },
    { key: "red", label: "失效", count: summary.red, color: "systemRed" },
    { key: "checking", label: "检测中", count: summary.checking, color: "systemBlue" },
    { key: "unknown", label: "未检测", count: summary.unknown, color: "systemGray3" },
  ]
}

export function chartColorScale(): Record<string, Color> {
  return {
    可用: "systemGreen",
    API失效: "systemYellow",
    失效: "systemRed",
    检测中: "systemBlue",
    未检测: "systemGray3",
  }
}
