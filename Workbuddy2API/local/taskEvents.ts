import type { GrowthTask } from "./upstream"

// 与 magpie-workbuddy-tasks 的成长任务事件保持同一口径；只收录有明确事件契约的网页任务。
const experts: Record<string, [string, string]> = {
  Expert_lighthouse: ["ex_2cvvUZQhDyeJ", "腾讯轻量云专家"],
  WorkBuddy_Valorant: ["ex_xQHHD1u5Jkua", "无畏契约拼豆专家"],
  workstation_expert: ["WorkspaceBuilder", "工作台搭建师"],
  expert_use_maidehao: ["ex_GDl31WahyIH0", "中国电商运营专家"],
  expert_use_douyinyin: ["ex_FbY5nlWTqDod", "抖音策略师"],
  expert_use_shangjia_xuanchuan: ["ex_Weo3x2EZuSDm", "商家宣传页与海报设计师"],
  expert_use_bowangwang: ["ex_WZY136wV5aMt", "直播电商教练"],
}
const expertPool: [string, string][] = [
  ["ex_PZw8Gu81HfN4", "运维工程师"], ["ex_ROsDtJbzADFV", "产品经理"],
  ["ex_SMUnl0nJbPix", "UI设计师"], ["ex_ZTR062oVBOCW", "数据分析师"],
  ["ex_a3sSSFBy8qaC", "后端架构师"],
]
const teamPool: [string, string][] = [
  ["CloudOpsTeam", "运维专家团队"], ["CloudContentTeam", "内容专家团队"],
  ["CloudDevTeam", "研发专家团队"],
]
const simple = new Set(["create_canvas", "skill_1", "automation_1", "playbook_prompt", "Sequential_Tasks_7", "Hp_Appearance"])

function jumpExpert(url: string): string {
  if (!url || url.length > 4096) return ""
  let value = url
  for (let i = 0; i < 3; i++) {
    try { const decoded = decodeURIComponent(value); if (decoded === value) break; value = decoded }
    catch { break }
  }
  return /expertId=(ex_[A-Za-z0-9_-]{1,64})/.exec(value)?.[1] ?? ""
}

export function supportsGrowthEvent(task: GrowthTask): boolean {
  if (task.miniprogram) return false
  const code = task.task_code
  return simple.has(code) || code === "expert_5" || code === "Expert_team_use_3" || !!experts[code] || !!jumpExpert(task.jump_url ?? "")
}

export function growthEventCount(task: GrowthTask): number {
  const target = task.target ?? (task.task_code === "expert_5" ? 5 : task.task_code === "Expert_team_use_3" ? 3 : 1)
  return Math.max(0, Math.min(5, target - (task.current ?? 0)))
}

export function growthEvents(uid: string, task: GrowthTask, offset: number): Record<string, unknown>[] {
  const code = task.task_code
  const now = Date.now()
  const conversationId = `wb-task-${now}-${offset}`
  const requestId = `${conversationId}-req`
  const common = { timestamp: now, reportDelay: 0, userId: uid }
  if (code === "create_canvas") return [{ ...common, eventCode: "wbx_design_canvas_task_create", conversationId, requestId,
    source: "summon_keyword", isCustomModel: false, name: "", inputLength: 12, id: `wbx-canvas-${now}`, cost: 0, isSuccessful: true }]
  if (code === "skill_1") return [{ ...common, eventCode: "skill_info", skillId: "skill_2096525080079265792", name: "pptx" }]
  if (code === "automation_1") return [{ ...common, eventCode: "automated_task_create_suc", name: "每周工作整理", type: "cron", source: "manually",
    modelId: "deepseek-v4-flash", modelIsThinking: false, conversationId, requestId,
    schedule: { type: "recurring", rrule: "FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=0" }, prompt: "每周五自动整理本周工作" }]
  if (code === "Hp_Appearance") return [{ ...common, eventCode: "appearance_skin_apply", action: "apply", source: "settings_close",
    id: "theme-tkmw7j", vipLevel: "free", series: "craft", type: "unknown", name: "和平精英激战金秋" }]
  if (code === "playbook_prompt" || code === "Sequential_Tasks_7") {
    const fields = { id: "worker-ledger-freedom-dashboard", name: "打工人小账本", type: "document", categoryId: "", categoryName: "",
      source: "discover", conversationId, requestId, messageId: requestId }
    return [
      { ...common, ...fields, eventCode: "playbook_cta_click", position: 0 },
      { ...common, ...fields, eventCode: "playbook_prompt_send", timestamp: now + 50, promptLength: 30, isOfficial: 1, skills: "", skillNames: "" },
    ]
  }
  const derived = jumpExpert(task.jump_url ?? "")
  const pinned = experts[code] ?? (derived ? [derived, /[「"]([^」"]{1,64})[」"]/.exec(task.title)?.[1] ?? task.title] as [string, string] : undefined)
  const team = code === "Expert_team_use_3"
  const [id, name] = pinned ?? (team ? teamPool : expertPool)[((task.current ?? 0) + offset) % (team ? teamPool : expertPool).length]
  return [{ ...common, eventCode: "expert_actual_use", mode: "CLOUD", id, name, expertTitle: name,
    type: "02-Engineering", expertType: team ? "team" : "agent", source: "builtin", version: "1.0.2", cost: 0,
    characterCount: 12, conversationId, requestId, messageId: requestId, requestModelId: "deepseek-v4-flash", requestModelName: "DeepSeek V4 Flash" }]
}
