import {
  ProviderId,
  QuotaSnapshot,
  QuotaWindow,
  SubscriptionAccount,
} from "../models/types"
import { getProviderMeta } from "./providers_catalog"

const DEMO_DEFAULT_PROVIDERS: {
  id: string
  provider: ProviderId
  displayName: string
  serverAddress?: string
  region?: string
  widgetOrder?: number
}[] = [
  {
    id: "demo-deepseek-01",
    provider: "deepSeek",
    displayName: "DeepSeek",
  },
  {
    id: "demo-codex-01",
    provider: "codex",
    displayName: "OpenAI Codex",
  },
  {
    id: "demo-claude-01",
    provider: "claude",
    displayName: "Claude",
  },
  {
    id: "demo-volcengine-01",
    provider: "volcengine",
    displayName: "火山方舟",
  },
  {
    id: "demo-minimax-01",
    provider: "miniMax",
    displayName: "MiniMax",
    region: "cn",
  },
  {
    id: "demo-trae-01",
    provider: "trae",
    displayName: "TRAE",
    region: "cn",
  },
  {
    id: "demo-newapi-01",
    provider: "newAPI",
    displayName: "New API",
    serverAddress: "https://api.gateway.example.com",
  },
  {
    id: "demo-copilot-01",
    provider: "copilot",
    displayName: "GitHub Copilot",
  },
  {
    id: "demo-cursor-01",
    provider: "cursor",
    displayName: "Cursor",
  },
  {
    id: "demo-workbuddy-01",
    provider: "workBuddy",
    displayName: "WorkBuddy",
    region: "cn",
    widgetOrder: 1,
  },
  {
    id: "demo-workbuddy-02",
    provider: "workBuddy",
    displayName: "WorkBuddy",
    region: "cn",
    widgetOrder: 2,
  },
  {
    id: "demo-workbuddy-03",
    provider: "workBuddy",
    displayName: "WorkBuddy",
    region: "cn",
    widgetOrder: 3,
  },
  {
    id: "demo-workbuddy-04",
    provider: "workBuddy",
    displayName: "WorkBuddy",
    region: "cn",
    widgetOrder: 4,
  },
  {
    id: "demo-workbuddy-05",
    provider: "workBuddy",
    displayName: "WorkBuddy",
    region: "cn",
    widgetOrder: 5,
  },
  {
    id: "demo-workbuddy-06",
    provider: "workBuddy",
    displayName: "WorkBuddy",
    region: "cn",
    widgetOrder: 6,
  },
]

export function createDefaultDemoAccounts(): SubscriptionAccount[] {
  const nowIso = new Date().toISOString()
  return DEMO_DEFAULT_PROVIDERS.map((item) => ({
    id: item.id,
    provider: item.provider,
    displayName: item.displayName,
    credentialKeychainKey: `demo.credential.${item.id}`,
    createdAt: nowIso,
    lastSuccessAt: nowIso,
    isEnabled: true,
    preferssynchronizableKeychain: false,
    serverAddress: item.serverAddress,
    region: item.region,
    widgetOrder: item.widgetOrder,
  }))
}

export function generateDemoSnapshot(
  accountID: string,
  provider: ProviderId,
  region?: string
): QuotaSnapshot {
  const now = new Date()
  const nowIso = now.toISOString()
  const in3Hours = new Date(now.getTime() + 3 * 3600 * 1000).toISOString()
  const in5Days = new Date(now.getTime() + 5 * 86400 * 1000).toISOString()
  const in22Days = new Date(now.getTime() + 22 * 86400 * 1000).toISOString()

  const specificWindows = getProviderDemoWindows(
    provider,
    in3Hours,
    in5Days,
    in22Days,
    accountID
  )

  return {
    accountID,
    windows: specificWindows.windows,
    collectedAt: nowIso,
    providerPlanName: specificWindows.planName,
    accountIdentity: specificWindows.identity,
    sourceCredentialFingerprint: `demo-fp-${provider}`,
    region,
    codexResetCards: specificWindows.codexResetCards,
  }
}

function getProviderDemoWindows(
  provider: ProviderId,
  in3Hours: string,
  in5Days: string,
  in22Days: string,
  accountId?: string
): {
  planName?: string
  identity?: string
  windows: QuotaWindow[]
  codexResetCards?: { availableCount: number; expirations?: string[] }
} {
  switch (provider) {
    case "deepSeek":
      return {
        planName: "API",
        identity: "developer@deepseek.com",
        windows: [
          {
            id: "deepseek.cny",
            name: "人民币余额 (CNY)",
            unit: "CNY",
            wallet: {
              currency: "CNY",
              total: 128.65,
              granted: 28.65,
              toppedUp: 100.0,
              isMonetary: true,
            },
          },
          {
            id: "deepseek.usd",
            name: "美元余额 (USD)",
            unit: "USD",
            wallet: {
              currency: "USD",
              total: 15.4,
              granted: 0,
              toppedUp: 15.4,
              isMonetary: true,
            },
          },
        ],
      }

    case "codex":
      return {
        planName: "Pro",
        identity: "dev@example.com",
        codexResetCards: {
          availableCount: 2,
        },
        windows: [
          {
            id: "codex.5h",
            name: "5 小时限流",
            period: "fiveHour",
            usedPercentage: 34,
            resetsAt: in3Hours,
          },
          {
            id: "codex.weekly",
            name: "7 天配额",
            period: "weekly",
            usedPercentage: 18,
            resetsAt: in5Days,
          },
          {
            id: "codex.credits",
            name: "Credits 余额",
            unit: "Credits",
            wallet: {
              currency: "Credits",
              total: 940,
              isMonetary: false,
            },
          },
        ],
      }

    case "claude":
      return {
        planName: "Max",
        identity: "org_anthropic_demo",
        windows: [
          {
            id: "claude.5h",
            name: "5 小时限流",
            period: "fiveHour",
            usedPercentage: 42,
            resetsAt: in3Hours,
          },
          {
            id: "claude.weekly",
            name: "7 天配额",
            period: "weekly",
            usedPercentage: 27,
            resetsAt: in5Days,
          },
          {
            id: "claude.overage",
            name: "按量扩展",
            period: "monthly",
            usedPercentage: 12,
            exactCounts: {
              used: 12.0,
              remaining: 88.0,
              total: 100.0,
            },
            unit: "USD",
            overagePermitted: true,
            resetsAt: in22Days,
          },
        ],
      }

    case "volcengine":
      return {
        planName: "Coding Plan",
        identity: "AKLT****demo",
        windows: [
          {
            id: "volcengine.coding.fiveHour",
            name: "5 小时额度",
            scope: "Coding Plan",
            period: "fiveHour",
            usedPercentage: 22.5,
            resetsAt: in3Hours,
          },
          {
            id: "volcengine.coding.monthly",
            name: "每月额度",
            scope: "Coding Plan",
            period: "monthly",
            usedPercentage: 46.8,
            resetsAt: in22Days,
          },
          {
            id: "volcengine.agent.monthly",
            name: "每月额度",
            scope: "Agent Plan",
            period: "monthly",
            usedPercentage: 31.0,
            remainingCount: 690,
            totalCount: 1000,
            unit: "AFP",
            resetsAt: in22Days,
          },
        ],
      }

    case "miniMax":
    case "miniMaxChina":
    case "miniMaxInternational":
      return {
        planName: "Pro",
        identity:
          provider === "miniMaxInternational"
            ? "global_dev@minimax.io"
            : "13800138000",
        windows: [
          {
            id: "minimax.coding.5h",
            name: "5 小时限流",
            period: "fiveHour",
            usedPercentage: 28,
            remainingCount: 360,
            totalCount: 500,
            unit: "次",
            resetsAt: in3Hours,
          },
          {
            id: "minimax.cash",
            name:
              provider === "miniMaxInternational"
                ? "美元余额 (USD)"
                : "人民币余额 (CNY)",
            unit: provider === "miniMaxInternational" ? "USD" : "CNY",
            wallet: {
              currency: provider === "miniMaxInternational" ? "USD" : "CNY",
              total: provider === "miniMaxInternational" ? 42.5 : 256.8,
              granted: provider === "miniMaxInternational" ? 12.5 : 56.8,
              toppedUp: provider === "miniMaxInternational" ? 30.0 : 200.0,
              isMonetary: true,
            },
          },
        ],
      }

    case "trae":
      return {
        planName: "Free",
        identity: "trae_developer",
        windows: [
          {
            id: "trae.credits.total",
            name: "TRAE 订阅额度",
            period: "monthly",
            unit: "积分",
            usedPercentage: 25,
            remainingCount: 750,
            totalCount: 1000,
            exactCounts: {
              used: 250,
              remaining: 750,
              total: 1000,
            },
            resetsAt: in22Days,
          },
        ],
      }

    case "newAPI":
    case "sub2api":
    case "bifrost":
    case "liteLLM":
    case "llmProxy": {
      return {
        planName: "企业分组",
        identity: "admin_gateway",
        windows: [
          {
            id: `${provider}.budget`,
            name: "总额配额",
            usedPercentage: 36.4,
            exactCounts: {
              used: 18.2,
              remaining: 31.8,
              total: 50.0,
            },
            unit: "USD",
            expiresAt: in22Days,
            resetSemantics: "nonResettingAllowance",
          },
        ],
      }
    }

    case "copilot":
      return {
        planName: "Pro",
        identity: "github-user",
        windows: [
          {
            id: "copilot.premium",
            name: "高级模型交互",
            period: "monthly",
            usedPercentage: 41,
            remainingCount: 177,
            totalCount: 300,
            unit: "次",
            resetsAt: in22Days,
          },
          {
            id: "copilot.chat",
            name: "标准代码补全与对话",
            isUnlimited: true,
          },
        ],
      }

    case "cursor":
    case "grokBot":
      return {
        planName: "Pro",
        identity: "user_01J9DEMO",
        windows: [
          {
            id: "cursor.included",
            name: "订阅请求",
            period: "monthly",
            usedPercentage: 54,
            remainingCount: 230,
            totalCount: 500,
            unit: "次",
            resetsAt: in22Days,
          },
          {
            id: "cursor.ondemand",
            name: "按量扩展",
            period: "monthly",
            usedPercentage: 15,
            exactCounts: {
              used: 15.0,
              remaining: 85.0,
              total: 100.0,
            },
            unit: "USD",
            overagePermitted: true,
            resetsAt: in22Days,
          },
        ],
      }

    case "workBuddy": {
      const idStr = accountId || ""
      const idx = idStr.endsWith("-02")
        ? 2
        : idStr.endsWith("-03")
          ? 3
          : idStr.endsWith("-04")
            ? 4
            : idStr.endsWith("-05")
              ? 5
              : idStr.endsWith("-06")
                ? 6
                : 1
      const identities = [
        "15712345678",
        "谁说我是小警长",
        "team_wb_user",
        "889988@gmail.com",
        "DevOps_Master",
        "13900008888",
      ]
      const usedPcts = [36, 15, 58, 42, 18, 85]
      const currentIdentity = identities[idx - 1] || "wb_user_cn"
      const currentUsed = usedPcts[idx - 1] ?? 0

      return {
        planName: "Free",
        identity: currentIdentity,
        windows: [
          {
            id: `workbuddy.credits.${idStr || "01"}`,
            name: "总配额",
            period: "monthly",
            unit: "积分",
            usedPercentage: currentUsed,
            remainingCount: 1000 - currentUsed * 10,
            totalCount: 1000,
            exactCounts: {
              used: currentUsed * 10,
              remaining: 1000 - currentUsed * 10,
              total: 1000,
            },
            resetsAt: in22Days,
          },
        ],
      }
    }

    case "antigravity":
      return {
        planName: "Pro",
        identity: "developer@gmail.com",
        windows: [
          {
            id: "antigravity.gemini.5h",
            name: "Gemini 5小时",
            period: "fiveHour",
            usedPercentage: 25,
            resetsAt: in3Hours,
          },
          {
            id: "antigravity.gemini.weekly",
            name: "Gemini 周配额",
            period: "weekly",
            usedPercentage: 18,
            resetsAt: in5Days,
          },
          {
            id: "antigravity.claude.5h",
            name: "Claude / GPT 5小时",
            period: "fiveHour",
            usedPercentage: 45,
            resetsAt: in3Hours,
          },
          {
            id: "antigravity.claude.weekly",
            name: "Claude / GPT 周配额",
            period: "weekly",
            usedPercentage: 32,
            resetsAt: in5Days,
          },
          {
            id: "antigravity.argon.weekly",
            name: "Gemini 4 Argon",
            period: "weekly",
            usedPercentage: 10,
            resetsAt: in5Days,
          },
        ],
      }

    default: {
      const meta = getProviderMeta(provider)
      const isDomesticProvider = [
        "aliyunBailian",
        "baichuan",
        "baiduComate",
        "doubao",
        "giteeAI",
        "glmCoding",
        "hunyuan",
        "iflytekSpark",
        "kimi",
        "kimiK2",
        "modelScope",
        "moonshot",
        "qwen",
        "sensenova",
        "siliconFlow",
        "stepFun",
        "tencentCloud",
        "zhipuGLM",
      ].includes(provider)
      if (meta.routeCategory === "direct_api") {
        const currency = isDomesticProvider ? "CNY" : "USD"
        return {
          planName: "API",
          windows: [
            {
              id: `${provider}.wallet`,
              name: isDomesticProvider ? "人民币余额 (CNY)" : "账户可用余额",
              unit: currency,
              wallet: {
                currency,
                total: isDomesticProvider ? 168.0 : 24.5,
                isMonetary: true,
              },
            },
          ],
        }
      }
      return {
        planName: "Pro",
        windows: [
          {
            id: `${provider}.primary`,
            name: "月度配额",
            period: "monthly",
            usedPercentage: 29,
            remainingCount: 710,
            totalCount: 1000,
            unit: isDomesticProvider ? "积分" : "Credits",
            resetsAt: in22Days,
          },
        ],
      }
    }
  }
}
