/**
 * 地形真实海拔自动查询（同步上游 Reukix/Reloc v1.0.3）：
 * 主源使用 Open-Meteo Elevation API，失败时回退到 OpenTopoData ASTER 30m。
 */

export function clampAltitude(altitude: number): number {
  if (!Number.isFinite(altitude)) return 10.0;
  const clamped = Math.min(50_000.0, Math.max(-500.0, altitude));
  return Math.round(clamped * 10) / 10;
}

async function fetchOpenMeteoElevation(latStr: string, lonStr: string): Promise<number | null> {
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${latStr}&longitude=${lonStr}`;
    const resp = await fetch(url, { method: "GET", timeout: 3 } as RequestInit);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { elevation?: unknown[] };
    const raw = json?.elevation?.[0];
    return typeof raw === "number" && Number.isFinite(raw) ? clampAltitude(raw) : null;
  } catch {
    return null;
  }
}

async function fetchOpenTopoDataElevation(latStr: string, lonStr: string): Promise<number | null> {
  try {
    const url = `https://api.opentopodata.org/v1/aster30m?locations=${latStr},${lonStr}`;
    const resp = await fetch(url, { method: "GET", timeout: 3 } as RequestInit);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { results?: Array<{ elevation?: unknown }> };
    const raw = json?.results?.[0]?.elevation;
    return typeof raw === "number" && Number.isFinite(raw) ? clampAltitude(raw) : null;
  } catch {
    return null;
  }
}

export async function fetchTerrainElevation(latitude: number, longitude: number): Promise<number | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const latStr = latitude.toFixed(6);
  const lonStr = longitude.toFixed(6);
  const primary = await fetchOpenMeteoElevation(latStr, lonStr);
  if (primary !== null) return primary;
  return fetchOpenTopoDataElevation(latStr, lonStr);
}
