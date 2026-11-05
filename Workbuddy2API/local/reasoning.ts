// Match the upstream DeepSeek chat contract without changing other model families.
export function prepareReasoning(body: Record<string, unknown>): Record<string, unknown> {
  if (!/^deepseek/i.test(String(body.model).trim())) return body

  const result = { ...body }
  const thinking = result.thinking && typeof result.thinking === "object" && !Array.isArray(result.thinking)
    ? { ...(result.thinking as Record<string, unknown>) } : {}
  const effort = [result.reasoning_effort, result.reasoningEffort]
  const off = effort.some(value => typeof value === "string" && /^(off|none|disabled)$/i.test(value.trim()))
  if (off || typeof thinking.type === "string" && thinking.type.trim().toLowerCase() === "disabled") {
    thinking.type = "disabled"
    delete result.reasoning_effort
    delete result.reasoningEffort
  } else {
    if (typeof thinking.type !== "string" || !thinking.type.trim()) thinking.type = "enabled"
    if (!("reasoning_effort" in result) && !("reasoningEffort" in result)) result.reasoning_effort = "high"
  }
  result.thinking = thinking

  const hasTrace = (result.messages as unknown[]).some(raw => {
    if (!raw || typeof raw !== "object") return false
    const message = raw as Record<string, unknown>
    return typeof message.reasoning === "string" && !!message.reasoning || "reasoning_content" in message
  })
  const enabled = typeof thinking.type === "string" && thinking.type.trim().toLowerCase() === "enabled"
  if (enabled || hasTrace) {
    result.messages = (result.messages as unknown[]).map(raw => {
      if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).role !== "assistant") return raw
      const message = { ...(raw as Record<string, unknown>) }
      if (typeof message.reasoning_content !== "string")
        message.reasoning_content = typeof message.reasoning === "string" ? message.reasoning : ""
      if (typeof message.reasoning !== "string" || !message.reasoning)
        message.reasoning = message.reasoning_content || " "
      return message
    })
  }
  return result
}
