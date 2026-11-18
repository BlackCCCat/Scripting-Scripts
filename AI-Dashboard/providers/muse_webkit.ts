import type { QuotaSnapshot } from "../models/types"
import { QuotaQueryError } from "./_shared/http"

// 在 muse.ai 的已登录 WebKit 页面内执行，只返回订阅额度、额外 Token 文案和 Action ID。
// 发现流程参考 https://github.com/whnnick/readycheck/blob/main/Sources/ReadyCheckApp/Resources/MuseSubscription.js
const SUBSCRIPTION_SCRIPT = `
if (location.origin !== "https://muse.ai") return JSON.stringify({error: "loginRequired", stage: "home"});
const deadline = new AbortController();
const timer = setTimeout(() => deadline.abort(), 25000);
let stage = "home";
try {
  const pathsIn = text => [...new Set((text.match(/static\\/(?:immutable\\/)?chunks\\/[\\w~.-]+\\.js/g) || [])
    .map(path => "/_next/" + path))];
  const actionFrom = text => /"([0-9a-f]{40,64})",[^"\\n]{0,200}"fetchSubscriptionAction"/.exec(text)?.[1];
  const readChunk = async path => {
    if (!/^\\/_next\\/static\\/(?:immutable\\/)?chunks\\/[\\w~.-]+\\.js$/.test(path)) return "";
    const response = await fetch(path, {credentials: "omit", signal: deadline.signal, redirect: "error"});
    const body = response.ok ? await response.text() : "";
    if (body.length > 2000000) throw Error("responseChanged");
    return body;
  };
  const discover = async () => {
    stage = "home";
    const response = await fetch("/", {method: "GET", credentials: "same-origin", cache: "no-store",
      headers: {Accept: "text/html"}, signal: deadline.signal, redirect: "manual"});
    if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403) throw Error("loginRequired");
    if (response.status === 429) throw Error("rateLimited");
    if (!response.ok) throw Error("network");
    const html = await response.text();
    if (html.length > 8000000) throw Error("responseChanged");
    const paths = pathsIn(html).slice(0, 128).reverse();
    stage = "discovery";
    const modules = new Set();
    const loaders = new Map();
    let bytesRead = 0;
    for (let i = 0; i < paths.length; i += 8) {
      const bodies = await Promise.all(paths.slice(i, i + 8).map(readChunk));
      for (const body of bodies) {
        bytesRead += body.length;
        if (bytesRead > 32000000) throw Error("responseChanged");
        const direct = actionFrom(body);
        if (direct) return direct;
        for (const [, module] of body.matchAll(/\\.A\\((\\d+)\\)\\.then\\(\\(\\{[^}]*Settings/g)) modules.add(module);
        for (const [, module, dependencies] of body.matchAll(/[,\\{\\[](\\d+),\\w+=>\\{\\w+\\.v\\(\\w+=>Promise\\.all\\(\\[([^\\]]*)/g)) {
          const settings = pathsIn(dependencies);
          if (settings.length) loaders.set(module, settings);
        }
      }
    }
    for (const module of modules) {
      const settings = loaders.get(module)?.slice(0, 32);
      if (!settings) continue;
      for (let i = 0; i < settings.length; i += 8) {
        const bodies = await Promise.all(settings.slice(i, i + 8).map(readChunk));
        for (const body of bodies) {
          const id = actionFrom(body);
          if (id) return id;
        }
      }
    }
    throw Error("responseChanged");
  };
  const post = action => {
    stage = "subscription";
    if (!/^[0-9a-f]{40,64}$/.test(action)) throw Error("responseChanged");
    return fetch("/", {method: "POST", credentials: "same-origin", redirect: "error", signal: deadline.signal,
      headers: {Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8", "Next-Action": action},
      body: JSON.stringify([{includeAgreement: true}])});
  };
  const hadCache = /^[0-9a-f]{40,64}$/.test(cachedActionID || "");
  let action = hadCache ? cachedActionID : await discover();
  let response = await post(action);
  if (hadCache && [400, 404, 409].includes(response.status)) {
    action = await discover();
    response = await post(action);
  }
  if (response.status === 401 || response.status === 403) throw Error("loginRequired");
  if (response.status === 429) throw Error("rateLimited");
  if (!response.ok) throw Error(response.status === 404 ? "responseChanged" : "network");
  const body = await response.text();
  stage = "response";
  if (body.length > 524288) throw Error("responseChanged");
  const rows = body.split("\\n").filter(line => /^[0-9a-f]+:\\{/.test(line)).map(line => {
    try { return JSON.parse(line.slice(line.indexOf(":") + 1)); } catch { return null; }
  }).filter(row => typeof row?.success === "boolean");
  if (rows.length !== 1) throw Error("responseChanged");
  if (rows[0].success !== true || !rows[0].subscription?.usage || !rows[0].subscription?.tier?.name) throw Error("subscriptionRequired");
  const sub = rows[0].subscription;
  const filtered = {success: true, subscription: {tier: sub.tier && {name: sub.tier.name},
    usage: {percentUsed: sub.usage.percentUsed, resetsAt: sub.usage.resetsAt},
    topupBalance: sub.topupBalance, topupTotal: sub.topupTotal,
    topupRowValueLabel: sub.topupRowValueLabel}};
  return JSON.stringify({actionID: action, flight: "1:" + JSON.stringify(filtered)});
} catch (error) {
  return JSON.stringify({error: deadline.signal.aborted ? "timedOut" :
    ["responseChanged", "loginRequired", "rateLimited", "subscriptionRequired"].includes(error.message) ? error.message : "network", stage});
} finally { clearTimeout(timer); }
`

const STAGE_LABELS: Record<string, string> = {
  home: "打开首页",
  discovery: "查找订阅入口",
  subscription: "读取订阅额度",
  response: "解析订阅额度",
}

export async function queryMuseViaWebKit(
  cookieHeader: string,
  cachedActionID: string | null,
  accountID: string,
  collectedAt: string,
  parseFlight: (body: string, accountID: string, collectedAt: string) => QuotaSnapshot,
  existingWebView?: WebViewController
): Promise<{ snapshot: QuotaSnapshot; actionID: string }> {
  const webView = existingWebView ?? new WebViewController({ ephemeral: true })
  let timedOut = false
  let stage = "打开首页"
  const timeout = setTimeout(() => {
    timedOut = true
    webView.dispose()
  }, 45_000)
  try {
    try {
      await webView.setSettings({ inactiveSchedulingPolicy: "none" })
    } catch {
      // 较低系统版本没有离屏调度选项，沿用 WebKit 默认行为。
    }
    if (!existingWebView) {
      const allowedNames = new Set([
        "hatch_sess", "hatch_vml", "hatch_gw", "hatch_native_auth_device",
      ])
      let hasSession = false
      for (const part of cookieHeader.split(";")) {
        const separator = part.indexOf("=")
        if (separator < 1) continue
        const name = part.slice(0, separator).trim()
        const value = part.slice(separator + 1).trim()
        if (!allowedNames.has(name) || !value) continue
        const accepted = await webView.setCookie({
          name,
          value,
          domain: "muse.ai",
          path: "/",
          isSecure: true,
          isHTTPOnly: true,
          isSessionOnly: true,
        })
        if (name === "hatch_sess" && accepted) hasSession = true
      }
      if (!hasSession) throw new QuotaQueryError("invalidCredential", "Muse 登录会话无效")

      const loaded = await webView.loadURL("https://muse.ai/")
      if (!loaded) throw new QuotaQueryError("network", "Muse WebView 打开首页失败")
    }
    stage = "查询订阅"
    const raw = await webView.callAsyncJavaScript<string>(SUBSCRIPTION_SCRIPT, {
      cachedActionID: cachedActionID ?? "",
    })
    let result: { error?: string; stage?: string; actionID?: string; flight?: string }
    try {
      result = JSON.parse(raw)
    } catch {
      throw new QuotaQueryError("unreadableResponse", "Muse WebView 响应无效")
    }
    if (result.error) {
      const stage = STAGE_LABELS[result.stage ?? ""] ?? "查询"
      const code = result.error === "loginRequired"
        ? "invalidCredential"
        : result.error === "rateLimited"
          ? "rateLimited"
        : result.error === "subscriptionRequired"
          ? "subscriptionRequired"
        : result.error === "responseChanged"
          ? "unreadableResponse"
          : "network"
      const detail = result.error === "timedOut"
        ? `Muse ${stage}超时`
        : result.error === "loginRequired"
          ? "Muse 登录已失效，请重新登录"
          : result.error === "rateLimited"
            ? "Muse 请求过于频繁，请稍后重试"
          : result.error === "subscriptionRequired"
            ? "Muse 尚未返回有效订阅与额度，可能仍在等待名单"
          : `Muse ${stage}失败`
      throw new QuotaQueryError(code, detail)
    }
    if (!result.flight || !result.actionID || !/^[0-9a-f]{40,64}$/.test(result.actionID)) {
      throw new QuotaQueryError("unreadableResponse", "Muse 订阅查询结果无效")
    }
    return {
      snapshot: parseFlight(result.flight, accountID, collectedAt),
      actionID: result.actionID,
    }
  } catch (error) {
    if (timedOut) throw new QuotaQueryError("network", `Muse WebView ${stage}超时`)
    if (error instanceof QuotaQueryError) throw error
    throw new QuotaQueryError("network", "Muse WebView 查询失败")
  } finally {
    clearTimeout(timeout)
    if (!existingWebView) webView.dispose()
  }
}
