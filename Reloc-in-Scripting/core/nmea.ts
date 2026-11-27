import { concat } from "./bytes";
import { IAP2Message, IAP2Parameter } from "./iap2_wire";
import type { Coordinate, TargetLocation } from "../types";

export const NMEAGenerator = {
  formatCoordinate(value: number, isLatitude: boolean): { formatted: string; hemisphere: string } {
    const limit = isLatitude ? 90.0 : 180.0;
    if (!Number.isFinite(value) || value < -limit || value > limit) {
      throw new Error(`Coordinate out of range: ${value}`);
    }
    const units = Math.round(Math.abs(value) * 60.0 * 10000.0);
    const degrees = Math.floor(units / 600_000);
    const minuteUnits = units % 600_000;
    const minutes = minuteUnits / 10000.0;
    const hemisphere = isLatitude ? (value < 0 ? "S" : "N") : (value < 0 ? "W" : "E");

    const degPad = isLatitude ? 2 : 3;
    const degStr = String(degrees).padStart(degPad, "0");
    const minInt = Math.floor(minutes);
    const minFrac = Math.round((minutes - minInt) * 10000);
    const minStr = `${String(minInt).padStart(2, "0")}.${String(minFrac).padStart(4, "0")}`;
    return { formatted: `${degStr}${minStr}`, hemisphere };
  },

  sentence(body: string): string {
    let checksum = 0;
    const bytes = new TextEncoder().encode(body);
    for (let i = 0; i < bytes.length; i++) checksum ^= bytes[i];
    return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, "0")}\r\n`;
  },

  locationSentences(
    location: TargetLocation,
    date = new Date(),
    options?: { hdop?: number; fixQuality?: number },
  ): Record<number, string> {
    const { formatted: lat, hemisphere: north } = this.formatCoordinate(location.latitude, true);
    const { formatted: lon, hemisphere: east } = this.formatCoordinate(location.longitude, false);

    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    const cs = String(Math.min(99, Math.max(0, Math.floor(date.getUTCMilliseconds() / 10)))).padStart(2, "0");
    const clock = `${hh}${mm}${ss}.${cs}`;

    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const year = String(date.getUTCFullYear() % 100).padStart(2, "0");
    const ddmmyy = `${day}${month}${year}`;

    const safeAlt = Number.isFinite(location.altitude)
      ? Math.min(50_000.0, Math.max(-500.0, location.altitude))
      : 10.0;
    const altitudeStr = safeAlt.toFixed(1);
    const fixQuality = Number.isInteger(options?.fixQuality) ? (options!.fixQuality as number) : 1;
    const hdopStr = (Number.isFinite(options?.hdop) ? (options!.hdop as number) : 0.6).toFixed(1);
    const speedStr = Math.max(0.0, Number.isFinite(location.speedKnots) ? location.speedKnots : 0.0).toFixed(1);
    const courseNorm = Number.isFinite(location.courseDegrees)
      ? (((location.courseDegrees % 360.0) + 360.0) % 360.0)
      : 0.0;
    const courseStr = courseNorm.toFixed(1);

    const gga = this.sentence(
      `GPGGA,${clock},${lat},${north},${lon},${east},${fixQuality},12,${hdopStr},${altitudeStr},M,0.0,M,,`,
    );
    const rmcMode = fixQuality === 2 ? "D" : "A";
    const rmc = this.sentence(
      `GPRMC,${clock},A,${lat},${north},${lon},${east},${speedStr},${courseStr},${ddmmyy},,,${rmcMode}`,
    );
    return { 1: gga, 2: rmc };
  },

  locationMessage(sentences: string[]): IAP2Message {
    const parts = sentences.map((item) => IAP2Parameter.encodeText(0, item));
    return new IAP2Message(0xfffb, concat(...parts));
  },

  /**
   * 停止定位时下发 NMEA 无效定位报文 (GGA quality=0, RMC status=V)，
   * 提示 iOS `locationd` 立即放弃外设坐标并切回真实 GPS（同步上游 Reloc v1.0.1）。
   */
  voidLocationSentences(date = new Date()): Record<number, string> {
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    const cs = String(Math.min(99, Math.max(0, Math.floor(date.getUTCMilliseconds() / 10)))).padStart(2, "0");
    const clock = `${hh}${mm}${ss}.${cs}`;

    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const year = String(date.getUTCFullYear() % 100).padStart(2, "0");
    const ddmmyy = `${day}${month}${year}`;

    const gga = this.sentence(`GPGGA,${clock},0000.0000,N,00000.0000,E,0,00,99.9,0.0,M,0.0,M,,`);
    const rmc = this.sentence(`GPRMC,${clock},V,,,,,0.0,0.0,${ddmmyy},,,N`);
    return { 1: gga, 2: rmc };
  },

  identificationMessage(options?: {
    name?: string;
    model?: string;
    manufacturer?: string;
    serialNumber?: string;
    firmwareVersion?: string;
    hardwareVersion?: string;
  }): IAP2Message {
    const name = options?.name ?? "Accessory Location Lab";
    const model = options?.model ?? "AL-1";
    const manufacturer = options?.manufacturer ?? "Local Research";
    const serialNumber = options?.serialNumber ?? "AL-LOCAL-001";
    const firmwareVersion = options?.firmwareVersion ?? "0.1";
    const hardwareVersion = options?.hardwareVersion ?? "1";

    const parts: Uint8Array[] = [
      IAP2Parameter.encodeText(0, name),
      IAP2Parameter.encodeText(1, model),
      IAP2Parameter.encodeText(2, manufacturer),
      IAP2Parameter.encodeText(3, serialNumber),
      IAP2Parameter.encodeText(4, firmwareVersion),
      IAP2Parameter.encodeText(5, hardwareVersion),
      // MessagesSentByAccessory: 0xFFFB (LocationInformation)
      IAP2Parameter.encode(6, new Uint8Array([0xff, 0xfb])),
      // MessagesReceivedFromDevice: 0xFFFA (StartLocation), 0xFFFC (StopLocation)
      IAP2Parameter.encode(7, new Uint8Array([0xff, 0xfa, 0xff, 0xfc])),
      // PowerProvidingCapability = None (0)
      IAP2Parameter.encode(8, new Uint8Array([0x00])),
      // MaximumCurrentDrawnFromDevice = 0 mA
      IAP2Parameter.encode(9, new Uint8Array([0x00, 0x00])),
      // CurrentLanguage & SupportedLanguage
      IAP2Parameter.encodeText(12, "en"),
      IAP2Parameter.encodeText(13, "en"),
    ];

    // USBHostTransportComponent (param 16)
    const transportComponent = concat(
      IAP2Parameter.encode(0, new Uint8Array([0x00, 0x00])),
      IAP2Parameter.encodeText(1, "Location Transport"),
      IAP2Parameter.encode(2, new Uint8Array(0)),
    );
    parts.push(IAP2Parameter.encode(16, transportComponent));

    // LocationInformationComponent (param 22): ID 0, Name "GPS", GGA (17), RMC (18)
    const locationComponent = concat(
      IAP2Parameter.encode(0, new Uint8Array([0x00, 0x00])),
      IAP2Parameter.encodeText(1, "GPS"),
      IAP2Parameter.encode(17, new Uint8Array(0)),
      IAP2Parameter.encode(18, new Uint8Array(0)),
    );
    parts.push(IAP2Parameter.encode(22, locationComponent));

    return new IAP2Message(0x1d01, concat(...parts));
  },
};

const A = 6378245.0;
const EE = 0.00669342162296594323;

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

function gcjDelta(lat: number, lon: number): { dLat: number; dLon: number } {
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1.0 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1.0 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { dLat, dLon };
}

export const CoordinateTransform = {
  isOutsideChina(lat: number, lon: number): boolean {
    return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
  },

  wgs84ToGCJ02(lat: number, lon: number): Coordinate {
    if (this.isOutsideChina(lat, lon)) return { latitude: lat, longitude: lon };
    const { dLat, dLon } = gcjDelta(lat, lon);
    return { latitude: lat + dLat, longitude: lon + dLon };
  },

  gcj02ToWGS84(lat: number, lon: number): Coordinate {
    if (this.isOutsideChina(lat, lon)) return { latitude: lat, longitude: lon };
    let wgsLat = lat;
    let wgsLon = lon;
    for (let i = 0; i < 6; i++) {
      const gcj = this.wgs84ToGCJ02(wgsLat, wgsLon);
      const errLat = gcj.latitude - lat;
      const errLon = gcj.longitude - lon;
      if (Math.abs(errLat) < 1e-9 && Math.abs(errLon) < 1e-9) break;
      wgsLat -= errLat;
      wgsLon -= errLon;
    }
    return { latitude: wgsLat, longitude: wgsLon };
  },

  applyMicroJitter(location: TargetLocation, radiusMeters = 0.6): TargetLocation {
    if (radiusMeters <= 0) return location;
    const angle = Math.random() * 2.0 * Math.PI;
    const radius = radiusMeters * Math.sqrt(Math.random());
    const dLat = (radius * Math.cos(angle)) / 111_320.0;
    const cosLat = Math.max(0.01, Math.cos((location.latitude * Math.PI) / 180.0));
    const dLon = (radius * Math.sin(angle)) / (111_320.0 * cosLat);
    const baseAlt = Number.isFinite(location.altitude) ? location.altitude : 10.0;
    const dAlt = (Math.random() - 0.5) * 0.6;
    return {
      ...location,
      latitude: Math.min(90.0, Math.max(-90.0, location.latitude + dLat)),
      longitude: Math.min(180.0, Math.max(-180.0, location.longitude + dLon)),
      altitude: Math.min(50_000.0, Math.max(-500.0, baseAlt + dAlt)),
    };
  },
};
