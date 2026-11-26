import { utf8, fromUtf8, toBase64, fromBase64 } from "./bytes";
import { equalBytes } from "./srp";

const MASK = (1n << 64n) - 1n;
function rotate(n: bigint, shift: bigint): bigint {
  return ((n << shift) | (n >> (64n - shift))) & MASK;
}
function le(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = n * 256n + BigInt(bytes[i]);
  return n;
}

/** Apple's advertised 6-byte reversed SipHash-2-4 identity tag. */
export function authTag(altIRK: Uint8Array, identifier: string): Uint8Array {
  if (altIRK.length !== 16 || utf8(identifier).length > 255) throw new Error("Invalid Bonjour identity");
  const k0 = le(altIRK.subarray(0, 8));
  const k1 = le(altIRK.subarray(8));
  let v0 = 0x736f6d6570736575n ^ k0;
  let v1 = 0x646f72616e646f6dn ^ k1;
  let v2 = 0x6c7967656e657261n ^ k0;
  let v3 = 0x7465646279746573n ^ k1;

  function round() {
    v0 = (v0 + v1) & MASK;
    v1 = rotate(v1, 13n) ^ v0;
    v0 = rotate(v0, 32n);
    v2 = (v2 + v3) & MASK;
    v3 = rotate(v3, 16n) ^ v2;
    v0 = (v0 + v3) & MASK;
    v3 = rotate(v3, 21n) ^ v0;
    v2 = (v2 + v1) & MASK;
    v1 = rotate(v1, 17n) ^ v2;
    v2 = rotate(v2, 32n);
  }

  const data = utf8(identifier);
  let offset = 0;
  for (; offset + 8 <= data.length; offset += 8) {
    const m = le(data.subarray(offset, offset + 8));
    v3 ^= m;
    round();
    round();
    v0 ^= m;
  }
  const last = (BigInt(data.length) << 56n) | le(data.subarray(offset));
  v3 ^= last;
  round();
  round();
  v0 ^= last;
  v2 ^= 255n;
  round();
  round();
  round();
  round();
  const result = v0 ^ v1 ^ v2 ^ v3;
  return Uint8Array.from([5, 4, 3, 2, 1, 0].map((index) => Number((result >> BigInt(index * 8)) & 255n)));
}

export function pairingTXT(identifier: string, hostAltIRK: Uint8Array): Record<string, string> {
  return {
    name: "Reloc",
    identifier,
    authTag: toBase64(authTag(hostAltIRK, identifier)),
    model: "Mac17,7",
    flags: "1",
    ver: "26",
    minVer: "17",
  };
}

export interface PairingAdvertisement {
  port: number;
  addresses: string[];
}

function peerAddresses(service: BonjourResolvedService): string[] {
  const result: string[] = [];
  for (const entry of service.addresses ?? []) {
    const ip = entry?.address;
    if (ip && !ip.includes("%") && !result.includes(ip)) result.push(ip);
  }
  return result;
}

export function discoverPairingService(altIRK: Uint8Array, timeout = 5000): Promise<PairingAdvertisement | null> {
  if (altIRK.length !== 16 || typeof Bonjour === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let ended = false;
    let browser: BonjourBrowser | undefined;
    const active = new Set<string>();
    const timer = setTimeout(() => finish(null), timeout);
    function finish(found: PairingAdvertisement | null) {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      browser?.stop();
      resolve(found);
    }
    try {
      browser = Bonjour.browse({
        type: "_remotepairing._tcp",
        includePeerToPeer: true,
        onError: () => finish(null),
        onFound: (service) => {
          if (ended || active.has(service.name) || active.size >= 16) return;
          active.add(service.name);
          void Bonjour.resolve(service, { timeout: Math.min(3000, timeout), includePeerToPeer: true })
            .then((result) => {
              if (ended) return;
              const identifier = fromUtf8(result.txtRecord.identifier ?? utf8(service.name));
              const tagText = result.txtRecord.authTag;
              if (tagText && equalBytes(fromBase64(fromUtf8(tagText)), authTag(altIRK, identifier))) {
                finish({ port: result.port, addresses: peerAddresses(result) });
              }
            })
            .catch(() => undefined);
        },
      });
    } catch {
      finish(null);
    }
  });
}
