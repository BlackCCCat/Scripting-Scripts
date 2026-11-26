import { bytesEqual, fromBase64, fromUtf8 } from "./bytes";

export interface DerElement {
  tag: number;
  headerLength: number;
  valueOffset: number;
  valueLength: number;
  endOffset: number;
}

const OID_SIGNED_DATA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
export const OID_EC_PUBLIC_KEY = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
export const OID_PRIME256V1 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
const OID_BASIC_CONSTRAINTS = new Uint8Array([0x55, 0x1d, 0x13]);
const OID_COMMON_NAME = new Uint8Array([0x55, 0x04, 0x03]);
const OID_ORGANIZATION = new Uint8Array([0x55, 0x04, 0x0a]);

export function readDerElement(bytes: Uint8Array, limit: number, offset: number): DerElement {
  if (offset + 2 > limit) {
    throw new Error("Truncated ASN.1 DER element");
  }
  const tag = bytes[offset];
  const firstLen = bytes[offset + 1];
  let cursor = offset + 2;
  let valueLength = 0;

  if ((firstLen & 0x80) === 0) {
    valueLength = firstLen;
  } else {
    const octets = firstLen & 0x7f;
    if (octets === 0 || octets > 4 || cursor + octets > limit) {
      throw new Error("Unsupported or truncated DER length");
    }
    for (let i = 0; i < octets; i++) {
      valueLength = (valueLength << 8) | bytes[cursor++];
    }
    valueLength = valueLength >>> 0;
  }

  if (valueLength > limit - cursor) {
    throw new Error("DER element exceeds container bounds");
  }

  return {
    tag,
    headerLength: cursor - offset,
    valueOffset: cursor,
    valueLength,
    endOffset: cursor + valueLength,
  };
}

export function pemDecodeBlock(data: Uint8Array): { label: string; der: Uint8Array } | null {
  const text = fromUtf8(data);
  const beginPrefixIdx = text.indexOf("-----BEGIN ");
  if (beginPrefixIdx < 0) return null;
  const labelStart = beginPrefixIdx + "-----BEGIN ".length;
  const beginSuffixIdx = text.indexOf("-----", labelStart);
  if (beginSuffixIdx < 0) throw new Error("Malformed PEM BEGIN header");
  const label = text.slice(labelStart, beginSuffixIdx);
  const endMarker = `-----END ${label}-----`;
  const bodyStart = beginSuffixIdx + 5;
  const endIdx = text.indexOf(endMarker, bodyStart);
  if (endIdx < 0) throw new Error("Missing PEM END footer");
  const base64Body = text.slice(bodyStart, endIdx).replace(/\s+/g, "");
  const der = fromBase64(base64Body);
  if (der.length === 0) throw new Error("Invalid Base64 data in PEM block");
  return { label, der };
}

export function unwrapDerOrPem(raw: Uint8Array): { label: string | null; der: Uint8Array } {
  if (raw.length > 0 && raw[0] === 0x30) {
    return { label: null, der: raw };
  }
  const pem = pemDecodeBlock(raw);
  if (pem) return pem;
  return { label: null, der: raw };
}

export function extractPkcs7Certificates(pkcs7Data: Uint8Array): Uint8Array[] {
  if (pkcs7Data.length === 0) {
    throw new Error("Empty PKCS#7 container");
  }
  const total = pkcs7Data.length;
  const contentInfo = readDerElement(pkcs7Data, total, 0);
  if (contentInfo.tag !== 0x30 || contentInfo.endOffset !== total) {
    throw new Error("Invalid PKCS#7 ContentInfo");
  }

  const contentType = readDerElement(pkcs7Data, contentInfo.endOffset, contentInfo.valueOffset);
  if (contentType.tag !== 0x06) {
    throw new Error("Missing PKCS#7 contentType OID");
  }
  const oidSlice = pkcs7Data.subarray(contentType.valueOffset, contentType.endOffset);
  if (!bytesEqual(oidSlice, OID_SIGNED_DATA)) {
    throw new Error("PKCS#7 container is not SignedData");
  }

  const explicitContent = readDerElement(pkcs7Data, contentInfo.endOffset, contentType.endOffset);
  if (explicitContent.tag !== 0xa0) {
    throw new Error("Missing PKCS#7 SignedData wrapper");
  }

  const signedData = readDerElement(pkcs7Data, explicitContent.endOffset, explicitContent.valueOffset);
  if (signedData.tag !== 0x30) {
    throw new Error("Invalid SignedData sequence");
  }

  const version = readDerElement(pkcs7Data, signedData.endOffset, signedData.valueOffset);
  if (version.tag !== 0x02) throw new Error("Missing SignedData version");

  const digestAlgs = readDerElement(pkcs7Data, signedData.endOffset, version.endOffset);
  if (digestAlgs.tag !== 0x31) throw new Error("Missing SignedData digestAlgorithms");

  const encapContent = readDerElement(pkcs7Data, signedData.endOffset, digestAlgs.endOffset);
  if (encapContent.tag !== 0x30) throw new Error("Missing SignedData encapContentInfo");

  const certs: Uint8Array[] = [];
  let cursor = encapContent.endOffset;
  while (cursor < signedData.endOffset) {
    const field = readDerElement(pkcs7Data, signedData.endOffset, cursor);
    if (field.tag === 0xa0) {
      let certCursor = field.valueOffset;
      while (certCursor < field.endOffset) {
        const certEl = readDerElement(pkcs7Data, field.endOffset, certCursor);
        if (certEl.tag === 0x30) {
          certs.push(pkcs7Data.slice(certCursor, certEl.endOffset));
        }
        certCursor = certEl.endOffset;
      }
      break;
    }
    cursor = field.endOffset;
  }

  if (certs.length === 0) {
    throw new Error("PKCS#7 container has no certificates");
  }
  return certs;
}

export function unwrapPkcs8PrivateKey(pkcs8Data: Uint8Array): {
  algorithmOID: Uint8Array;
  parameterOID: Uint8Array | null;
  innerKeyData: Uint8Array;
} {
  const total = pkcs8Data.length;
  const root = readDerElement(pkcs8Data, total, 0);
  if (root.tag !== 0x30 || root.endOffset !== total) {
    throw new Error("Private key must be unencrypted DER PKCS#8");
  }

  const version = readDerElement(pkcs8Data, root.endOffset, root.valueOffset);
  if (version.tag !== 0x02) throw new Error("Invalid PKCS#8 version");

  const algSeq = readDerElement(pkcs8Data, root.endOffset, version.endOffset);
  if (algSeq.tag !== 0x30) throw new Error("Invalid PKCS#8 algorithm identifier");

  const keyOctet = readDerElement(pkcs8Data, root.endOffset, algSeq.endOffset);
  if (keyOctet.tag !== 0x04) throw new Error("Invalid PKCS#8 private key octet string");

  const algOID = readDerElement(pkcs8Data, algSeq.endOffset, algSeq.valueOffset);
  if (algOID.tag !== 0x06) throw new Error("Missing PKCS#8 algorithm OID");

  let parameterOID: Uint8Array | null = null;
  if (algOID.endOffset < algSeq.endOffset) {
    const paramEl = readDerElement(pkcs8Data, algSeq.endOffset, algOID.endOffset);
    if (paramEl.tag === 0x06) {
      parameterOID = pkcs8Data.slice(paramEl.valueOffset, paramEl.endOffset);
    }
  }

  return {
    algorithmOID: pkcs8Data.slice(algOID.valueOffset, algOID.endOffset),
    parameterOID,
    innerKeyData: pkcs8Data.slice(keyOctet.valueOffset, keyOctet.endOffset),
  };
}

export function extractEcP256PrivateScalar(sec1Der: Uint8Array): Uint8Array {
  const total = sec1Der.length;
  const seq = readDerElement(sec1Der, total, 0);
  if (seq.tag !== 0x30 || seq.endOffset !== total) {
    throw new Error("Invalid SEC1 ECPrivateKey");
  }

  const version = readDerElement(sec1Der, seq.endOffset, seq.valueOffset);
  if (version.tag !== 0x02 || version.valueLength !== 1 || sec1Der[version.valueOffset] !== 1) {
    throw new Error("Unsupported ECPrivateKey version");
  }

  const privOctet = readDerElement(sec1Der, seq.endOffset, version.endOffset);
  if (privOctet.tag !== 0x04 || privOctet.valueLength === 0 || privOctet.valueLength > 32) {
    throw new Error("Invalid P-256 private scalar length");
  }

  const scalar = new Uint8Array(32);
  scalar.set(
    sec1Der.subarray(privOctet.valueOffset, privOctet.endOffset),
    32 - privOctet.valueLength,
  );
  return scalar;
}

export interface ParsedX509Cert {
  isCA: boolean;
  subjectSummary: string;
  p256PublicKeyX963: Uint8Array | null;
}

function readTbsFields(certDer: Uint8Array): DerElement[] | null {
  try {
    const certSeq = readDerElement(certDer, certDer.length, 0);
    if (certSeq.tag !== 0x30) return null;
    const tbsSeq = readDerElement(certDer, certSeq.endOffset, certSeq.valueOffset);
    if (tbsSeq.tag !== 0x30) return null;

    const fields: DerElement[] = [];
    let cursor = tbsSeq.valueOffset;
    while (cursor < tbsSeq.endOffset) {
      const el = readDerElement(certDer, tbsSeq.endOffset, cursor);
      fields.push(el);
      cursor = el.endOffset;
    }
    return fields;
  } catch {
    return null;
  }
}

function parseNameSummary(bytes: Uint8Array, nameSeq: DerElement): string {
  let cn = "";
  let org = "";
  try {
    let rdnCursor = nameSeq.valueOffset;
    while (rdnCursor < nameSeq.endOffset) {
      const rdnSet = readDerElement(bytes, nameSeq.endOffset, rdnCursor);
      if (rdnSet.tag === 0x31) {
        let attrCursor = rdnSet.valueOffset;
        while (attrCursor < rdnSet.endOffset) {
          const atv = readDerElement(bytes, rdnSet.endOffset, attrCursor);
          if (atv.tag === 0x30) {
            const oid = readDerElement(bytes, atv.endOffset, atv.valueOffset);
            const val = readDerElement(bytes, atv.endOffset, oid.endOffset);
            if (oid.tag === 0x06) {
              const oidBytes = bytes.subarray(oid.valueOffset, oid.endOffset);
              const str = fromUtf8(bytes.subarray(val.valueOffset, val.endOffset)).trim();
              if (bytesEqual(oidBytes, OID_COMMON_NAME) && str && !cn) cn = str;
              else if (bytesEqual(oidBytes, OID_ORGANIZATION) && str && !org) org = str;
            }
          }
          attrCursor = atv.endOffset;
        }
      }
      rdnCursor = rdnSet.endOffset;
    }
  } catch {
    // ignore malformed name fields
  }
  return cn || org || "Unknown Certificate";
}

export function parseX509Certificate(certDer: Uint8Array): ParsedX509Cert {
  const fields = readTbsFields(certDer);
  if (!fields || fields.length < 6) {
    return { isCA: false, subjectSummary: "Unknown Certificate", p256PublicKeyX963: null };
  }

  let idx = 0;
  if (fields[0].tag === 0xa0) idx = 1; // optional explicit [0] version
  // serialNumber(0), signature(1), issuer(2), validity(3), subject(4), subjectPublicKeyInfo(5)
  const subjectEl = fields[idx + 4];
  const spkiEl = fields[idx + 5];
  const subjectSummary = subjectEl?.tag === 0x30 ? parseNameSummary(certDer, subjectEl) : "Unknown Certificate";

  let p256PublicKeyX963: Uint8Array | null = null;
  if (spkiEl?.tag === 0x30) {
    try {
      const algSeq = readDerElement(certDer, spkiEl.endOffset, spkiEl.valueOffset);
      const spkBitString = readDerElement(certDer, spkiEl.endOffset, algSeq.endOffset);
      if (algSeq.tag === 0x30 && spkBitString.tag === 0x03 && spkBitString.valueLength === 66) {
        const algOid = readDerElement(certDer, algSeq.endOffset, algSeq.valueOffset);
        const paramOid = algOid.endOffset < algSeq.endOffset
          ? readDerElement(certDer, algSeq.endOffset, algOid.endOffset)
          : null;
        if (
          algOid.tag === 0x06 &&
          bytesEqual(certDer.subarray(algOid.valueOffset, algOid.endOffset), OID_EC_PUBLIC_KEY) &&
          paramOid?.tag === 0x06 &&
          bytesEqual(certDer.subarray(paramOid.valueOffset, paramOid.endOffset), OID_PRIME256V1) &&
          certDer[spkBitString.valueOffset] === 0x00 &&
          certDer[spkBitString.valueOffset + 1] === 0x04
        ) {
          p256PublicKeyX963 = certDer.slice(spkBitString.valueOffset + 1, spkBitString.endOffset);
        }
      }
    } catch {
      p256PublicKeyX963 = null;
    }
  }

  let isCA = false;
  for (const field of fields) {
    if (field.tag !== 0xa3) continue;
    try {
      const extSeq = readDerElement(certDer, field.endOffset, field.valueOffset);
      if (extSeq.tag !== 0x30) break;
      let extCursor = extSeq.valueOffset;
      while (extCursor < extSeq.endOffset) {
        const ext = readDerElement(certDer, extSeq.endOffset, extCursor);
        if (ext.tag !== 0x30) break;
        const oid = readDerElement(certDer, ext.endOffset, ext.valueOffset);
        if (
          oid.tag === 0x06 &&
          bytesEqual(certDer.subarray(oid.valueOffset, oid.endOffset), OID_BASIC_CONSTRAINTS)
        ) {
          let next = readDerElement(certDer, ext.endOffset, oid.endOffset);
          if (next.tag === 0x01) {
            next = readDerElement(certDer, ext.endOffset, next.endOffset);
          }
          if (next.tag === 0x04) {
            const bcSeq = readDerElement(certDer, next.endOffset, next.valueOffset);
            if (bcSeq.tag === 0x30 && bcSeq.valueLength > 0) {
              const caBool = readDerElement(certDer, bcSeq.endOffset, bcSeq.valueOffset);
              if (caBool.tag === 0x01 && caBool.valueLength === 1) {
                isCA = certDer[caBool.valueOffset] !== 0x00;
              }
            }
          }
          break;
        }
        extCursor = ext.endOffset;
      }
    } catch {
      // ignore extension errors
    }
  }

  return { isCA, subjectSummary, p256PublicKeyX963 };
}
