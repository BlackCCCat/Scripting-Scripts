// File: utils/deploy.ts
import { Runtime } from "./runtime";
import type { InputMethod } from "./config";

export async function deployHamster(method: InputMethod) {
  if (method === "scripting") {
    const RimeApi: any = (globalThis as any).Rime
    if (!RimeApi?.setup || !RimeApi?.deploy) {
      throw new Error("当前不支持自动部署，请手动部署")
    }
    await RimeApi.setup({ appName: "万象方案助手" })
    await RimeApi.deploy({ fullCheck: false })
    return true
  }
  const url =
    method === "hamster3"
      ? "hamster3://dev.fuxiao.app.hamster3/rime?action=deploy"
      : "hamster://dev.fuxiao.app.hamster/rime?deploy";

  const Safari = Runtime.Safari;
  if (Safari?.openURL) {
    const ok = await Safari.openURL(url);
    if (!ok) throw new Error("打开 URL 失败");
    return ok;
  }
  if (Safari?.open) {
    const ok = await Safari.open(url);
    if (ok === false) throw new Error("打开 URL 失败");
    return ok;
  }

  // 兜底：如果运行时提供 openURL
  const openURL = (globalThis as any).openURL;
  if (typeof openURL === "function") {
    const ok = await openURL(url);
    if (ok === false) throw new Error("打开 URL 失败");
    return ok;
  }

  throw new Error("无法打开 URL scheme：Safari.openURL/open/openURL 都不存在");
}
