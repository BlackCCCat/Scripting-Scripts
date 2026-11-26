/**
 * 生成运行 Apple 快捷指令的 URL Scheme；名称为空时返回 null。
 */
export function buildRunShortcutUrl(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return `shortcuts://run-shortcut?name=${encodeURIComponent(trimmed)}`;
}

/**
 * 通过 Safari.openURL 启动指定名称的快捷指令。
 */
export async function launchShortcut(
  name: string,
  onToast: (message: string) => void,
): Promise<boolean> {
  const trimmed = name.trim();
  const url = buildRunShortcutUrl(trimmed);
  if (!url) {
    onToast("请先在「设置」中配置快捷指令名称");
    return false;
  }
  try {
    const ok = await Safari.openURL(url);
    if (!ok) {
      onToast(`无法运行快捷指令：${trimmed}`);
    }
    return ok;
  } catch {
    onToast(`启动快捷指令失败：${trimmed}`);
    return false;
  }
}
