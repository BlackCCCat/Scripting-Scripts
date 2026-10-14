import type { RimeKeyboardSettings } from "../settings";
import { ensureT9ProcessorLuaInstalled } from "../t9ProcessorInstall";

let pendingPreparation: Promise<void> = Promise.resolve();

export function prepareRimeSession(
  settings: RimeKeyboardSettings,
  isDisposed: () => boolean,
) {
  if (settings.disableRime) {
    return Promise.resolve({
      list: [] as Rime.Schema[],
      session: null,
      stages: [] as Array<{ name: string; timestamp: number }>,
      error: null as string | null,
    });
  }
  // Rime is process-wide; only its startup work is serialized, never key input.
  const result = pendingPreparation.then(() => Thread.runInBackground(async () => {
    const stages: Array<{ name: string; timestamp: number }> = [];
    const mark = (name: string) => {
      if (settings.performanceDiagnostics) {
        stages.push({ name, timestamp: Date.now() });
      }
    };
    const emptyResult = {
      list: [] as Rime.Schema[],
      session: null,
      stages,
      error: null as string | null,
    };
    if (isDisposed()) return emptyResult;
    try {
      mark("Rime 后台任务开始");
      if (!Rime.isSetUp) {
        mark("Rime.setup 开始");
        await Rime.setup();
        mark("Rime.setup 完成");
      } else mark("Rime 已初始化");
      if (isDisposed()) return emptyResult;
      if (settings.keyboardType === "t9") {
        mark("九键处理器检查开始");
        await ensureT9ProcessorLuaInstalled();
        mark("九键处理器检查完成");
        if (isDisposed()) return emptyResult;
      }
      if (settings.autoDeployOnLaunch) {
        mark("Rime.deploy 开始");
        await Rime.deploy({ fullCheck: false });
        mark("Rime.deploy 完成");
        if (isDisposed()) return emptyResult;
      }
      mark("读取 Rime 方案开始");
      const list = await Rime.listSchemas();
      mark("读取 Rime 方案完成");
      if (isDisposed()) return emptyResult;
      const session = list.length > 0 ? new Rime.Session() : null;
      if (isDisposed()) {
        session?.close();
        return emptyResult;
      }
      mark(session ? "Rime 会话创建完成" : "没有已部署方案");
      return { list, session, stages, error: null as string | null };
    } catch (error) {
      mark("Rime 后台准备失败");
      return {
        ...emptyResult,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  pendingPreparation = result.then(() => {}, () => {});
  return result;
}
