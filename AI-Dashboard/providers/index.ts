import {
  ProviderCredentialEnvelope,
  ProviderId,
  ProviderQueryResult,
  ProviderQuotaHandler,
} from "../models/types"
import { refreshCredentialIfNeeded } from "../services/provider_auth"
import { computeCredentialFingerprint } from "../utils/credential_store"
import { tryExtractIdentityFromJWT } from "../utils/theme"
import { QuotaQueryError } from "./_shared/http"
import { queryAbacusQuota } from "./abacus"
import { queryAixyQuota } from "./aixy"
import { queryAlibabaCodingPlanQuota } from "./alibabaCodingPlan"
import { queryAlibabaTokenPlanQuota } from "./alibabaTokenPlan"
import { queryAmpQuota } from "./amp"
import { queryAntigravityQuota } from "./antigravity"
import { queryAtlasCloudQuota } from "./atlasCloud"
import { queryAugmentCodeQuota } from "./augmentCode"
import { queryBifrostQuota } from "./bifrost"
import { queryChutesQuota } from "./chutes"
import { queryClaudeQuota } from "./claude"
import { queryClawRouterQuota } from "./clawRouter"
import { queryClinePassQuota } from "./clinePass"
import { queryCodebuffQuota } from "./codebuff"
import { queryCodexQuota } from "./codex"
import { queryCommandCodeQuota } from "./commandCode"
import { queryCopilotQuota } from "./copilot"
import { queryCursorQuota } from "./cursor"
import { queryDeepInfraQuota } from "./deepInfra"
import { queryDeepSeekQuota } from "./deepSeek"
import { queryDevinQuota } from "./devin"
import { queryDevPassQuota } from "./devPass"
import { queryElevenLabsQuota } from "./elevenLabs"
import { queryFactoryQuota } from "./factory"
import { queryGeminiQuota } from "./gemini"
import { queryGitKrakenQuota } from "./gitKraken"
import { queryGrokBotQuota } from "./grokBot"
import { queryHuggingFaceQuota } from "./huggingFace"
import { queryHyperQuota } from "./hyper"
import { queryIBMBobQuota } from "./ibmBob"
import { queryKiloCodeQuota } from "./kiloCode"
import { queryKimiCodeQuota } from "./kimiCode"
import { queryKiroQuota } from "./kiro"
import { queryLiteLLMQuota } from "./liteLLM"
import { queryLLMProxyQuota } from "./llmProxy"
import { queryLongCatQuota } from "./longCat"
import { queryManusQuota } from "./manus"
import { queryMiniMaxChinaQuota } from "./miniMaxChina"
import { queryMiniMaxInternationalQuota } from "./miniMaxInternational"
import { queryMistralQuota } from "./mistral"
import { queryMoonshotQuota } from "./moonshot"
import { queryNeuralwattQuota } from "./neuralwatt"
import { queryNewAPIQuota } from "./newAPI"
import { queryNotionAIQuota } from "./notionAI"
import { queryNousPortalQuota } from "./nousPortal"
import { queryOllamaCloudQuota } from "./ollamaCloud"
import { queryOpenAIAPIQuota } from "./openAIAPI"
import { queryOpenCodeGoQuota } from "./openCodeGo"
import { queryPerplexityQuota } from "./perplexity"
import { queryPoeQuota } from "./poe"
import { queryQoderChinaQuota } from "./qoderChina"
import { queryQoderInternationalQuota } from "./qoderInternational"
import { queryQwenCloudQuota } from "./qwenCloud"
import { queryRaycastAIQuota } from "./raycastAI"
import { queryReplicateQuota } from "./replicate"
import { querySakanaQuota } from "./sakana"
import { queryStepFunQuota } from "./stepFun"
import { querySub2APIQuota } from "./sub2api"
import { querySuperGrokQuota } from "./superGrok"
import { querySyntheticQuota } from "./synthetic"
import { queryT3ChatQuota } from "./t3Chat"
import { queryTraeQuota } from "./trae"
import { queryTypeSafeQuota } from "./typeSafe"
import { queryV0Quota } from "./v0"
import { queryV2EXQuota } from "./v2ex"
import { queryVeniceQuota } from "./venice"
import { queryVercelAIGatewayQuota } from "./vercelAIGateway"
import { queryVolcengineQuota } from "./volcengine"
import { queryWarpQuota } from "./warp"
import { queryWindsurfQuota } from "./windsurf"
import { queryWorkBuddyQuota } from "./workBuddy"
import { queryXaiAPIQuota } from "./xaiAPI"
import { queryXiaomiCodingPlanQuota } from "./xiaomiCodingPlan"
import { queryXKiroQuota } from "./xKiro"
import { queryZaiQuota } from "./zai"
import { queryZedQuota } from "./zed"
import { queryZenMuxQuota } from "./zenMux"
import { queryZhipuQuota } from "./zhipu"
import { queryZoomMateQuota } from "./zoomMate"

export { QuotaQueryError }

export const PROVIDER_HANDLERS: Record<ProviderId, ProviderQuotaHandler> = {
  abacus: queryAbacusQuota,
  aixy: queryAixyQuota,
  alibabaCodingPlan: queryAlibabaCodingPlanQuota,
  alibabaTokenPlan: queryAlibabaTokenPlanQuota,
  amp: queryAmpQuota,
  antigravity: queryAntigravityQuota,
  atlasCloud: queryAtlasCloudQuota,
  augmentCode: queryAugmentCodeQuota,
  bifrost: queryBifrostQuota,
  chutes: queryChutesQuota,
  claude: queryClaudeQuota,
  clawRouter: queryClawRouterQuota,
  clinePass: queryClinePassQuota,
  codebuff: queryCodebuffQuota,
  codex: queryCodexQuota,
  commandCode: queryCommandCodeQuota,
  copilot: queryCopilotQuota,
  cursor: queryCursorQuota,
  deepInfra: queryDeepInfraQuota,
  deepSeek: queryDeepSeekQuota,
  devin: queryDevinQuota,
  devPass: queryDevPassQuota,
  elevenLabs: queryElevenLabsQuota,
  factory: queryFactoryQuota,
  gemini: queryGeminiQuota,
  gitKraken: queryGitKrakenQuota,
  grokBot: queryGrokBotQuota,
  huggingFace: queryHuggingFaceQuota,
  hyper: queryHyperQuota,
  ibmBob: queryIBMBobQuota,
  kiloCode: queryKiloCodeQuota,
  kimiCode: queryKimiCodeQuota,
  kiro: queryKiroQuota,
  liteLLM: queryLiteLLMQuota,
  llmProxy: queryLLMProxyQuota,
  longCat: queryLongCatQuota,
  manus: queryManusQuota,
  miniMax: async (accountID, envelope, collectedAt) => {
    if (envelope.metadata.region === "global") {
      return queryMiniMaxInternationalQuota(accountID, envelope, collectedAt)
    }
    return queryMiniMaxChinaQuota(accountID, envelope, collectedAt)
  },
  miniMaxChina: queryMiniMaxChinaQuota,
  miniMaxInternational: queryMiniMaxInternationalQuota,
  mistral: queryMistralQuota,
  moonshot: queryMoonshotQuota,
  neuralwatt: queryNeuralwattQuota,
  newAPI: queryNewAPIQuota,
  notionAI: queryNotionAIQuota,
  nousPortal: queryNousPortalQuota,
  ollamaCloud: queryOllamaCloudQuota,
  openAIAPI: queryOpenAIAPIQuota,
  openCodeGo: queryOpenCodeGoQuota,
  perplexity: queryPerplexityQuota,
  poe: queryPoeQuota,
  qoder: async (accountID, envelope, collectedAt) => {
    if (envelope.metadata.region === "global") {
      return queryQoderInternationalQuota(accountID, envelope, collectedAt)
    }
    return queryQoderChinaQuota(accountID, envelope, collectedAt)
  },
  qoderChina: queryQoderChinaQuota,
  qoderInternational: queryQoderInternationalQuota,
  qwenCloud: queryQwenCloudQuota,
  raycastAI: queryRaycastAIQuota,
  replicate: queryReplicateQuota,
  sakana: querySakanaQuota,
  stepFun: queryStepFunQuota,
  sub2api: querySub2APIQuota,
  superGrok: querySuperGrokQuota,
  synthetic: querySyntheticQuota,
  t3Chat: queryT3ChatQuota,
  trae: queryTraeQuota,
  typeSafe: queryTypeSafeQuota,
  v0: queryV0Quota,
  v2ex: queryV2EXQuota,
  venice: queryVeniceQuota,
  vercelAIGateway: queryVercelAIGatewayQuota,
  volcengine: queryVolcengineQuota,
  warp: queryWarpQuota,
  windsurf: queryWindsurfQuota,
  workBuddy: queryWorkBuddyQuota,
  xaiAPI: queryXaiAPIQuota,
  xiaomiCodingPlan: queryXiaomiCodingPlanQuota,
  xKiro: queryXKiroQuota,
  zai: queryZaiQuota,
  zed: queryZedQuota,
  zenMux: queryZenMuxQuota,
  zhipu: queryZhipuQuota,
  zoomMate: queryZoomMateQuota,
}

/**
 * 统一入口：根据供应商 ID 自动分派到 providers/ 目录下对应的独立平台脚本
 */
export async function queryProviderQuota(
  accountID: string,
  initialEnvelope: ProviderCredentialEnvelope
): Promise<ProviderQueryResult> {
  let envelope = initialEnvelope
  let updatedCredential: ProviderCredentialEnvelope | undefined

  if (!envelope.accessToken.trim()) {
    throw new QuotaQueryError("missingCredential")
  }

  const refreshed = await refreshCredentialIfNeeded(envelope)
  if (refreshed) {
    envelope = refreshed
    updatedCredential = refreshed
  }

  const handler = PROVIDER_HANDLERS[envelope.provider]
  if (!handler) {
    throw new QuotaQueryError("unsupportedProvider")
  }

  const collectedAt = new Date().toISOString()
  const snapshot = await handler(accountID, envelope, collectedAt)
  snapshot.sourceCredentialFingerprint =
    envelope.metadata.sourceCredentialFingerprint ||
    computeCredentialFingerprint(envelope)

  if (!snapshot.accountIdentity) {
    const fromMeta =
      envelope.metadata.accountEmail ||
      envelope.metadata.email ||
      envelope.metadata.phone ||
      envelope.metadata.phoneNumber ||
      envelope.metadata.nickname ||
      envelope.metadata.username ||
      envelope.metadata.uid ||
      envelope.accountID
    const fromJwt = tryExtractIdentityFromJWT(envelope.accessToken)
    snapshot.accountIdentity = fromMeta || fromJwt || undefined
  }
  if (!snapshot.region && envelope.metadata.region) {
    snapshot.region = envelope.metadata.region
  }

  return {
    snapshot,
    updatedCredential,
  }
}
