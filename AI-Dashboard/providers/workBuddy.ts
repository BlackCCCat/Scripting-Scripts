import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import { QuotaQueryError, fetchJsonStrict, toFiniteNumber } from "./_shared/http"

function formatDateTimeRange(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 按 Cycle* 优先口径拆出单个套餐包的 remain / used / size
 * 与 workbuddy2api-gui/internal/upstream/client.go 保持完全一致
 */
function packageRemainUsed(pkg: Record<string, unknown>): {
  remain: number
  used: number
  size: number
} {
  const cycleSize = toFiniteNumber(pkg.CycleCapacitySize) ?? 0
  const cycleRemain = toFiniteNumber(pkg.CycleCapacityRemain) ?? 0
  const cycleUsed = toFiniteNumber(pkg.CycleCapacityUsed) ?? 0

  if (cycleSize > 0) {
    let remain = cycleRemain
    const size = cycleSize
    if (remain < 0) remain = 0
    if (remain > size) remain = size
    let used = size - remain
    if (cycleUsed > used) {
      used = cycleUsed
      if (size >= used) {
        remain = size - used
      }
    }
    return { remain, used, size }
  }

  const remain = toFiniteNumber(pkg.CapacityRemain) ?? 0
  let used = toFiniteNumber(pkg.CapacityUsed) ?? 0
  const size = toFiniteNumber(pkg.CapacitySize) ?? 0
  if (used === 0 && size > remain) {
    used = size - remain
  }
  return { remain, used, size }
}

/**
 * 将上游返回的资源包名称（如 "CodeBuddy 个人免费版"、"免费体验包"、"CodeBuddy Pro" 等）
 * 归一化为简短清晰的账号等级标识（Free / Pro / Team / Enterprise）
 */
function inferWorkBuddyPlanLabel(packageNames: string[]): string {
  const joined = packageNames.join(" ")
  if (/企业|enterprise/i.test(joined)) return "Enterprise"
  if (/团队|team/i.test(joined)) return "Team"
  if (/专业|旗舰|尊享|\bpro\b|\bplus\b|\bmax\b|\bultra\b/i.test(joined)) {
    return "Pro"
  }
  return "Free"
}

export const queryWorkBuddyQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const region = envelope.metadata.region === "global" ? "global" : "cn"
  const billingBase =
    region === "global"
      ? "https://www.workbuddy.ai"
      : "https://www.codebuddy.cn"
  const originUrl = billingBase

  const headers: Record<string, string> = {
    Authorization: `Bearer ${envelope.accessToken.trim()}`,
    "User-Agent": "CLI/2.63.2 CodeBuddy/2.63.2",
    "X-Requested-With": "XMLHttpRequest",
    Origin: originUrl,
    Referer: `${originUrl}/`,
  }

  const uid = envelope.metadata.uid || envelope.accountID || ""
  const enterpriseId = envelope.metadata.enterpriseId || ""
  const domain = envelope.metadata.domain || ""
  if (uid) headers["X-User-Id"] = uid
  if (enterpriseId) {
    headers["X-Enterprise-Id"] = enterpriseId
    headers["X-Tenant-Id"] = enterpriseId
  }
  if (domain) headers["X-Domain"] = domain

  const now = new Date()
  const tenYearsLater = new Date(
    now.getFullYear() + 10,
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds()
  )

  const payload = {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: "p_tcaca",
    Status: [0, 3],
    PackageEndTimeRangeBegin: formatDateTimeRange(now),
    PackageEndTimeRangeEnd: formatDateTimeRange(tenYearsLater),
  }

  const json = await fetchJsonStrict(
    `${billingBase}/v2/billing/meter/get-user-resource`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }
  )

  if (typeof json.code === "number" && json.code !== 0) {
    const msg = String(json.message ?? json.msg ?? `业务状态码 ${json.code}`)
    if (json.code === 401 || json.code === 403) {
      throw new QuotaQueryError("invalidCredential", msg)
    }
    throw new QuotaQueryError("server", msg)
  }

  const dataRoot =
    json.data && typeof json.data === "object"
      ? (json.data as Record<string, unknown>)
      : json
  const respObj =
    dataRoot.Response && typeof dataRoot.Response === "object"
      ? (dataRoot.Response as Record<string, unknown>)
      : dataRoot
  const innerData =
    respObj.Data && typeof respObj.Data === "object"
      ? (respObj.Data as Record<string, unknown>)
      : respObj

  const accountsList = Array.isArray(innerData.Accounts)
    ? (innerData.Accounts as Record<string, unknown>[])
    : []

  const windows: QuotaWindow[] = []
  let totalRemain = 0
  let totalUsed = 0
  let totalSize = 0
  const packageNames: string[] = []

  for (let i = 0; i < accountsList.length; i++) {
    const pkg = accountsList[i]
    const pkgName = String(pkg.PackageName ?? "").trim()
    const { remain, used, size } = packageRemainUsed(pkg)

    totalRemain += remain
    totalUsed += used
    totalSize += size
    if (pkgName && !packageNames.includes(pkgName)) {
      packageNames.push(pkgName)
    }
  }

  if (totalSize > 0) {
    const derived = totalSize - totalRemain
    if (derived > totalUsed) {
      totalUsed = derived
    }
  }
  if (totalRemain < 0) {
    totalRemain = 0
  }
  if (totalSize > 0 && totalRemain > totalSize) {
    totalRemain = totalSize
  }

  const totalDosage = toFiniteNumber(innerData.TotalDosage)

  if (totalSize > 0) {
    const usedPct = Math.min(100, Math.max(0, (totalUsed / totalSize) * 100))
    windows.push({
      id: "workbuddy.credits.total",
      name: "WorkBuddy 资源包总额度",
      period: "monthly",
      unit: "积分",
      usedPercentage: Math.round(usedPct * 10) / 10,
      remainingCount: Math.round(totalRemain * 100) / 100,
      totalCount: Math.round(totalSize * 100) / 100,
      isExhausted: totalRemain <= 0,
      exactCounts: {
        used: Math.round(totalUsed * 100) / 100,
        remaining: Math.round(totalRemain * 100) / 100,
        total: Math.round(totalSize * 100) / 100,
      },
    })
  } else if (totalDosage !== undefined) {
    windows.push({
      id: "workbuddy.dosage",
      name: "累计消耗用量",
      unit: "积分",
      exactCounts: {
        used: Math.round(totalDosage * 100) / 100,
      },
    })
  }

  if (windows.length === 0) {
    throw new QuotaQueryError("noQuotaWindows")
  }

  const planLabel = inferWorkBuddyPlanLabel(packageNames)

  return {
    accountID,
    collectedAt,
    providerPlanName: planLabel,
    accountIdentity:
      envelope.metadata.nickname || envelope.metadata.uid || undefined,
    windows,
  }
}
