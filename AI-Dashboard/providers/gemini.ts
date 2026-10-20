import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import { tryExtractIdentityFromJWT } from "../utils/theme"
import {
  QuotaQueryError,
  fetchJsonStrict,
  normalizeEpochDate,
  toFiniteNumber,
} from "./_shared/http"

export const queryGeminiQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const json = await fetchJsonStrict(
    "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${envelope.accessToken.trim()}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    }
  )
  const buckets = Array.isArray(json.buckets) ? json.buckets : []
  const windows: QuotaWindow[] = []
  for (const b of buckets) {
    if (!b || typeof b !== "object") continue
    const rec = b as Record<string, unknown>
    const modelId = String(rec.modelId ?? "Gemini")
    const remFrac = toFiniteNumber(rec.remainingFraction)
    if (remFrac !== undefined) {
      windows.push({
        id: `gemini.${modelId}`,
        name: modelId,
        usedPercentage: Math.max((1 - remFrac) * 100, 0),
        resetsAt: normalizeEpochDate(rec.resetTime),
      })
    }
  }
  if (windows.length === 0) {
    throw new QuotaQueryError("noQuotaWindows")
  }
  const accountIdentity =
    envelope.metadata.accountEmail ||
    envelope.metadata.email ||
    tryExtractIdentityFromJWT(envelope.accessToken.trim()) ||
    undefined

  return {
    accountID,
    collectedAt,
    providerPlanName: "Pro",
    accountIdentity,
    windows,
  }
}
