export type TunnelSource = "proxyApp" | "builtIn";

export type MapDisplayStyle = "standard" | "satellite" | "hybrid";

export type SessionMode = "probe" | "send";

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface TargetLocation extends Coordinate {
  altitude: number;
  speedKnots: number;
  courseDegrees: number;
}

export interface PickTarget extends Coordinate {
  name?: string;
  address?: string;
  altitude?: number;
}

export interface ParsedCoord {
  latitude: number;
  longitude: number;
  name?: string;
  src?: string;
}

export interface FavoriteLocation {
  id: string;
  name: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
  altitude: number;
}

export interface RecentLocation {
  id: string;
  name: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
  altitude: number;
  usedAt: string;
}

export interface InterruptedSessionRecord {
  placeName: string;
  latitude: number;
  longitude: number;
  altitude: number;
  savedAt: string;
}

export interface ProtocolEvent {
  id: string;
  timestamp: string;
  name: string;
  detail: string;
  isError: boolean;
}

export interface SessionSnapshot {
  isRunning: boolean;
  mode: SessionMode;
  lockdownConnected: boolean;
  linkReady: boolean;
  identified: boolean;
  authenticated: boolean;
  activeSentences: number[];
  packetsAcknowledged: number;
  lastError: string | null;
}

export interface SessionConfiguration {
  host: string;
  remotePort: number;
  lockdownPort: number;
  serviceName: string;
  tunnelSource: TunnelSource;
  mode: SessionMode;
  intervalSeconds: number;
  /** 0 表示持续运行直到手动停止 */
  durationSeconds: number;
  microJitterEnabled?: boolean;
}

export type ConnectionCheckState = "idle" | "checking" | "verified" | "failed";

export interface ConnectionCheckResult {
  udid: string;
  port: number;
  carkitService: string | null;
  servicesCount: number;
}

export type PairingKind = "Remote Pairing" | "Lockdown";

export interface PairingStatus {
  isLoaded: boolean;
  kind: PairingKind | null;
  summaryID: string | null;
  deviceName: string;
  deviceUDID: string;
  errorMessage: string | null;
}

export interface MFiStatus {
  isLoaded: boolean;
  leafSubject: string | null;
  certificateCount: number;
  sourceLabel: string | null;
  errorMessage: string | null;
}

export interface LiveLocationTelemetry {
  latitude: number;
  longitude: number;
  timestamp: number;
}

export interface AppSettings {
  tunnelSource: TunnelSource;
  host: string;
  remotePort: number;
  lockdownPort: number;
  serviceName: string;
  intervalSeconds: number;
  durationSeconds: number;
  defaultAltitude: number;
  gcj02CorrectionEnabled: boolean;
  backgroundKeepAliveEnabled: boolean;
  liveActivityEnabled: boolean;
  microJitterEnabled: boolean;
  mapStyle: MapDisplayStyle;
  globalSearchEndpoint: string;
  shortcutButtonEnabled: boolean;
  shortcutName: string;
}
