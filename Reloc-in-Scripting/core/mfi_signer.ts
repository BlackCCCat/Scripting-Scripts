import {
  OID_EC_PUBLIC_KEY,
  OID_PRIME256V1,
  extractEcP256PrivateScalar,
  extractPkcs7Certificates,
  parseX509Certificate,
  unwrapDerOrPem,
  unwrapPkcs8PrivateKey,
} from "./asn1";
import { bytesEqual } from "./bytes";
import { deriveP256PublicKeyX963, p256SignDigest, p256VerifyDigest } from "./p256";

const MAX_IDENTITY_BYTES = 16 * 1024;

export class MFiSigner {
  readonly certificateContainerData: Uint8Array;
  readonly leafSubjectSummary: string;
  readonly certificateCount: number;
  readonly leafPublicKeyX963: Uint8Array;
  private readonly privateScalar: Uint8Array;

  constructor(certificateBytes: Uint8Array, privateKeyBytes: Uint8Array) {
    const certUnwrapped = unwrapDerOrPem(certificateBytes);
    const keyUnwrapped = unwrapDerOrPem(privateKeyBytes);
    const pkcs7Der = certUnwrapped.der;
    const keyDer = keyUnwrapped.der;

    if (
      pkcs7Der.length === 0 ||
      pkcs7Der.length > MAX_IDENTITY_BYTES ||
      keyDer.length === 0 ||
      keyDer.length > MAX_IDENTITY_BYTES
    ) {
      throw new Error("MFi 凭据文件大小必须在 1 ~ 16384 字节之间");
    }

    const certDers = extractPkcs7Certificates(pkcs7Der);

    let scalarD: Uint8Array;
    if (keyUnwrapped.label === "EC PRIVATE KEY") {
      scalarD = extractEcP256PrivateScalar(keyDer);
    } else {
      const { algorithmOID, parameterOID, innerKeyData } = unwrapPkcs8PrivateKey(keyDer);
      if (
        !bytesEqual(algorithmOID, OID_EC_PUBLIC_KEY) ||
        !parameterOID ||
        !bytesEqual(parameterOID, OID_PRIME256V1)
      ) {
        throw new Error("MFi 私钥必须是 EC P-256 (prime256v1) PKCS#8 格式");
      }
      scalarD = extractEcP256PrivateScalar(innerKeyData);
    }

    const derivedPub = deriveP256PublicKeyX963(scalarD);
    const testDigest = new Uint8Array(32);
    for (let i = 0; i < 32; i++) testDigest[i] = 0xa5 ^ i;
    const testSig = p256SignDigest(scalarD, testDigest);

    let matchingLeaves = 0;
    let matchedSubject = "Unknown Certificate";
    let matchedPub: Uint8Array | null = null;

    for (const certDer of certDers) {
      const parsed = parseX509Certificate(certDer);
      if (parsed.isCA || !parsed.p256PublicKeyX963) continue;
      if (
        bytesEqual(parsed.p256PublicKeyX963, derivedPub) &&
        p256VerifyDigest(parsed.p256PublicKeyX963, testDigest, testSig)
      ) {
        matchingLeaves++;
        if (matchingLeaves === 1) {
          matchedSubject = parsed.subjectSummary;
          matchedPub = parsed.p256PublicKeyX963;
        }
      }
    }

    if (matchingLeaves !== 1 || !matchedPub) {
      throw new Error("私钥与 PKCS#7 中的非 CA P-256 叶子证书不匹配");
    }

    this.certificateContainerData = pkcs7Der.slice();
    this.leafSubjectSummary = matchedSubject;
    this.certificateCount = certDers.length;
    this.leafPublicKeyX963 = matchedPub;
    this.privateScalar = scalarD.slice();
  }

  signChallenge(challenge: Uint8Array): Uint8Array {
    if (challenge.length !== 32) {
      throw new Error("MFi-v3 challenge must be exactly 32 bytes (prehashed SHA-256)");
    }
    return p256SignDigest(this.privateScalar, challenge);
  }

  verifyRawSignature(rawRS: Uint8Array, challenge: Uint8Array): boolean {
    return p256VerifyDigest(this.leafPublicKeyX963, challenge, rawRS);
  }
}
