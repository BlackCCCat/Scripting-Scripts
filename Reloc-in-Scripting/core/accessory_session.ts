import { Script } from "scripting";
import {
  DEFAULT_SERVICE_NAME,
  SHIM_SERVICE_NAME,
  STORAGE_KEYS,
} from "../constants";
import type {
  ConnectionCheckResult,
  ProtocolEvent,
  SessionConfiguration,
  SessionSnapshot,
  TargetLocation,
  TunnelSource,
} from "../types";
import { discoverPairingService } from "./bonjour";
import { readU32BE } from "./bytes";
import { debugLog, describeError } from "./debug";
import { IAP2Link, IAP2LinkError } from "./iap2_link";
import { IAP2Message, IAP2Parameter } from "./iap2_wire";
import type { MFiSigner } from "./mfi_signer";
import { CoordinateTransform, NMEAGenerator } from "./nmea";
import type { PairingRecord } from "./pairing";
import { performRsdCheckinOnStream } from "./rsd_plist";
import { PairVerifyRejected, RemotePairingClient, RpPairingSocket } from "./rppairing";
import { delay, withTimeout, type ByteStream } from "./stream";
import { connectTCP, probeTCP, probeTCPDetail } from "./tcp";

const PORT_RANGE_START = 49152;
const PORT_RANGE_END = 51200;
const PORT_SCAN_BATCH = 64;
const PORT_SCAN_TIMEOUT = 200;
const TUNNEL_OPEN_TIMEOUT_MS = 15_000;
const MAX_SCAN_HOSTS = 3;
const LOOPBACK_ONLY_MARK = "只绑在回环地址上";

interface PairingTarget {
  host: string;
  port: number;
}

export class LiveLocationBox {
  private current: TargetLocation;

  constructor(initial: TargetLocation) {
    this.current = { ...initial };
  }

  get(): TargetLocation {
    return this.current;
  }

  set(location: TargetLocation): void {
    this.current = { ...location };
  }
}

export function wrapTunnelConnection(connection: VPNRSDConnection): ByteStream {
  return {
    read: (max: number) => connection.read(max),
    write: (data: Uint8Array) => connection.write(data),
    close: () => connection.close(),
  };
}

function isLoopback(host: string): boolean {
  return host === "::1" || host.startsWith("127.");
}

function isNumericIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function formatRsdErrorDetails(error: unknown): string {
  const base = error instanceof Error ? error.message : String(error);
  if (!error || typeof error !== "object") return base;
  const e = error as Record<string, unknown>;
  const tags: string[] = [];
  if (typeof e.code === "string" && e.code) tags.push(`code=${e.code}`);
  if (typeof e.stage === "string" && e.stage) tags.push(`stage=${e.stage}`);
  if (typeof e.nativeDomain === "string" && e.nativeDomain) tags.push(`domain=${e.nativeDomain}`);
  if (e.nativeCode !== undefined) tags.push(`nativeCode=${String(e.nativeCode)}`);
  if (e.networkErrorCode !== undefined) tags.push(`netCode=${String(e.networkErrorCode)}`);
  return tags.length > 0 ? `${base} [${tags.join(", ")}]` : base;
}

function pushTarget(list: PairingTarget[], target: PairingTarget): void {
  if (!list.some((item) => item.host === target.host && item.port === target.port)) {
    list.push(target);
  }
}

async function readLocalDevState(): Promise<VPNLocalDevState> {
  try {
    return await VPN.localDevVPN.getState();
  } catch (error) {
    debugLog("vpn", "读自身隧道状态并发变更，重读一次", describeError(error));
    await delay(500);
    return VPN.localDevVPN.getState();
  }
}

async function tryReadLocalDevState(): Promise<VPNLocalDevState | null> {
  try {
    return await readLocalDevState();
  } catch {
    return null;
  }
}

let vpnStarting: Promise<VPNLocalDevState> | null = null;

async function ensureLocalDevVPN(): Promise<VPNLocalDevState> {
  if (vpnStarting) return vpnStarting;
  vpnStarting = startLocalDevVPN().finally(() => {
    vpnStarting = null;
  });
  return vpnStarting;
}

async function startLocalDevVPN(): Promise<VPNLocalDevState> {
  let state = await readLocalDevState();
  if (state.effectiveStatus === "active") return state;
  if (state.effectiveStatus === "unavailable") {
    throw new Error("本机隧道不可用。请确认 Scripting 已获得 VPN 权限，且没有其他 VPN 占着名额。");
  }
  if (!state.enabled) {
    state = await VPN.localDevVPN.setEnabled(true, { expectedState: state.expectedState });
  }
  if (state.vpnStatus !== "connected") {
    await VPN.start();
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(500);
    const polled = await tryReadLocalDevState();
    if (!polled) continue;
    state = polled;
    if (state.effectiveStatus === "active") return state;
  }
  throw new Error("Scripting 本机隧道未能生效，请先断开其他代理 VPN 后重试。");
}

async function ensureTunnelEnvironment(source: TunnelSource, host: string, silent = false): Promise<void> {
  if (typeof VPN === "undefined" || !VPN.localDevVPN) {
    throw new Error("当前 Scripting 版本不支持 VPN.localDevVPN 接口。");
  }
  const granted = await Script.requestAccess(["localDevVPN"]);
  if (!granted.includes("localDevVPN")) {
    throw new Error("缺少「本机开发者隧道 (localDevVPN)」权限，请在 Scripting 设置中允许。");
  }

  if (source === "builtIn") {
    const vpnGranted = await Script.requestAccess(["vpn"]);
    if (!vpnGranted.includes("vpn")) {
      throw new Error("缺少「VPN」权限，无法启动 Scripting 内置隧道。");
    }
    if (silent) {
      const state = await tryReadLocalDevState();
      if (state?.effectiveStatus !== "active") {
        throw new Error("Scripting 自身 VPN 尚未启用");
      }
      return;
    }
    await ensureLocalDevVPN();
    return;
  }

  if (source === "proxyApp") {
    const state = await tryReadLocalDevState();
    if (state?.vpnStatus === "connected") {
      debugLog("vpn", "proxyApp 模式下 Scripting 自身 VPN 仍在连接，可能占用外部代理名额");
    }
    if (!silent && state && !state.enabled) {
      await VPN.localDevVPN.setEnabled(true, { expectedState: state.expectedState }).catch(() => undefined);
    }
    if (!silent) {
      const probe = await probeTCPDetail(host, PORT_RANGE_START, 600);
      debugLog("vpn", `${host}:${PORT_RANGE_START} 探测：${probe.open ? "可达" : probe.code ?? "失败"}`);
    }
  }
}

async function candidateTargets(
  host: string,
  preferredPort: number,
  record: PairingRecord,
): Promise<{ targets: PairingTarget[]; announcedAddresses: string[] }> {
  const targets: PairingTarget[] = [];
  let announcedAddresses: string[] = [];
  const cached = Storage.get<PairingTarget>(STORAGE_KEYS.pairingCacheTarget);
  if (
    cached &&
    typeof cached.host === "string" &&
    isNumericIPv4(cached.host) &&
    !isLoopback(cached.host) &&
    Number(cached.port) > 0
  ) {
    pushTarget(targets, { host: cached.host, port: Number(cached.port) });
  }

  if (record.altIrk.length === 16) {
    try {
      const announced = await discoverPairingService(record.altIrk);
      if (announced !== null) {
        announcedAddresses = announced.addresses;
        debugLog("scan", `Bonjour 发现端口 ${announced.port}，地址 ${announced.addresses.join(", ") || "无"}`);
        pushTarget(targets, { host, port: announced.port });
        for (const addr of announced.addresses) {
          // openRSDTunnel 仅接受数值 IPv4，非 IPv4 / 回环地址不能作为隧道建连目标
          if (isNumericIPv4(addr) && !isLoopback(addr)) {
            pushTarget(targets, { host: addr, port: announced.port });
          }
        }
      }
    } catch (error) {
      debugLog("scan", "Bonjour 发现失败，退回端口扫描", describeError(error));
    }
  }

  if (preferredPort > 0) {
    pushTarget(targets, { host, port: preferredPort });
  }
  return { targets, announcedAddresses };
}

async function scanPorts(host: string, skip: number[]): Promise<number[]> {
  const ports: number[] = [];
  for (let base = PORT_RANGE_START; base <= PORT_RANGE_END; base += PORT_SCAN_BATCH) {
    const batch: Promise<number | null>[] = [];
    for (let port = base; port < base + PORT_SCAN_BATCH && port <= PORT_RANGE_END; port++) {
      if (skip.includes(port) || ports.includes(port)) continue;
      batch.push(probeTCP(host, port, PORT_SCAN_TIMEOUT).then((open) => (open ? port : null)));
    }
    for (const port of await Promise.all(batch)) {
      if (port !== null) ports.push(port);
    }
  }
  return ports;
}

async function tryTargets(targets: PairingTarget[]): Promise<{
  session: { stream: ByteStream; client: RemotePairingClient; host: string; port: number } | null;
  lastError: unknown;
}> {
  let lastError: unknown = null;
  for (const target of targets) {
    let stream: ByteStream | null = null;
    try {
      stream = await connectTCP(target.host, target.port, 4000);
      const client = new RemotePairingClient(new RpPairingSocket(stream));
      await withTimeout(client.attemptPairVerify(), 6000, `${target.host}:${target.port} 握手超时`);
      Storage.set(STORAGE_KEYS.pairingCacheTarget, target);
      return { session: { stream, client, host: target.host, port: target.port }, lastError: null };
    } catch (error) {
      lastError = error;
      if (stream) await stream.close().catch(() => undefined);
    }
  }
  return { session: null, lastError };
}

function loopbackOnlyFailure(host: string, source: TunnelSource): string {
  const base =
    `配对服务这会儿${LOOPBACK_ONLY_MARK}，没绑任何网络接口。\n\n` +
    "用蜂窝数据时就是这样：控制中心开一次飞行模式，等几秒再关掉，再回来重试。\n";
  return source === "proxyApp"
    ? base + `请确认外部代理已开启 ${host} 回环映射；实在不行改连 WiFi。`
    : base + "实在不行改连 WiFi。";
}

function describePairingFailure(host: string, source: TunnelSource, tried: number, error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = error instanceof Error ? error.message : String(error);

  if (code === "ECONNREFUSED") {
    return (
      `无法连接回环地址 ${host}（连接被拒绝）。\n` +
      (source === "proxyApp"
        ? "请确认外部代理已开启 10.7.0.1 回环模块；若正在用蜂窝数据，请开关一次飞行模式后重试。"
        : "若正在用蜂窝数据，请开关一次飞行模式后重试。")
    );
  }
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH") {
    return `连不到 ${host}，路由不存在（请检查是否开启了飞行模式或代理未运行）。`;
  }
  if (message.includes("握手超时")) {
    return `端口可达但 Remote Pairing 握手超时（若使用蜂窝数据，请开关一次飞行模式再试）。`;
  }
  if (code === "ETIMEDOUT" || message.includes("超时")) {
    return source === "proxyApp"
      ? `连接 ${host} 超时——请确认外部代理已启用 10.7.0.1 回环模块。`
      : `连接 ${host} 超时——本机隧道可能尚未就绪。`;
  }
  return `尝试 ${tried} 个端口均未能完成 Remote Pairing 握手：${message}`;
}

export function isCellularGuideCandidate(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code === "ECONNREFUSED" || code === "ENETUNREACH" || code === "EHOSTUNREACH") return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(LOOPBACK_ONLY_MARK) ||
    message.includes("没有开放端口") ||
    message.includes("连接被拒绝") ||
    message.includes("拒绝了连接") ||
    message.includes("路由不存在") ||
    message.includes("握手超时")
  );
}

async function openRsdTunnelWithRecord(
  host: string,
  preferredPort: number,
  source: TunnelSource,
  record: PairingRecord,
  silent = false,
): Promise<{ tunnel: VPNRSDTunnel; pairingStream: ByteStream; port: number }> {
  await ensureTunnelEnvironment(source, host, silent);

  const { targets: first, announcedAddresses } = await candidateTargets(host, preferredPort, record);
  let found = await tryTargets(first);

  if (!found.session) {
    Storage.remove(STORAGE_KEYS.pairingCacheTarget);
    if (announcedAddresses.length > 0 && announcedAddresses.every((addr) => isLoopback(addr))) {
      throw new Error(loopbackOnlyFailure(host, source));
    }
    if (silent) {
      throw new Error(describePairingFailure(host, source, first.length, found.lastError ?? new Error("回环端口未就绪")));
    }

    const hosts: string[] = [];
    for (const t of first) {
      if (!isLoopback(t.host) && !hosts.includes(t.host) && hosts.length < MAX_SCAN_HOSTS) {
        hosts.push(t.host);
      }
    }
    if (hosts.length === 0) hosts.push(host);

    let tried = first.length;
    let lastError = found.lastError;
    let anyOpen = false;
    for (const h of hosts) {
      const skip = first.filter((t) => t.host === h).map((t) => t.port);
      const ports = await scanPorts(h, skip);
      if (ports.length === 0) continue;
      anyOpen = true;
      tried += ports.length;
      const attempt = await tryTargets(ports.map((p) => ({ host: h, port: p })));
      if (attempt.session) {
        found = attempt;
        break;
      }
      lastError = attempt.lastError;
    }

    if (!found.session) {
      if (!anyOpen) {
        throw new Error(
          `${hosts.join("、")} 的 ${PORT_RANGE_START}-${PORT_RANGE_END} 没有开放端口。请确认外部代理已开启 10.7.0.1 回环、开发者模式已打开；若使用蜂窝数据请开关一次飞行模式。`,
        );
      }
      throw new Error(describePairingFailure(host, source, tried, lastError));
    }
  }

  const pairing = found.session;
  try {
    await withTimeout(pairing.client.validatePairing(record), 20_000, "pair-verify 超时");
    const tunnelPort = await withTimeout(
      pairing.client.createTcpListener({ peerConnectionsInfo: false }),
      15_000,
      "申请隧道端口超时",
    );
    const psk = pairing.client.preSharedKey;

    if (!isNumericIPv4(pairing.host) || isLoopback(pairing.host)) {
      throw new Error(`配对地址 ${pairing.host} 不是有效的 IPv4 回环反射地址，请检查代理或隧道配置`);
    }

    let tunnel: VPNRSDTunnel;
    try {
      debugLog("tunnel", `openRSDTunnel host=${pairing.host} port=${tunnelPort} psk=${psk.length}B`);
      tunnel = await VPN.localDevVPN.openRSDTunnel({
        host: pairing.host,
        port: tunnelPort,
        preSharedKey: psk,
        timeout: TUNNEL_OPEN_TIMEOUT_MS,
      });
    } catch (error) {
      await VPN.localDevVPN.cancelRSDTunnelOpening().catch(() => undefined);
      const vpnState = await tryReadLocalDevState();
      debugLog(
        "tunnel",
        `openRSDTunnel 失败 host=${pairing.host} port=${tunnelPort} source=${source} localDev=${JSON.stringify(vpnState)}`,
        formatRsdErrorDetails(error),
      );

      // 若同一 Scripting 进程中已有共享 RSD 隧道（例如 Loopback 已开启），尝试直接附着复用
      if (typeof VPN.localDevVPN.attachRSDTunnel === "function") {
        const shared = await VPN.localDevVPN.attachRSDTunnel().catch(() => null);
        if (shared) {
          debugLog("tunnel", "检测到已有共享 RSD 隧道，已自动附着复用");
          await pairing.stream.close().catch(() => undefined);
          return { tunnel: shared, pairingStream: pairing.stream, port: pairing.port };
        }
      }

      const detail = formatRsdErrorDetails(error);
      throw new Error(
        `建立 RSD 隧道失败 (${pairing.host}:${tunnelPort}, 来源=${source}): ${detail}` +
          (source === "proxyApp"
            ? "。请确认外部代理已连接并映射 10.7.0.1（且 Scripting 自身 VPN 已关闭），或尝试切换为「Scripting 内置本机隧道」。"
            : ""),
      );
    }

    return { tunnel, pairingStream: pairing.stream, port: pairing.port };
  } catch (error) {
    await pairing.stream.close().catch(() => undefined);
    if (error instanceof PairVerifyRejected) {
      throw new Error("配对记录校验未通过，请重新配对这台 iPhone。");
    }
    throw error;
  }
}

async function openCarKitServiceStream(
  tunnel: VPNRSDTunnel,
  preferredService: string,
): Promise<{ stream: ByteStream; serviceName: string; servicePort: number }> {
  const services = await tunnel.listServices({ refresh: true, timeout: 15_000 });
  const candidates = [preferredService.trim(), SHIM_SERVICE_NAME, DEFAULT_SERVICE_NAME].filter(
    (item, index, arr) => item.length > 0 && arr.indexOf(item) === index,
  );

  let chosen: VPNRSDService | undefined;
  for (const name of candidates) {
    const found = services.find((svc) => svc.name === name);
    if (found) {
      chosen = found;
      break;
    }
  }

  if (chosen) {
    const conn = await tunnel.connect({ port: chosen.port, timeout: 10_000 });
    const byteStream = wrapTunnelConnection(conn);
    if (chosen.name.endsWith(".shim.remote")) {
      try {
        await performRsdCheckinOnStream(byteStream, "Reloc", 10_000);
      } catch (error) {
        await byteStream.close().catch(() => undefined);
        throw error;
      }
    }
    return { stream: byteStream, serviceName: chosen.name, servicePort: chosen.port };
  }

  // Fallback: 通过 trusted lockdown 启动 CarKit 服务
  const lockdownSvc = services.find((svc) => svc.name === "com.apple.mobile.lockdown.remote.trusted");
  if (!lockdownSvc) {
    throw new Error("RSD 服务目录未公布 CarKit 服务（com.apple.carkit.service）。请确认已开启开发者模式。");
  }

  const target = preferredService.trim() || DEFAULT_SERVICE_NAME;
  const session = await DeviceServices.openRSDSession(tunnel);
  try {
    const svc = await session.openService({
      serviceName: lockdownSvc.name,
      label: "Reloc",
      timeout: 10_000,
    });
    await svc.connection.writePlist({
      Label: "Reloc",
      Request: "StartService",
      Service: target,
    });
    const resp = await svc.connection.readPlist({ timeout: 10_000 }) as Record<string, unknown> | null;
    if (!resp || resp.Error) {
      throw new Error(`无法启动 CarKit 服务 ${target}：${String(resp?.Error ?? "无响应")}`);
    }
    const port = Number(resp.Port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`StartService(${target}) 返回了无效端口`);
    }
    const conn = await tunnel.connect({ port, timeout: 10_000 });
    return { stream: wrapTunnelConnection(conn), serviceName: target, servicePort: port };
  } finally {
    await session.close().catch(() => undefined);
  }
}

export async function verifyDeviceConnection(options: {
  host: string;
  remotePort: number;
  tunnelSource: TunnelSource;
  pairing: PairingRecord | null;
  silent?: boolean;
}): Promise<ConnectionCheckResult> {
  let tunnel: VPNRSDTunnel | null = null;
  let pairingStream: ByteStream | null = null;
  let port = options.remotePort;

  try {
    if (!options.pairing) {
      throw new Error("请先配对这台 iPhone 或导入配对文件");
    }
    const opened = await openRsdTunnelWithRecord(
      options.host,
      options.remotePort,
      options.tunnelSource,
      options.pairing,
      Boolean(options.silent),
    );
    tunnel = opened.tunnel;
    pairingStream = opened.pairingStream;
    port = opened.port;

    const services = await tunnel.listServices({ refresh: true, timeout: 15_000 });
    const carkitService =
      services.find((s) => s.name === SHIM_SERVICE_NAME)?.name ??
      services.find((s) => s.name === DEFAULT_SERVICE_NAME)?.name ??
      services.find((s) => s.name.includes("carkit"))?.name ??
      null;

    let udid = options.pairing?.deviceUDID ?? "";
    const lockdownSvc = services.find((s) => s.name === "com.apple.mobile.lockdown.remote.trusted");
    if (lockdownSvc) {
      try {
        const session = await DeviceServices.openRSDSession(tunnel);
        try {
          const ld = await session.openService({
            serviceName: lockdownSvc.name,
            label: "Reloc",
            timeout: 8000,
          });
          await ld.connection.writePlist({
            Label: "Reloc",
            Request: "GetValue",
            Key: "UniqueDeviceID",
          });
          const resp = await ld.connection.readPlist({ timeout: 8000 }) as Record<string, unknown> | null;
          if (typeof resp?.Value === "string" && resp.Value.length > 0) {
            udid = resp.Value;
          }
        } finally {
          await session.close().catch(() => undefined);
        }
      } catch {
        // UDID 读取失败不影响连通性结论
      }
    }

    return {
      udid,
      port,
      carkitService,
      servicesCount: services.length,
    };
  } finally {
    await tunnel?.close().catch(() => undefined);
    await pairingStream?.close().catch(() => undefined);
  }
}

type SocketRunOutcome =
  | { kind: "completed"; packetCount: number }
  | { kind: "reconnectRequested"; reason: string; packetCount: number }
  | { kind: "recoverableError"; error: string; didSendPackets: boolean; packetCount: number }
  | { kind: "fatalError"; error: string };

export class AccessoryLocationSession {
  readonly locationBox: LiveLocationBox;
  private cancelled = false;
  private fastBurstUntil = 0;
  private pendingKalmanReset = false;
  private burstMotionPacketsRemaining = 0;
  private pendingReconnectReason: string | null = null;
  private fallbackRealLocation: TargetLocation | null = null;
  private activeLink: IAP2Link | null = null;
  private activeTunnel: VPNRSDTunnel | null = null;
  private activePairingStream: ByteStream | null = null;
  private activeRunPromise: Promise<void> | null = null;

  constructor(
    initialLocation: TargetLocation,
    private readonly onEvent: (event: ProtocolEvent) => void,
    private readonly onSnapshot: (snapshot: SessionSnapshot) => void,
    private readonly onSubscriptionRestarted?: () => void,
    private readonly onUnrecoverableGuide?: (error: unknown) => void,
    private readonly onAuthenticated?: () => void,
    private readonly onLocationRequested?: () => void,
    private readonly onLocationStopped?: () => void,
  ) {
    this.locationBox = new LiveLocationBox(initialLocation);
  }

  /**
   * 触发临时高频注入突发（5 Hz / 200ms），帮助 locationd 在刚订阅或切换点位时迅速锁定外设 GPS（对齐上游 triggerFastBurst）。
   */
  triggerFastBurst(seconds = 15.0): void {
    const until = Date.now() + Math.max(0, seconds) * 1000;
    this.fastBurstUntil = Math.max(this.fastBurstUntil, until);
  }

  /**
   * 运行中更新目标坐标时触发 Kalman 复位脉冲（先发 void 清除旧点惯性 + 短暂 0.4kn 微速 + 5 Hz 突发），对齐上游 notifyLocationUpdated。
   */
  notifyLocationUpdated(resetKalman = true, burstSeconds = 10.0): void {
    if (resetKalman) {
      this.pendingKalmanReset = true;
      this.burstMotionPacketsRemaining = Math.max(this.burstMotionPacketsRemaining, 2);
    }
    this.triggerFastBurst(burstSeconds);
  }

  /**
   * 记录停止前最近一次确认的本机真实位置，停止时用于下发高误差 (HDOP=35.0) 劣化报文促使室内 Wi-Fi 立刻接管（同步上游 v1.0.2）。
   */
  setFallbackRealLocation(location: TargetLocation | null): void {
    this.fallbackRealLocation = location ? { ...location } : null;
  }

  /**
   * 若 0xAA05 后迟迟未等到 0xFFFA，请求主动重置并快速重建一次 iAP2 链路清理卡住的 iap2d 状态（对齐上游 requestLinkReconnect）。
   */
  requestLinkReconnect(reason: string): void {
    this.pendingReconnectReason = reason;
  }

  start(options: {
    configuration: SessionConfiguration;
    pairing: PairingRecord | null;
    discoveredRemotePort?: number;
    mfiSigner: MFiSigner;
  }): void {
    this.cancelled = false;
    this.fastBurstUntil = 0;
    this.pendingKalmanReset = false;
    this.burstMotionPacketsRemaining = 0;
    this.pendingReconnectReason = null;
    this.activeRunPromise = this.runLoop(options).finally(() => {
      this.activeRunPromise = null;
    });
  }

  async stop(): Promise<void> {
    this.cancelled = true;
    if (this.activeLink && this.activeRunPromise) {
      await Promise.race([this.activeRunPromise, delay(900)]);
    }
    await this.activeLink?.close().catch(() => undefined);
    await this.activeTunnel?.close().catch(() => undefined);
    await this.activePairingStream?.close().catch(() => undefined);
  }

  private emitEvent(name: string, details: Record<string, unknown> = {}, isError = false): void {
    const payload = { ...details, event: name };
    let detail = "";
    try {
      detail = JSON.stringify(payload);
    } catch {
      detail = JSON.stringify({ event: name });
    }
    debugLog(isError ? "err" : "proto", `${name} ${detail}`);
    this.onEvent({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      name,
      detail,
      isError,
    });
  }

  private static isFatalPairingError(message: string): boolean {
    return (
      message.includes("配对记录校验未通过") ||
      message.includes("公私钥不匹配") ||
      message.includes("尚未配置") ||
      message.includes("缺少「")
    );
  }

  private async sleepCancellable(ms: number, deadlineMs: number | null): Promise<void> {
    const targetEnd = Date.now() + ms;
    while (!this.cancelled) {
      const now = Date.now();
      if (now >= targetEnd) return;
      if (deadlineMs !== null && now >= deadlineMs) return;
      await delay(Math.min(150, targetEnd - now));
    }
  }

  private async runLoop(options: {
    configuration: SessionConfiguration;
    pairing: PairingRecord | null;
    discoveredRemotePort?: number;
    mfiSigner: MFiSigner;
  }): Promise<void> {
    const { configuration, pairing, mfiSigner } = options;
    const overallDeadline = configuration.durationSeconds > 0
      ? Date.now() + configuration.durationSeconds * 1000
      : null;

    let snapshot: SessionSnapshot = {
      isRunning: true,
      mode: configuration.mode,
      lockdownConnected: false,
      linkReady: false,
      identified: false,
      authenticated: false,
      activeSentences: [],
      packetsAcknowledged: 0,
      lastError: null,
    };
    this.onSnapshot({ ...snapshot });

    let currentPort = options.discoveredRemotePort ?? configuration.remotePort;
    let reconnectAttempt = 0;
    let cumulativePackets = 0;

    while (!this.cancelled) {
      if (overallDeadline !== null && Date.now() >= overallDeadline) break;

      this.emitEvent("rppairing_connecting", {
        source: configuration.tunnelSource,
        host: configuration.host,
        port: currentPort,
        attempt: reconnectAttempt + 1,
      });

      let tunnel: VPNRSDTunnel | null = null;
      let pairingStream: ByteStream | null = null;

      try {
        if (!pairing) {
          throw new Error("尚未配置设备配对记录");
        }
        const opened = await openRsdTunnelWithRecord(
          configuration.host,
          currentPort,
          configuration.tunnelSource,
          pairing,
        );
        tunnel = opened.tunnel;
        pairingStream = opened.pairingStream;
        currentPort = opened.port;

        if (this.cancelled) {
          await tunnel.close().catch(() => undefined);
          await pairingStream?.close().catch(() => undefined);
          break;
        }

        const service = await openCarKitServiceStream(tunnel, configuration.serviceName);
        this.activeTunnel = tunnel;
        this.activePairingStream = pairingStream;

        this.emitEvent("rppairing_service_connected", {
          service: service.serviceName,
          service_port: service.servicePort,
          rp_port: currentPort,
        });

        const attemptSnapshot: SessionSnapshot = {
          isRunning: true,
          mode: configuration.mode,
          lockdownConnected: true,
          linkReady: false,
          identified: false,
          authenticated: false,
          activeSentences: [],
          packetsAcknowledged: cumulativePackets,
          lastError: null,
        };
        this.onSnapshot({ ...attemptSnapshot });

        const outcome = await this.runOnStream({
          stream: service.stream,
          configuration,
          mfiSigner,
          initialSnapshot: attemptSnapshot,
          overallDeadline,
          keepRunningOnExit: configuration.mode === "send",
        });

        await tunnel.close().catch(() => undefined);
        await pairingStream?.close().catch(() => undefined);
        this.activeTunnel = null;
        this.activePairingStream = null;

        if (outcome.kind === "completed") {
          cumulativePackets = outcome.packetCount;
          snapshot = {
            ...attemptSnapshot,
            packetsAcknowledged: cumulativePackets,
            isRunning: false,
          };
          this.onSnapshot(snapshot);
          return;
        }

        if (outcome.kind === "fatalError") {
          snapshot = {
            ...attemptSnapshot,
            lastError: outcome.error,
            isRunning: false,
          };
          this.onSnapshot(snapshot);
          return;
        }

        cumulativePackets = outcome.packetCount;
        if (configuration.mode !== "send" || this.cancelled) {
          snapshot.lastError = this.cancelled ? null : outcome.kind === "recoverableError" ? outcome.error : null;
          break;
        }
        if (overallDeadline !== null && Date.now() >= overallDeadline) break;

        if (outcome.kind === "reconnectRequested") {
          reconnectAttempt = 0;
          snapshot = {
            isRunning: true,
            mode: configuration.mode,
            lockdownConnected: false,
            linkReady: false,
            identified: false,
            authenticated: false,
            activeSentences: [],
            packetsAcknowledged: cumulativePackets,
            lastError: null,
          };
          this.onSnapshot({ ...snapshot });
          this.emitEvent("reconnecting", { attempt: 1, delay_s: 0.35, reason: outcome.reason });
          await this.sleepCancellable(350, overallDeadline);
          continue;
        }

        if (outcome.didSendPackets) reconnectAttempt = 0;
        reconnectAttempt += 1;
        const delaySec = Math.min(5.0, Math.pow(1.5, reconnectAttempt - 1));
        snapshot = {
          isRunning: true,
          mode: configuration.mode,
          lockdownConnected: false,
          linkReady: false,
          identified: false,
          authenticated: false,
          activeSentences: [],
          packetsAcknowledged: cumulativePackets,
          lastError: `连接断开，${delaySec.toFixed(1)} 秒后自动重连（第 ${reconnectAttempt} 次）`,
        };
        this.onSnapshot({ ...snapshot });
        this.emitEvent("reconnecting", { attempt: reconnectAttempt, delay_s: delaySec, reason: outcome.error }, true);
        await this.sleepCancellable(delaySec * 1000, overallDeadline);
      } catch (error) {
        await tunnel?.close().catch(() => undefined);
        await pairingStream?.close().catch(() => undefined);
        this.activeTunnel = null;
        this.activePairingStream = null;

        if (this.cancelled) break;
        const errText = error instanceof Error ? error.message : String(error);

        if (reconnectAttempt === 0 && isCellularGuideCandidate(error)) {
          this.onUnrecoverableGuide?.(error);
        }

        if (
          configuration.mode !== "send" ||
          AccessoryLocationSession.isFatalPairingError(errText)
        ) {
          snapshot.lastError = errText;
          this.emitEvent("error", { detail: errText }, true);
          break;
        }

        if (cumulativePackets > 0 && isCellularGuideCandidate(error) && reconnectAttempt >= 6) {
          const stoppedNotice = `定位已注入（ACK ${cumulativePackets}），蜂窝切网后通道暂不可达；若需继续改点请再开关一次飞行模式`;
          snapshot.lastError = stoppedNotice;
          this.emitEvent("error", { detail: stoppedNotice }, true);
          break;
        }

        reconnectAttempt += 1;
        const delaySec = isCellularGuideCandidate(error)
          ? 1.5
          : Math.min(5.0, Math.pow(1.5, reconnectAttempt - 1));
        snapshot = {
          isRunning: true,
          mode: configuration.mode,
          lockdownConnected: false,
          linkReady: false,
          identified: false,
          authenticated: false,
          activeSentences: [],
          packetsAcknowledged: cumulativePackets,
          lastError: `通道中断，${delaySec.toFixed(1)} 秒后自动重连（第 ${reconnectAttempt} 次）`,
        };
        this.onSnapshot({ ...snapshot });
        this.emitEvent("reconnecting", { attempt: reconnectAttempt, delay_s: delaySec, reason: errText }, true);
        await this.sleepCancellable(delaySec * 1000, overallDeadline);
      }
    }

    this.onSnapshot({
      ...snapshot,
      packetsAcknowledged: cumulativePackets,
      isRunning: false,
    });
  }

  private async runOnStream(options: {
    stream: ByteStream;
    configuration: SessionConfiguration;
    mfiSigner: MFiSigner;
    initialSnapshot: SessionSnapshot;
    overallDeadline: number | null;
    keepRunningOnExit: boolean;
  }): Promise<SocketRunOutcome> {
    const { stream, configuration, mfiSigner, initialSnapshot, overallDeadline, keepRunningOnExit } = options;
    const snapshot: SessionSnapshot = { ...initialSnapshot, isRunning: true, mode: configuration.mode };
    const initialPacketCount = snapshot.packetsAcknowledged;
    this.onSnapshot({ ...snapshot });

    const link = new IAP2Link(stream, (event, details) => this.emitEvent(event, details));
    this.activeLink = link;

    try {
      await link.handshake();
      snapshot.linkReady = true;
      this.onSnapshot({ ...snapshot });

      const startTime = Date.now();
      const deadline = overallDeadline ?? (
        configuration.durationSeconds > 0
          ? startTime + configuration.durationSeconds * 1000
          : null
      );

      let activeSentences = new Set<number>();
      const lastSent = new Map<number, number>();
      const minIntervalsMs = new Map<number, number>();
      let sawLocationStopped = false;

      while (!this.cancelled) {
        if (this.pendingReconnectReason) {
          const reason = this.pendingReconnectReason;
          this.pendingReconnectReason = null;
          if (snapshot.authenticated) {
            if (activeSentences.size > 0) {
              const voidMap = NMEAGenerator.voidLocationSentences();
              const voidOutgoing = [...activeSentences]
                .sort((a, b) => a - b)
                .map((id) => voidMap[id])
                .filter((s): s is string => typeof s === "string");
              if (voidOutgoing.length > 0) {
                await link.sendBestEffort(NMEAGenerator.locationMessage(voidOutgoing), 200);
              }
            }
            await link.sendReset();
            this.emitEvent("iap2_link_reset_sent", { reason });
            await delay(50);
          }
          return {
            kind: "reconnectRequested",
            reason,
            packetCount: snapshot.packetsAcknowledged,
          };
        }

        const now = Date.now();
        if (deadline !== null && now >= deadline) break;

        let pollSliceMs = 1000;
        if (
          configuration.mode === "send" &&
          snapshot.identified &&
          snapshot.authenticated &&
          activeSentences.size > 0
        ) {
          if (this.pendingKalmanReset) {
            pollSliceMs = 15;
          } else {
            const burstActive = now < this.fastBurstUntil;
            let nextDue = now + 1000;
            for (const id of activeSentences) {
              const last = lastSent.get(id);
              const requiredMs = burstActive
                ? 200
                : Math.max(configuration.intervalSeconds * 1000, minIntervalsMs.get(id) ?? 250);
              const candidate = last !== undefined ? last + requiredMs : now;
              if (candidate < nextDue) nextDue = candidate;
            }
            pollSliceMs = Math.min(pollSliceMs, Math.max(20, nextDue - now));
          }
        }
        if (deadline !== null) {
          pollSliceMs = Math.min(pollSliceMs, Math.max(25, deadline - now));
        }

        const message = await link.receive(pollSliceMs);
        if (message) {
          const fields = IAP2Parameter.parseParameters(message.body);
          this.emitEvent("message", {
            identifier: `0x${message.identifier.toString(16).padStart(4, "0")}`,
            parameters: fields.map((f) => ({ id: f.identifier, bytes: f.data.length })),
          });

          switch (message.identifier) {
            case 0x1d00: {
              const idMsg = NMEAGenerator.identificationMessage();
              await link.send(idMsg);
              break;
            }
            case 0x1d02: {
              snapshot.identified = true;
              this.onSnapshot({ ...snapshot });
              this.emitEvent("identification_accepted");
              break;
            }
            case 0x1d03: {
              const rejectedIds = fields.map((f) => f.identifier);
              throw new IAP2LinkError("protocol", `Identification rejected: [${rejectedIds.join(", ")}]`);
            }
            case 0xaa00: {
              const certBody = IAP2Parameter.encode(0, mfiSigner.certificateContainerData);
              this.emitEvent("auth_cert_sent", {
                bytes: mfiSigner.certificateContainerData.length,
                cert_count: mfiSigner.certificateCount,
                leaf: mfiSigner.leafSubjectSummary,
              });
              await link.send(new IAP2Message(0xaa01, certBody));
              break;
            }
            case 0xaa02: {
              const challenges = fields.filter((f) => f.identifier === 0).map((f) => f.data);
              if (challenges.length !== 1) {
                throw new IAP2LinkError("protocol", "Invalid authentication challenge parameters");
              }
              const signature = mfiSigner.signChallenge(challenges[0]);
              const selfVerified = mfiSigner.verifyRawSignature(signature, challenges[0]);
              this.emitEvent("auth_challenge_signed", {
                challenge_bytes: challenges[0].length,
                signature_bytes: signature.length,
                self_verified: selfVerified,
              });
              if (!selfVerified) {
                throw new IAP2LinkError("protocol", "Local MFi signature self-verification failed before 0xAA03");
              }
              const sigBody = IAP2Parameter.encode(0, signature);
              await link.send(new IAP2Message(0xaa03, sigBody));
              break;
            }
            case 0xaa05: {
              snapshot.authenticated = true;
              snapshot.lastError = null;
              this.onSnapshot({ ...snapshot });
              this.emitEvent("authentication_succeeded");
              this.onAuthenticated?.();
              break;
            }
            case 0xaa04: {
              throw new IAP2LinkError(
                "protocol",
                `Accessory authentication failed (0xAA04)：iOS iap2d 拒绝了 MFi 证书或签名（${mfiSigner.leafSubjectSummary}, ${mfiSigner.certificateContainerData.length}B）`,
              );
            }
            case 0xfffa: {
              activeSentences = new Set(
                fields
                  .filter((f) => f.identifier === 1 || f.identifier === 2)
                  .map((f) => f.identifier),
              );
              minIntervalsMs.clear();
              const minIntervalsLog: Record<string, number> = {};
              for (const field of fields) {
                if ((field.identifier === 0x8001 || field.identifier === 0x8002) && field.data.length === 4) {
                  const ms = readU32BE(field.data, 0);
                  const sid = field.identifier - 0x8000;
                  minIntervalsMs.set(sid, Math.max(200, ms));
                  minIntervalsLog[String(sid)] = ms;
                }
              }
              lastSent.clear();
              this.triggerFastBurst(15.0);
              snapshot.activeSentences = [...activeSentences].sort((a, b) => a - b);
              this.onSnapshot({ ...snapshot });
              this.emitEvent("location_requested", {
                sentences: snapshot.activeSentences,
                min_intervals_ms: minIntervalsLog,
              });
              this.onLocationRequested?.();
              if (sawLocationStopped) {
                sawLocationStopped = false;
                this.onSubscriptionRestarted?.();
              }
              break;
            }
            case 0xfffc: {
              sawLocationStopped = true;
              activeSentences.clear();
              snapshot.activeSentences = [];
              this.onSnapshot({ ...snapshot });
              this.emitEvent("location_stopped");
              this.onLocationStopped?.();
              break;
            }
            default:
              break;
          }
        }

        if (
          configuration.mode === "send" &&
          snapshot.identified &&
          snapshot.authenticated &&
          activeSentences.size > 0 &&
          !this.cancelled
        ) {
          if (this.pendingKalmanReset) {
            this.pendingKalmanReset = false;
            lastSent.clear();
            const voidMap = NMEAGenerator.voidLocationSentences();
            const voidOutgoing = [...activeSentences]
              .sort((a, b) => a - b)
              .map((id) => voidMap[id])
              .filter((s): s is string => typeof s === "string");
            if (voidOutgoing.length > 0) {
              await link.send(NMEAGenerator.locationMessage(voidOutgoing)).catch(() => undefined);
              this.emitEvent("kalman_reset_void_sent");
              await delay(50);
            }
          }

          const tickNow = Date.now();
          const burstActive = tickNow < this.fastBurstUntil;
          const due = [...activeSentences]
            .sort((a, b) => a - b)
            .filter((id) => {
              const last = lastSent.get(id);
              const requiredMs = burstActive
                ? 200
                : Math.max(configuration.intervalSeconds * 1000, minIntervalsMs.get(id) ?? 250);
              return last === undefined || tickNow - last >= requiredMs;
            });

          if (due.length > 0) {
            const baseTarget = this.locationBox.get();
            let outgoingTarget = configuration.microJitterEnabled
              ? CoordinateTransform.applyMicroJitter(baseTarget, 0.6)
              : { ...baseTarget };
            if (this.burstMotionPacketsRemaining > 0) {
              this.burstMotionPacketsRemaining -= 1;
              if (outgoingTarget.speedKnots === 0) {
                outgoingTarget = { ...outgoingTarget, speedKnots: 0.4 };
              }
            }
            const sentenceMap = NMEAGenerator.locationSentences(outgoingTarget, new Date(), {
              hdop: 0.5,
              fixQuality: 2,
            });
            const outgoing = due.map((id) => sentenceMap[id]).filter((s): s is string => typeof s === "string");
            const locMsg = NMEAGenerator.locationMessage(outgoing);
            await link.send(locMsg);

            for (const id of due) lastSent.set(id, tickNow);
            snapshot.packetsAcknowledged += 1;
            snapshot.lastError = null;
            this.onSnapshot({ ...snapshot });

            if (snapshot.packetsAcknowledged === 1 || snapshot.packetsAcknowledged % 10 === 0) {
              this.emitEvent("location_link_acknowledged", {
                count: snapshot.packetsAcknowledged,
                lat: outgoingTarget.latitude.toFixed(6),
                lon: outgoingTarget.longitude.toFixed(6),
                nmea: outgoing.map((item) => item.trim()),
              });
            }
          }
        }
      }

      if (this.cancelled && snapshot.authenticated) {
        // 停止三步柔和退位（同步上游 v1.0.2）：
        // 1) 向真实回落坐标发送高误差 (HDOP=35.0) 劣化报文让室内 Wi-Fi/蜂窝优先接管；
        // 2) 发送无效定位报文 (quality=0 / V)；
        // 3) 发送 iAP2 RST 通知系统立即卸载外设源。
        if (activeSentences.size > 0) {
          const sortedIds = [...activeSentences].sort((a, b) => a - b);
          const degradeLoc = this.fallbackRealLocation ?? this.locationBox.get();
          const degradedMap = NMEAGenerator.locationSentences(degradeLoc, new Date(), {
            hdop: 35.0,
            fixQuality: 1,
          });
          const degradedOutgoing = sortedIds
            .map((id) => degradedMap[id])
            .filter((s): s is string => typeof s === "string");
          if (degradedOutgoing.length > 0) {
            await link.sendBestEffort(NMEAGenerator.locationMessage(degradedOutgoing), 200);
            this.emitEvent("location_degraded_sent", {
              hdop: 35.0,
              sentences: sortedIds,
            });
            await delay(40);
          }

          const voidMap = NMEAGenerator.voidLocationSentences();
          const voidOutgoing = sortedIds
            .map((id) => voidMap[id])
            .filter((s): s is string => typeof s === "string");
          if (voidOutgoing.length > 0) {
            await link.sendBestEffort(NMEAGenerator.locationMessage(voidOutgoing), 200);
            this.emitEvent("location_void_sent", { sentences: sortedIds });
            await delay(40);
          }
        }
        await link.sendReset();
        this.emitEvent("iap2_link_reset_sent");
        await delay(40);
      }

      this.emitEvent("finished", {
        identified: snapshot.identified,
        authenticated: snapshot.authenticated,
        location_packets_acknowledged: snapshot.packetsAcknowledged,
      });
      if (!keepRunningOnExit) {
        snapshot.isRunning = false;
        this.onSnapshot({ ...snapshot });
      }
      return { kind: "completed", packetCount: snapshot.packetsAcknowledged };
    } catch (error) {
      if (this.cancelled) {
        this.emitEvent("stopped", { reason: "user_cancelled" });
        if (!keepRunningOnExit) {
          snapshot.isRunning = false;
          this.onSnapshot({ ...snapshot });
        }
        return { kind: "completed", packetCount: snapshot.packetsAcknowledged };
      }

      const message = error instanceof Error ? error.message : String(error);
      const isFatal = message.includes("0xAA04") || message.includes("Identification rejected");
      if (isFatal || !keepRunningOnExit) {
        snapshot.lastError = message;
        this.emitEvent("error", { detail: message }, true);
        snapshot.isRunning = false;
        this.onSnapshot({ ...snapshot });
        return isFatal
          ? { kind: "fatalError", error: message }
          : {
              kind: "recoverableError",
              error: message,
              didSendPackets: snapshot.packetsAcknowledged > initialPacketCount,
              packetCount: snapshot.packetsAcknowledged,
            };
      }
      return {
        kind: "recoverableError",
        error: message,
        didSendPackets: snapshot.packetsAcknowledged > initialPacketCount,
        packetCount: snapshot.packetsAcknowledged,
      };
    } finally {
      await link.close().catch(() => undefined);
      this.activeLink = null;
    }
  }
}
