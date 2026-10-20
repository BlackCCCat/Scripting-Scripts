import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import { QuotaQueryError, fetchJsonStrict, toFiniteNumber } from "./_shared/http"

/**
 * TRAE SOLO 额度查询
 * 数据源：POST {ug}/trae/api/v2/pay/ide_user_ent_usage
 * 聚合 user_entitlement_pack_list[].entitlement_base_info.quota.credits_limit 与 usage.credits_amount
 * 额度单位统一为 "积分"
 */
export const queryTraeQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const region = envelope.metadata.region === "global" ? "global" : "cn"
  const ugHost =
    region === "global" ? "https://api.trae.ai" : "https://api.trae.cn"
  const deviceId = envelope.metadata.deviceId || ""

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Cloud-IDE-JWT ${envelope.accessToken.trim()}`,
    "X-User-Region": region === "global" ? "GLOBAL" : "CN",
  }
  if (deviceId) {
    headers["X-Device-Id"] = deviceId
  }

  const json = await fetchJsonStrict(
    `${ugHost}/trae/api/v2/pay/ide_user_ent_usage`,
    {
      method: "POST",
      headers,
      body: "{}",
    }
  )

  const packs = (json.user_entitlement_pack_list || []) as Array<{
    entitlement_base_info?: {
      package_name?: string
      quota?: {
        credits_limit?: number
      }
    }
    usage?: {
      credits_amount?: number
    }
  }>

  let totalLimit = 0
  let totalRemain = 0
  const windows: QuotaWindow[] = []

  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i]
    const baseInfo = pack.entitlement_base_info || {}
    const quota = baseInfo.quota || {}
    const limit = toFiniteNumber(quota.credits_limit) ?? 0
    if (limit <= 0) continue

    const usage = pack.usage || {}
    const used = Math.round(toFiniteNumber(usage.credits_amount) ?? 0)
    let remain = limit - used
    if (remain < 0) remain = 0
    if (remain > limit) remain = limit

    totalLimit += limit
    totalRemain += remain

    const packName =
      baseInfo.package_name ||
      (packs.length > 1 ? `套餐包 ${i + 1}` : "AI 积分额度")
    windows.push({
      id: `trae.pack.${i}`,
      name: packName,
      period: "monthly",
      usedPercentage:
        limit > 0
          ? Math.max(0, Math.min(100, Math.round(((limit - remain) / limit) * 100)))
          : 0,
      remainingCount: remain,
      totalCount: limit,
      unit: "积分",
    })
  }

  if (windows.length === 0) {
    throw new QuotaQueryError("noQuotaWindows", "未获取到有效的 Trae 积分包")
  }

  // 判定账号等级 (Free / Pro)
  let planName = "Free"
  if (
    totalLimit >= 1000 ||
    packs.some((p) =>
      /pro|solo|plus/i.test(p.entitlement_base_info?.package_name || "")
    )
  ) {
    planName = "Pro"
  }

  return {
    accountID,
    collectedAt,
    providerPlanName: planName,
    accountIdentity:
      envelope.metadata.nickname ||
      envelope.metadata.uid ||
      envelope.accountID,
    region,
    windows,
  }
}
