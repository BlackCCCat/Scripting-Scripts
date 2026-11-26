import { createHmac } from "node:crypto";
import { concat, fromHex, toHex } from "./bytes";

// NIST P-256 (secp256r1 / prime256v1) parameters
const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const A = P - 3n;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const HALF_N = N >> 1n;
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

interface JPoint {
  x: bigint;
  y: bigint;
  z: bigint;
}

const INF: JPoint = { x: 0n, y: 1n, z: 0n };

function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modInv(a: bigint, m: bigint): bigint {
  let lm = 1n;
  let hm = 0n;
  let low = mod(a, m);
  let high = m;
  if (low === 0n) throw new Error("Zero has no modular inverse");
  while (low > 1n) {
    const r = high / low;
    const nm = hm - lm * r;
    const nw = high - low * r;
    hm = lm;
    high = low;
    lm = nm;
    low = nw;
  }
  return mod(lm, m);
}

function pointDouble(p: JPoint): JPoint {
  if (p.z === 0n || p.y === 0n) return INF;
  const yy = mod(p.y * p.y, P);
  const yyyy = mod(yy * yy, P);
  const zz = mod(p.z * p.z, P);
  const s = mod(4n * p.x * yy, P);
  // M = 3*X^2 + a*Z^4 = 3*(X - Z^2)*(X + Z^2) because a = -3
  const m = mod(3n * (p.x - zz) * (p.x + zz), P);
  const x3 = mod(m * m - 2n * s, P);
  const y3 = mod(m * (s - x3) - 8n * yyyy, P);
  const z3 = mod(2n * p.y * p.z, P);
  return { x: x3, y: y3, z: z3 };
}

function pointAdd(p: JPoint, q: JPoint): JPoint {
  if (p.z === 0n) return q;
  if (q.z === 0n) return p;

  const z1z1 = mod(p.z * p.z, P);
  const z2z2 = mod(q.z * q.z, P);
  const u1 = mod(p.x * z2z2, P);
  const u2 = mod(q.x * z1z1, P);
  const s1 = mod(p.y * q.z * z2z2, P);
  const s2 = mod(q.y * p.z * z1z1, P);

  if (u1 === u2) {
    if (s1 !== s2) return INF;
    return pointDouble(p);
  }

  const h = mod(u2 - u1, P);
  const i = mod(4n * h * h, P);
  const j = mod(h * i, P);
  const r = mod(2n * (s2 - s1), P);
  const v = mod(u1 * i, P);
  const x3 = mod(r * r - j - 2n * v, P);
  const y3 = mod(r * (v - x3) - 2n * s1 * j, P);
  const z3 = mod((p.z + q.z) * (p.z + q.z) - z1z1 - z2z2, P);
  return { x: x3, y: y3, z: mod(z3 * h, P) };
}

function scalarMult(k: bigint, pt: { x: bigint; y: bigint }): { x: bigint; y: bigint } | null {
  let n = mod(k, N);
  if (n === 0n) return null;
  let acc = INF;
  let addend: JPoint = { x: pt.x, y: pt.y, z: 1n };
  while (n > 0n) {
    if (n & 1n) acc = pointAdd(acc, addend);
    addend = pointDouble(addend);
    n >>= 1n;
  }
  if (acc.z === 0n) return null;
  const zInv = modInv(acc.z, P);
  const zInv2 = mod(zInv * zInv, P);
  const zInv3 = mod(zInv2 * zInv, P);
  return { x: mod(acc.x * zInv2, P), y: mod(acc.y * zInv3, P) };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt("0x" + (toHex(bytes) || "00"));
}

function bigIntToBytes32(n: bigint): Uint8Array {
  return fromHex(mod(n, P).toString(16).padStart(64, "0"));
}

function scalarToBytes32(n: bigint): Uint8Array {
  return fromHex(n.toString(16).padStart(64, "0"));
}

function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const buf = createHmac("sha256", key).update(data).digest();
  return new Uint8Array(buf);
}

/** RFC 6979 deterministic nonce generation for P-256 + 32-byte digest. */
function generateRfc6979K(privScalar32: Uint8Array, digest32: Uint8Array, attemptBias = 0): bigint {
  const x = privScalar32;
  const h1 = digest32;
  let v: Uint8Array = new Uint8Array(32).fill(0x01);
  let k: Uint8Array = new Uint8Array(32).fill(0x00);

  const extra = attemptBias > 0 ? new Uint8Array([attemptBias & 0xff]) : new Uint8Array(0);
  k = hmacSha256(k, concat(v, new Uint8Array([0x00]), x, h1, extra));
  v = hmacSha256(k, v);
  k = hmacSha256(k, concat(v, new Uint8Array([0x01]), x, h1, extra));
  v = hmacSha256(k, v);

  for (let i = 0; i < 64; i++) {
    v = hmacSha256(k, v);
    const candidate = bytesToBigInt(v);
    if (candidate >= 1n && candidate < N) {
      return candidate;
    }
    k = hmacSha256(k, concat(v, new Uint8Array([0x00])));
    v = hmacSha256(k, v);
  }
  throw new Error("RFC 6979 nonce generation failed");
}

export function isOnP256Curve(x: bigint, y: bigint): boolean {
  if (x <= 0n || x >= P || y <= 0n || y >= P) return false;
  const lhs = mod(y * y, P);
  const rhs = mod(x * x * x + A * x + B, P);
  return lhs === rhs;
}

export function parseP256PublicKeyX963(x963: Uint8Array): { x: bigint; y: bigint } {
  if (x963.length !== 65 || x963[0] !== 0x04) {
    throw new Error("Invalid uncompressed P-256 public key");
  }
  const x = bytesToBigInt(x963.subarray(1, 33));
  const y = bytesToBigInt(x963.subarray(33, 65));
  if (!isOnP256Curve(x, y)) {
    throw new Error("P-256 public key point is not on curve");
  }
  return { x, y };
}

export function deriveP256PublicKeyX963(scalar32: Uint8Array): Uint8Array {
  if (scalar32.length !== 32) throw new Error("P-256 scalar must be 32 bytes");
  const d = bytesToBigInt(scalar32);
  if (d < 1n || d >= N) throw new Error("P-256 scalar out of range");
  const pt = scalarMult(d, { x: GX, y: GY });
  if (!pt) throw new Error("Failed to derive P-256 public key");
  return concat(new Uint8Array([0x04]), scalarToBytes32(pt.x), scalarToBytes32(pt.y));
}

/** Signs a 32-byte prehashed SHA-256 digest using ECDSA P-256, returning 64-byte raw R || S. */
export function p256SignDigest(scalar32: Uint8Array, digest32: Uint8Array): Uint8Array {
  if (scalar32.length !== 32) throw new Error("P-256 private scalar must be 32 bytes");
  if (digest32.length !== 32) throw new Error("MFi-v3 challenge must be exactly 32 bytes (prehashed SHA-256)");

  const d = bytesToBigInt(scalar32);
  if (d < 1n || d >= N) throw new Error("P-256 private scalar out of range");
  const z = mod(bytesToBigInt(digest32), N);

  for (let attempt = 0; attempt < 32; attempt++) {
    const k = generateRfc6979K(scalar32, digest32, attempt);
    const point = scalarMult(k, { x: GX, y: GY });
    if (!point) continue;

    const r = mod(point.x, N);
    if (r === 0n) continue;

    let s = mod(modInv(k, N) * mod(z + mod(r * d, N), N), N);
    if (s === 0n) continue;

    if (s > HALF_N) s = N - s;
    return concat(scalarToBytes32(r), scalarToBytes32(s));
  }

  throw new Error("ECDSA P-256 signing failed");
}

/** Verifies a 64-byte raw R || S signature against a 32-byte prehashed SHA-256 digest and X9.63 public key. */
export function p256VerifyDigest(pubX963: Uint8Array, digest32: Uint8Array, rawRS: Uint8Array): boolean {
  if (rawRS.length !== 64 || digest32.length !== 32) return false;
  let pub: { x: bigint; y: bigint };
  try {
    pub = parseP256PublicKeyX963(pubX963);
  } catch {
    return false;
  }

  const r = bytesToBigInt(rawRS.subarray(0, 32));
  const s = bytesToBigInt(rawRS.subarray(32, 64));
  if (r < 1n || r >= N || s < 1n || s >= N) return false;

  const z = mod(bytesToBigInt(digest32), N);
  const w = modInv(s, N);
  const u1 = mod(z * w, N);
  const u2 = mod(r * w, N);

  const p1 = u1 === 0n ? null : scalarMult(u1, { x: GX, y: GY });
  const p2 = u2 === 0n ? null : scalarMult(u2, pub);

  let sum: JPoint;
  if (!p1 && !p2) return false;
  if (!p1) sum = { x: p2!.x, y: p2!.y, z: 1n };
  else if (!p2) sum = { x: p1.x, y: p1.y, z: 1n };
  else sum = pointAdd({ x: p1.x, y: p1.y, z: 1n }, { x: p2.x, y: p2.y, z: 1n });

  if (sum.z === 0n) return false;
  const zInv = modInv(sum.z, P);
  const zInv2 = mod(zInv * zInv, P);
  const x = mod(sum.x * zInv2, P);
  return mod(x, N) === r;
}

export { bigIntToBytes32 };
