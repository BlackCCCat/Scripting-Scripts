import { fetch } from "scripting"
import { ProviderQuotaHandler, QuotaWindow } from "../models/types"
import {
  QuotaQueryError,
  normalizeEpochDate,
  toFiniteNumber,
} from "./_shared/http"

function spanOf(unit: number, n?: unknown): number {
  let count = Math.trunc(Number(n) || 0)
  if (unit === 3 && count <= 0) count = 5
  count = Math.max(count, 1)
  const multipliers: Record<number, number> = {
    1: 60,
    3: 3600,
    4: 86400,
    5: 30 * 86400,
    6: 7 * 86400,
  }
  return (multipliers[unit] ?? 0) * count
}

/**
 * 查询智谱 BigModel 官方付费 Coding Plan 配额窗口与订阅方案
 */
async function queryBigModelCodingPlan(
  apiKey: string
): Promise<{ windows: QuotaWindow[]; planName?: string }> {
  const cleanKey = apiKey.trim()
  if (!cleanKey) return { windows: [] }

  try {
    const resp = await fetch(
      "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cleanKey}`,
          Accept: "application/json",
          "User-Agent": "ZCode/3.16.3",
        },
        timeout: 15,
        handleRedirect: async () => null,
      }
    )

    if (resp.status === 500) {
      // 当账号不存在付费 coding plan 时服务端返回 HTTP 500，平滑跳过
      return { windows: [] }
    }
    if (!resp.ok) {
      return { windows: [] }
    }

    const json = (await resp.json()) as Record<string, unknown>
    const code = Number(json.code ?? 0)
    if (code !== 0 && code !== 200) {
      return { windows: [] }
    }

    const dataObj = (json.data && typeof json.data === "object"
      ? json.data
      : json) as Record<string, unknown>
    const limits = Array.isArray(dataObj.limits) ? dataObj.limits : []
    const windows: QuotaWindow[] = []

    for (const item of limits) {
      if (!item || typeof item !== "object") continue
      const rec = item as Record<string, unknown>
      const type = String(rec.type ?? "QUOTA")
      const pct = toFiniteNumber(rec.percentage)
      const current = toFiniteNumber(rec.currentValue)
      const total = toFiniteNumber(rec.usage)
      const remaining = toFiniteNumber(rec.remaining)
      const resetsAt = normalizeEpochDate(rec.nextResetTime)

      const spanUnit = Number(rec.unit) || 0
      const spanNum = Number(rec.number) || 0
      const spanSeconds = spanOf(spanUnit, spanNum)

      let windowLabel = "GLM Coding · 速率窗口"
      if (type === "TIME_LIMIT") {
        windowLabel = "MCP · 月度调用"
      } else if (spanUnit === 3 && (spanNum === 5 || spanNum <= 0)) {
        windowLabel = "GLM Coding · 5小时速率"
      } else if (spanUnit === 6) {
        windowLabel = "GLM Coding · 周配额"
      } else if (spanSeconds > 0) {
        windowLabel = `GLM Coding · ${Math.round(spanSeconds / 3600)}小时窗口`
      }

      let usedCount = current
      if (usedCount === undefined && total !== undefined && remaining !== undefined) {
        usedCount = Math.max(0, total - remaining)
      }
      const calcPct =
        pct ??
        (usedCount !== undefined && total !== undefined && total > 0
          ? (usedCount / total) * 100
          : undefined)
      const isExhausted =
        remaining !== undefined
          ? remaining <= 0
          : calcPct !== undefined && calcPct >= 100

      windows.push({
        id: `zhipu.coding.${type}.${spanUnit}_${spanNum}`,
        name: windowLabel,
        usedPercentage:
          calcPct !== undefined
            ? Math.min(100, Math.max(0, calcPct))
            : undefined,
        remainingCount: remaining,
        totalCount: total,
        resetsAt,
        isExhausted,
      })
    }

    // 尝试拉取生效中的套餐名称
    let planName: string | undefined
    if (typeof dataObj.level === "string" && dataObj.level.trim()) {
      planName = `GLM Coding ${dataObj.level.trim().toUpperCase()}`
    }

    try {
      const subResp = await fetch(
        "https://open.bigmodel.cn/api/biz/subscription/list",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${cleanKey}`,
            Accept: "application/json",
            "User-Agent": "ZCode/3.16.3",
          },
          timeout: 10,
          handleRedirect: async () => null,
        }
      )
      if (subResp.ok) {
        const subJson = (await subResp.json()) as Record<string, unknown>
        const subs = Array.isArray(subJson.data)
          ? subJson.data
          : Array.isArray(subJson)
            ? subJson
            : []
        for (const s of subs) {
          if (!s || typeof s !== "object") continue
          const subRec = s as Record<string, unknown>
          if (
            String(subRec.status ?? "").toUpperCase() === "VALID" &&
            subRec.productName
          ) {
            planName = String(subRec.productName)
            break
          }
        }
      }
    } catch {
      // 忽略套餐列表附属查询错误
    }

    return { windows, planName }
  } catch {
    return { windows: [] }
  }
}

/**
 * 查询 ZCode 免费 Start Plan 及活动赠送 Token 桶配额 (zcode.z.ai)
 */
async function queryZcodeBalances(
  jwt: string,
  deviceMid: string
): Promise<{ windows: QuotaWindow[]; planName?: string }> {
  const cleanJwt = jwt.trim()
  if (!cleanJwt) return { windows: [] }

  try {
    const resp = await fetch(
      "https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=3.16.3",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cleanJwt}`,
          "X-Device-Mid": deviceMid || "00000000-0000-0000-0000-000000000000",
          "User-Agent": "ZCode/3.16.3",
          Accept: "application/json",
        },
        timeout: 15,
        handleRedirect: async () => null,
      }
    )

    if (!resp.ok) {
      return { windows: [] }
    }

    const json = (await resp.json()) as Record<string, unknown>
    const code = Number(json.code ?? 0)
    if (code !== 0 && code !== 200) {
      return { windows: [] }
    }

    const dataObj = (json.data && typeof json.data === "object"
      ? json.data
      : json) as Record<string, unknown>
    const serverTime =
      toFiniteNumber(dataObj.server_time) ?? Math.floor(Date.now() / 1000)

    const rawPlans = Array.isArray(dataObj.plans) ? dataObj.plans : []
    const rawBalances = Array.isArray(dataObj.balances) ? dataObj.balances : []

    // 筛选有效未过期计划
    const activePlans = rawPlans.filter((p) => {
      if (!p || typeof p !== "object") return false
      const rec = p as Record<string, unknown>
      const status = String(rec.status ?? "").trim().toLowerCase()
      const endsAt = toFiniteNumber(rec.ends_at)
      if (status !== "active") return false
      if (endsAt !== undefined && endsAt > 0 && endsAt <= serverTime) return false
      return true
    })

    const windows: QuotaWindow[] = []
    let primaryPlanName: string | undefined

    for (const planItem of activePlans) {
      const p = planItem as Record<string, unknown>
      const pId = String(p.plan_id ?? "")
      const uPlanId = String(p.user_plan_id ?? "")
      const pName = String(p.name ?? "").trim()
      const cleanPlanName = pName.replace(/^ZCode\s+/i, "").trim() || "Start Plan"

      if (!primaryPlanName) {
        primaryPlanName = pName || "ZCode Start Plan"
      }

      // 寻找属于该计划的配额桶
      const matchingBalances = rawBalances.filter((b) => {
        if (!b || typeof b !== "object") return false
        const rec = b as Record<string, unknown>
        if (rec.user_plan_id && uPlanId) {
          return rec.user_plan_id === uPlanId
        }
        return String(rec.plan_id ?? "") === pId
      })

      for (let idx = 0; idx < matchingBalances.length; idx++) {
        const b = matchingBalances[idx] as Record<string, unknown>
        const exp = toFiniteNumber(b.expires_at)
        if (exp !== undefined && exp > 0 && exp <= serverTime) {
          continue // 该桶自身已到期
        }

        const total = toFiniteNumber(b.total_units)
        const remaining = toFiniteNumber(b.remaining_units)
        let used = toFiniteNumber(b.used_units)
        if (used === undefined && total !== undefined && remaining !== undefined) {
          used = Math.max(0, total - remaining)
        }
        if (remaining === undefined && total !== undefined && used !== undefined) {
          // 可根据总量与已用推导
        }
        if (total === undefined && used === undefined && remaining === undefined) {
          continue
        }

        let usedPct: number | undefined
        if (total !== undefined && total > 0) {
          const effUsed =
            used !== undefined
              ? used
              : remaining !== undefined
                ? Math.max(0, total - remaining)
                : 0
          usedPct = Math.min(100, Math.max(0, (effUsed / total) * 100))
        }

        const isSpent =
          (remaining !== undefined && remaining <= 0) ||
          (total !== undefined && used !== undefined && used >= total)
        if (isSpent) {
          usedPct = 100
        }

        const showName = String(b.show_name ?? "").trim()
        const modelLabel = showName || "Tokens"
        const windowName = `${modelLabel} · ${cleanPlanName}`
        const resetsAt = exp && exp > 0 ? new Date(exp * 1000).toISOString() : undefined

        windows.push({
          id: `zhipu.zcode.${pId || uPlanId || "plan"}.${String(b.entitlement_id ?? idx)}`,
          name: windowName,
          usedPercentage: usedPct,
          remainingCount: remaining,
          totalCount: total,
          resetsAt,
          isExhausted: isSpent,
        })
      }
    }

    return { windows, planName: primaryPlanName }
  } catch {
    return { windows: [] }
  }
}

/**
 * 智谱国内版统一配额处理器
 * 同时支持：
 * 1. BigModel 付费 Coding Plan (通过 API Key id.secret 访问)
 * 2. ZCode 免费 Start Plan 与活动礼包 Token 桶 (通过 ZCode JWT 访问)
 */
export const queryZhipuQuota: ProviderQuotaHandler = async (
  accountID,
  envelope,
  collectedAt
) => {
  const zcodeJwt =
    envelope.metadata.zcodeJwt ||
    (envelope.accessToken.split(".").length === 3
      ? envelope.accessToken
      : "")
  const apiKey =
    envelope.metadata.apiKey ||
    (envelope.accessToken.includes(".") &&
    envelope.accessToken.split(".").length === 2
      ? envelope.accessToken
      : "")
  const deviceMid = envelope.metadata.deviceMid || ""

  let codingResult: { windows: QuotaWindow[]; planName?: string } = {
    windows: [],
  }
  let zcodeResult: { windows: QuotaWindow[]; planName?: string } = {
    windows: [],
  }

  // 1. 若具备 BigModel API Key，查询付费 Coding Plan 配额
  if (apiKey) {
    codingResult = await queryBigModelCodingPlan(apiKey)
  }

  // 2. 若具备 ZCode JWT 会话令牌，查询免费 Start Plan 及活动配额
  if (zcodeJwt) {
    zcodeResult = await queryZcodeBalances(zcodeJwt, deviceMid)
  }

  // 3. 聚合所有有效配额窗口
  const allWindows: QuotaWindow[] = [
    ...codingResult.windows,
    ...zcodeResult.windows,
  ]

  if (allWindows.length === 0) {
    // 区分提示：若是手动填入 API Key 且未查到配额，友好提示可通过网页登录获取免费 Start Plan
    if (!zcodeJwt && apiKey) {
      throw new QuotaQueryError(
        "noQuotaWindows",
        "该智谱账号未检测到生效中的 GLM Coding Plan。如需使用免费每日额度或活动礼包，请使用「网页登录授权」重新绑定。"
      )
    }
    throw new QuotaQueryError("noQuotaWindows")
  }

  const effectivePlanName =
    codingResult.planName ||
    zcodeResult.planName ||
    (zcodeResult.windows.length > 0 ? "ZCode Start Plan" : "智谱 BigModel")

  return {
    accountID,
    windows: allWindows,
    collectedAt,
    providerPlanName: effectivePlanName,
    accountIdentity: envelope.metadata.accountEmail || envelope.accountID,
  }
}
