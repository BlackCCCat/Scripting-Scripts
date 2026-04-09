// 文件名: core.ts (核心逻辑模块)
// 用途: 供 intent.tsx 和 index.tsx 共同导入和使用。

import { Script } from "scripting";

// 🚨 关键修复：不再依赖 'declare const Storage'
const GlobalStorage = (window as any)?.Storage || (global as any)?.Storage;

// =====================================
// 工具函数和配置 (从 index.tsx 移植)
// =====================================
const INTENT_DATA_KEY = "smsPickup_intent_data_temp";
const CONFIG_KEY = "smsPickup_widget_config_v1"
// ... [DEFAULT_CONFIG, markPicked, extractPickupFromText, CODE_RE, GENERIC_RE, 等所有常量和工具函数] ...

// 必须从 index.tsx 中完整复制过来，但需要确保所有外部声明都被移除
// 因为篇幅限制，此处假设您已将 index.tsx 中的所有 non-UI 函数和常量完整复制到此文件。

// 假设您已完整复制了 loadConfig, saveConfig, addImportedMessage, resetConfig, markPicked, extractPickupFromText, getAllPickupInfo。

// 完整复制 index.tsx 中的 handleAnyData 函数，并导出
export function handleAnyData(data: string) {
  // 完整复制 index.tsx 中的 handleAnyData 逻辑
  if (!data.trim()) return 0

  let parts: string[]
  if (data.includes("---SMS-DIVIDER---")) {
    parts = data.split(/---SMS-DIVIDER---/g).map(s => s.trim()).filter(Boolean)
  } else {
    parts = data.split(/\n{2,}|\r{2,}|\r\n{2,}/g).map(s => s.trim()).filter(Boolean)
  }

  // ⚠️ 注意：这里的 loadConfig/extractPickupFromText 必须是此文件内定义的版本
  let newCount = 0
  const cfg = loadConfig() // 确保 loadConfig 是在 core.ts 中定义的
  const pickedSet = new Set((cfg.pickedItems || []).map(item => item.code))

  for (const p of parts) {
    const extracted = extractPickupFromText(p) // 确保 extractPickupFromText 是在 core.ts 中定义的

    const hasNew = extracted.some(it => !pickedSet.has(it.code))

    if (extracted.length > 0 && hasNew) {
      addImportedMessage(p) // 确保 addImportedMessage 是在 core.ts 中定义的
      newCount++
    }
  }
  return newCount
}

// 导出所有需要的函数
export { loadConfig, markPicked, getAllPickupInfo }; 
