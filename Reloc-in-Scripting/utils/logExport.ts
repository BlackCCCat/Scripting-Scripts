import { Script } from "scripting";
import { debugLogCount, debugLogText } from "../core/debug";
import type { ProtocolEvent } from "../types";

export function formatProtocolLogReport(events: ProtocolEvent[]): string {
  const header = [
    `Reloc in Scripting v${Script.metadata.version}`,
    `设备: ${Device.systemName} ${Device.systemVersion} · ${Device.model}`,
    `导出时间: ${new Date().toISOString()}`,
    "----------------------------------------",
  ];

  const eventLines = events
    .slice()
    .reverse()
    .map((e) => `[${e.timestamp}] ${e.isError ? "ERROR" : "EVENT"} ${e.name}${e.detail ? ` | ${e.detail}` : ""}`);

  const trace = debugLogText();
  return [
    ...header,
    `协议事件 (${eventLines.length} 条):`,
    ...(eventLines.length ? eventLines : ["（暂无协议事件）"]),
    "",
    `底层调试日志 (${debugLogCount()} 条 · 已脱敏):`,
    trace || "（暂无调试日志）",
  ].join("\n");
}

export async function exportDiagnosticLogs(events: ProtocolEvent[]): Promise<string> {
  const content = formatProtocolLogReport(events);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const path = `${FileManager.temporaryDirectory}/reloc-${stamp}.txt`;
  await FileManager.writeAsString(path, content);
  await ShareSheet.present([path]);
  return "已导出日志";
}
