import {
  DEFAULT_FAVORITES,
  DEFAULT_HOST,
  DEFAULT_LOCKDOWN_PORT,
  DEFAULT_REMOTE_PORT,
  DEFAULT_SERVICE_NAME,
  DEFAULT_SETTINGS,
  KEYCHAIN_KEYS,
  STORAGE_KEYS,
} from "../constants";
import { fromBase64, toBase64 } from "../core/bytes";
import { MFiSigner } from "../core/mfi_signer";
import type {
  AppSettings,
  FavoriteLocation,
  InterruptedSessionRecord,
  MFiStatus,
  PickTarget,
  RecentLocation,
} from "../types";

const RECENT_LIMIT = 30;

// ── 应用设置 ──────────────────────────────────────────────────────

export function loadSettings(): AppSettings {
  const saved = Storage.get<Partial<AppSettings>>(STORAGE_KEYS.settings);
  const rawTunnelSource: string | undefined = saved?.tunnelSource;
  const tunnelSource: AppSettings["tunnelSource"] =
    rawTunnelSource === "builtIn" || rawTunnelSource === "loopback"
      ? "builtIn"
      : "proxyApp";
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}), tunnelSource };
}

export function saveSettings(settings: AppSettings): boolean {
  return Storage.set(STORAGE_KEYS.settings, settings);
}

export function sanitizeHostFromSettings(settings: AppSettings): string {
  return settings.host.trim() || DEFAULT_HOST;
}

export function sanitizePort(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  return rounded >= 1 && rounded <= 65535 ? rounded : fallback;
}

export function buildSessionConfigFromSettings(
  settings: AppSettings,
  mode: "probe" | "send",
) {
  return {
    host: sanitizeHostFromSettings(settings),
    remotePort: sanitizePort(settings.remotePort, DEFAULT_REMOTE_PORT),
    lockdownPort: sanitizePort(settings.lockdownPort, DEFAULT_LOCKDOWN_PORT),
    serviceName: settings.serviceName.trim() || DEFAULT_SERVICE_NAME,
    tunnelSource: settings.tunnelSource,
    mode,
    intervalSeconds: Math.min(5, Math.max(0.25, settings.intervalSeconds || 1.0)),
    durationSeconds: Math.max(0, settings.durationSeconds || 0),
    microJitterEnabled: Boolean(settings.microJitterEnabled),
  };
}

// ── 收藏地点 ──────────────────────────────────────────────────────

export function loadFavorites(): FavoriteLocation[] {
  const saved = Storage.get<FavoriteLocation[]>(STORAGE_KEYS.favorites);
  if (!saved) {
    Storage.set(STORAGE_KEYS.favorites, DEFAULT_FAVORITES);
    return [...DEFAULT_FAVORITES];
  }
  return saved;
}

function saveFavorites(list: FavoriteLocation[]): void {
  Storage.set(STORAGE_KEYS.favorites, list);
}

export function addFavorite(input: {
  name: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
  altitude: number;
}): FavoriteLocation[] {
  const list = loadFavorites();
  const next: FavoriteLocation = {
    id: `fav-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim() || `${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`,
    subtitle: input.subtitle?.trim() || undefined,
    latitude: input.latitude,
    longitude: input.longitude,
    altitude: input.altitude,
  };
  const updated = [next, ...list];
  saveFavorites(updated);
  return updated;
}

export function renameFavorite(id: string, newName: string): FavoriteLocation[] {
  const trimmed = newName.trim();
  if (!trimmed) return loadFavorites();
  const updated = loadFavorites().map((item) =>
    item.id === id ? { ...item, name: trimmed } : item,
  );
  saveFavorites(updated);
  return updated;
}

export function removeFavorite(id: string): FavoriteLocation[] {
  const updated = loadFavorites().filter((item) => item.id !== id);
  saveFavorites(updated);
  return updated;
}

// ── 最近使用 ──────────────────────────────────────────────────────

export function loadRecents(): RecentLocation[] {
  return Storage.get<RecentLocation[]>(STORAGE_KEYS.recents) ?? [];
}

export function addRecent(input: {
  name: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
  altitude: number;
}): RecentLocation[] {
  const filtered = loadRecents().filter(
    (item) =>
      Math.abs(item.latitude - input.latitude) > 1e-6 ||
      Math.abs(item.longitude - input.longitude) > 1e-6,
  );
  const entry: RecentLocation = {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim() || `${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`,
    subtitle: input.subtitle?.trim() || undefined,
    latitude: input.latitude,
    longitude: input.longitude,
    altitude: input.altitude,
    usedAt: new Date().toISOString(),
  };
  const updated = [entry, ...filtered].slice(0, RECENT_LIMIT);
  Storage.set(STORAGE_KEYS.recents, updated);
  return updated;
}

export function clearRecents(): void {
  Storage.set(STORAGE_KEYS.recents, []);
}

// ── 上次位置 & 异常中断恢复 & ScriptSession ID ────────────────────

export function loadLastLocation(): (PickTarget & { altitude: number }) | null {
  return Storage.get<PickTarget & { altitude: number }>(STORAGE_KEYS.lastLocation) ?? null;
}

export function saveLastLocation(target: PickTarget & { altitude: number }): void {
  Storage.set(STORAGE_KEYS.lastLocation, target);
}

export function loadInterruptedSession(): InterruptedSessionRecord | null {
  return Storage.get<InterruptedSessionRecord>(STORAGE_KEYS.interrupted) ?? null;
}

export function saveInterruptedSession(record: InterruptedSessionRecord): void {
  Storage.set(STORAGE_KEYS.interrupted, record);
}

export function clearInterruptedSession(): void {
  Storage.remove(STORAGE_KEYS.interrupted);
}

export function saveSessionID(id: string): void {
  Storage.set(STORAGE_KEYS.sessionID, id);
}

export function clearSessionID(): void {
  Storage.remove(STORAGE_KEYS.sessionID);
}

export function loadSessionID(): string | null {
  return Storage.get<string>(STORAGE_KEYS.sessionID) ?? null;
}

// ── MFi 本地凭据管理（不内置任何凭据，仅由用户手动导入或放置本地目录） ──

export function loadMFiSigner(): MFiSigner | null {
  try {
    const certB64 = Keychain.get(KEYCHAIN_KEYS.mfiCertificateB64);
    const keyB64 = Keychain.get(KEYCHAIN_KEYS.mfiPrivateKeyB64);
    if (!certB64 || !keyB64) return null;
    return new MFiSigner(fromBase64(certB64), fromBase64(keyB64));
  } catch {
    return null;
  }
}

export function loadMFiStatus(): MFiStatus {
  const certB64 = Keychain.get(KEYCHAIN_KEYS.mfiCertificateB64);
  const keyB64 = Keychain.get(KEYCHAIN_KEYS.mfiPrivateKeyB64);
  const sourceLabel = Keychain.get(KEYCHAIN_KEYS.mfiSourceLabel) ?? null;

  if (!certB64 && !keyB64) {
    return {
      isLoaded: false,
      leafSubject: null,
      certificateCount: 0,
      sourceLabel: null,
      errorMessage: null,
    };
  }
  if (!certB64 || !keyB64) {
    return {
      isLoaded: false,
      leafSubject: null,
      certificateCount: 0,
      sourceLabel,
      errorMessage: "缺少 certificate.p7b 或 identity.pk8 中的一项，请重新导入完整凭据对",
    };
  }

  try {
    const signer = new MFiSigner(fromBase64(certB64), fromBase64(keyB64));
    return {
      isLoaded: true,
      leafSubject: signer.leafSubjectSummary,
      certificateCount: signer.certificateCount,
      sourceLabel: sourceLabel || "Keychain",
      errorMessage: null,
    };
  } catch (error) {
    return {
      isLoaded: false,
      leafSubject: null,
      certificateCount: 0,
      sourceLabel,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function saveMFiCredentials(
  certificateBytes: Uint8Array,
  privateKeyBytes: Uint8Array,
  sourceLabel: string,
): MFiStatus {
  // 先校验 PKCS#7、P-256 PKCS#8/SEC1 与密钥匹配再写入钥匙串
  const signer = new MFiSigner(certificateBytes, privateKeyBytes);
  const certOk = Keychain.set(
    KEYCHAIN_KEYS.mfiCertificateB64,
    toBase64(signer.certificateContainerData),
  );
  const keyOk = Keychain.set(KEYCHAIN_KEYS.mfiPrivateKeyB64, toBase64(privateKeyBytes));
  Keychain.set(KEYCHAIN_KEYS.mfiSourceLabel, sourceLabel);

  if (!certOk || !keyOk) {
    throw new Error("写入钥匙串失败，请检查系统权限后重试");
  }

  return {
    isLoaded: true,
    leafSubject: signer.leafSubjectSummary,
    certificateCount: signer.certificateCount,
    sourceLabel,
    errorMessage: null,
  };
}

export function clearMFiCredentials(): void {
  Keychain.remove(KEYCHAIN_KEYS.mfiCertificateB64);
  Keychain.remove(KEYCHAIN_KEYS.mfiPrivateKeyB64);
  Keychain.remove(KEYCHAIN_KEYS.mfiSourceLabel);
}

export function mfiCandidateDirectories(): string[] {
  return [
    `${FileManager.documentsDirectory}/Reloc/MFi`,
    `${FileManager.scriptsDirectory}/Reloc in Scripting/MFi`,
    `${FileManager.documentsDirectory}/MFi`,
    FileManager.documentsDirectory,
  ];
}

export function scanLocalMFiDirectory(): {
  status: MFiStatus;
  directory: string;
} | null {
  for (const dir of mfiCandidateDirectories()) {
    const certPath = `${dir}/certificate.p7b`;
    const keyPath = `${dir}/identity.pk8`;
    try {
      if (FileManager.existsSync(certPath) && FileManager.existsSync(keyPath)) {
        const certBytes = FileManager.readAsBytesSync(certPath);
        const keyBytes = FileManager.readAsBytesSync(keyPath);
        const status = saveMFiCredentials(certBytes, keyBytes, `本地目录 (${dir})`);
        return { status, directory: dir };
      }
    } catch {
      // 某个目录文件无效则继续尝试下一个目录
    }
  }
  return null;
}

export function testMFiSignerRoundTrip(): {
  ok: boolean;
  durationMs: number;
  leafSubject: string;
  certificateCount: number;
  error?: string;
} {
  const signer = loadMFiSigner();
  if (!signer) {
    return {
      ok: false,
      durationMs: 0,
      leafSubject: "",
      certificateCount: 0,
      error: "尚未加载有效的 MFi 凭据（certificate.p7b + identity.pk8）",
    };
  }

  const started = Date.now();
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const sig = signer.signChallenge(challenge);
    const verified = signer.verifyRawSignature(sig, challenge);
    const durationMs = Date.now() - started;
    if (!verified || sig.length !== 64) {
      return {
        ok: false,
        durationMs,
        leafSubject: signer.leafSubjectSummary,
        certificateCount: signer.certificateCount,
        error: `签名回环验证失败（签名长度=${sig.length}）`,
      };
    }
    return {
      ok: true,
      durationMs,
      leafSubject: signer.leafSubjectSummary,
      certificateCount: signer.certificateCount,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      leafSubject: signer.leafSubjectSummary,
      certificateCount: signer.certificateCount,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
