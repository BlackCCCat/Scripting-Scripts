import { concat, fromHex, toHex, utf8, toArrayBuffer } from "./bytes";

const N_BYTES = fromHex(
  "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514" +
  "A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42" +
  "E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163" +
  "BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C" +
  "354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4" +
  "C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85" +
  "521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E0" +
  "4A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D" +
  "6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF",
);
const N = BigInt("0x" + toHex(N_BYTES));
const USER = utf8("Pair-Setup");

function integer(bytes: Uint8Array): bigint {
  return BigInt("0x" + (toHex(bytes) || "00"));
}
function minimal(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return fromHex(hex);
}
function padded(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(384);
  out.set(bytes, 384 - bytes.length);
  return out;
}
function pow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  base %= N;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % N;
    base = (base * base) % N;
    exponent >>= 1n;
  }
  return result;
}
async function hash(...values: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-512", toArrayBuffer(concat(...values))));
}
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export interface SRPChallenge {
  readonly salt: Uint8Array;
  readonly publicKey: Uint8Array;
  prove(clientPublic: Uint8Array): Promise<{ key: Uint8Array; clientProof: Uint8Array; serverProof: Uint8Array }>;
}

export async function createSRP(pin: string, fixedSalt?: Uint8Array, fixedSecret?: Uint8Array): Promise<SRPChallenge> {
  if (!/^\d{6}$/.test(pin)) throw new Error("配对 PIN 必须是六位数字");
  const salt = fixedSalt?.slice() ?? crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16 || (fixedSecret && fixedSecret.length !== 32)) throw new Error("Invalid SRP material length");
  const password = utf8(pin);
  let x: Uint8Array;
  try {
    x = await hash(salt, await hash(USER, utf8(":"), password));
  } finally {
    password.fill(0);
  }
  const verifier = pow(5n, integer(x));
  x.fill(0);
  const k = integer(await hash(N_BYTES, padded(new Uint8Array([5]))));
  let b = 0n;
  let B: Uint8Array = new Uint8Array(0);
  for (let attempt = 0; attempt < 16; attempt++) {
    const secret = fixedSecret?.slice() ?? crypto.getRandomValues(new Uint8Array(32));
    b = integer(secret);
    secret.fill(0);
    if (b === 0n) {
      if (fixedSecret) break;
      continue;
    }
    B = minimal((k * verifier + pow(5n, b)) % N);
    if (B.length === 384 || fixedSecret) break;
  }
  if (B.length !== 384 || b === 0n) throw new Error("SRP 公钥生成失败");
  let used = false;
  return {
    salt,
    publicKey: B,
    async prove(clientPublic) {
      if (used) throw new Error("SRP challenge already used");
      used = true;
      if (!clientPublic.length || clientPublic.length > 384) throw new Error("Invalid SRP client public key length");
      const A = integer(clientPublic);
      if (A <= 0n || A >= N) throw new Error("Invalid SRP client public key");
      const aBytes = minimal(A);
      const u = integer(await hash(aBytes, B));
      if (u === 0n) throw new Error("Invalid SRP scrambling parameter");
      const premaster = minimal(pow((A * pow(verifier, u)) % N, b));
      b = 0n;
      const key = await hash(premaster);
      premaster.fill(0);
      const hN = await hash(N_BYTES);
      const hG = await hash(new Uint8Array([5]));
      const xor = hN.map((value, index) => value ^ hG[index]);
      const clientProof = await hash(xor, await hash(USER), salt, padded(aBytes), padded(B), key);
      const serverProof = await hash(aBytes, clientProof, key);
      return { key, clientProof, serverProof };
    },
  };
}
