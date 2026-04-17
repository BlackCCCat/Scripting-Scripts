import type { SleepStageKey } from "./types"

export const palette = {
  accent: "#33C7B2",
  accentSoft: "rgba(51, 199, 178, 0.18)",
  accentDeep: "#1D9F8D",
  ink: "label",
  mutedInk: "secondaryLabel",
  page: "systemGroupedBackground",
  card: "secondarySystemGroupedBackground",
  cardSoft: "tertiarySystemGroupedBackground",
  line: "separator",
  warm: "rgba(255, 145, 92, 0.16)",
  good: "#31B56A",
  okay: "#F3B548",
  poor: "#FF7B7B",
  sleepCore: "#4D7BF3",
  sleepDeep: "#5C59D0",
  sleepREM: "#44B5E6",
  awake: "#FF915C",
  inBed: "systemGray3",
  unspecified: "#9F79FF",
} as const

export function stageLabel(stage: SleepStageKey): string {
  switch (stage) {
    case "inBed":
      return "卧床"
    case "awake":
      return "清醒"
    case "asleepCore":
      return "核心"
    case "asleepDeep":
      return "深睡"
    case "asleepREM":
      return "REM"
    case "asleepUnspecified":
      return "未分期"
  }
}

export function stageColor(stage: SleepStageKey): string {
  switch (stage) {
    case "asleepDeep":
      return palette.sleepDeep
    case "asleepCore":
      return palette.sleepCore
    case "asleepREM":
      return palette.sleepREM
    case "awake":
      return palette.awake
    case "inBed":
      return palette.inBed
    case "asleepUnspecified":
      return palette.unspecified
  }
}

export function scoreEmoji(score: number | null): string {
  if (score == null) return "😴"
  if (score >= 90) return "😄"
  if (score >= 80) return "🙂"
  if (score >= 70) return "😐"
  if (score >= 60) return "😕"
  return "😣"
}

export function scoreTone(score: number | null): string {
  if (score == null) return "secondaryLabel"
  if (score >= 85) return palette.accentDeep
  if (score >= 70) return palette.sleepCore
  if (score >= 60) return palette.okay
  return palette.poor
}

export function scoreLabel(score: number | null): string {
  if (score == null) return "等待睡眠记录"
  if (score >= 90) return "非常好"
  if (score >= 80) return "还不错"
  if (score >= 70) return "一般"
  if (score >= 60) return "偏弱"
  return "需要调整"
}
