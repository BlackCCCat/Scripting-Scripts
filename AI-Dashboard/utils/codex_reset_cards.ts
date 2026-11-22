import type { QuotaSnapshot } from "../models/types"

export type CodexResetCards = NonNullable<QuotaSnapshot["codexResetCards"]>
type ResetCredit = NonNullable<CodexResetCards["availableCredits"]>[number]
const hour = 60 * 60 * 1000

export function getCodexResetCredits(cards: CodexResetCards): ResetCredit[] {
  return cards.availableCredits ?? cards.availableExpirations?.map((expiresAt) => ({ expiresAt })) ?? []
}

export function formatNearestCodexResetExpiry(cards: CodexResetCards | undefined, now = Date.now()) {
  if (!cards?.availableCount) return undefined
  let nearest = Infinity
  for (const { expiresAt } of getCodexResetCredits(cards)) {
    if (!expiresAt) continue
    const remaining = Date.parse(expiresAt) - now
    if (remaining > 0 && remaining < nearest) nearest = remaining
  }
  if (!Number.isFinite(nearest)) return undefined
  const hours = Math.floor(nearest / hour)
  if (hours === 0) return "<1h"
  const days = Math.floor(hours / 24)
  const remainder = hours % 24
  if (days === 0) return `${remainder}h`
  return remainder ? `${days}d ${remainder}h` : `${days}d`
}
