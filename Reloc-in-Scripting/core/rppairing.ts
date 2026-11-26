import {
  concat,
  fromBase64,
  fromUtf8,
  readU16BE,
  toBase64,
  u16be,
  u64le,
  utf8,
} from "./bytes";
import {
  chachaOpen,
  chachaSeal,
  ed25519Sign,
  generateX25519,
  hkdfSha512,
  x25519SharedSecret,
} from "./crypto_utils";
import { debugLog } from "./debug";
import type { PairingRecord } from "./pairing";
import { BufferedReader, writeAll, type ByteStream } from "./stream";
import { decodeTLV8, encodeTLV8, errorCode, hasError, TLV8Type } from "./tlv8";

const FRAME_MAGIC = utf8("RPPairing");
const WIRE_PROTOCOL_VERSION = 19;
const PAIR_VERIFY_SALT = utf8("Pair-Verify-Encrypt-Salt");
const PAIR_VERIFY_INFO = utf8("Pair-Verify-Encrypt-Info");
const CLIENT_ENCRYPT_INFO = utf8("ClientEncrypt-main");
const SERVER_ENCRYPT_INFO = utf8("ServerEncrypt-main");
const EMPTY = new Uint8Array(0);

function pairVerifyNonce(step: number): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce.set(utf8(`PV-Msg0${step}`), 4);
  return nonce;
}

function streamNonce(sequence: number): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce.set(u64le(sequence), 0);
  return nonce;
}

export class PairVerifyRejected extends Error {
  constructor(readonly code: number | null, message: string) {
    super(message);
  }
}

export class RpPairingSocket {
  private sequence = 0;
  private readonly reader: BufferedReader;

  constructor(
    private readonly stream: ByteStream,
    private readonly originatedBy: "host" | "device" = "host",
  ) {
    this.reader = new BufferedReader(stream);
  }

  private async sendFrame(value: unknown): Promise<void> {
    const body = utf8(JSON.stringify(value));
    if (body.length > 0xffff) throw new Error("RPPairing 帧超过 65535 字节");
    await writeAll(this.stream, concat(FRAME_MAGIC, u16be(body.length), body));
  }

  async sendPlain(value: unknown): Promise<void> {
    await this.sendFrame({
      message: { plain: { _0: value } },
      originatedBy: this.originatedBy,
      sequenceNumber: this.sequence,
    });
    this.sequence += 1;
  }

  async sendEncrypted(ciphertext: Uint8Array): Promise<void> {
    await this.sendFrame({
      message: { streamEncrypted: { _0: toBase64(ciphertext) } },
      originatedBy: this.originatedBy,
      sequenceNumber: this.sequence,
    });
    this.sequence += 1;
  }

  async receive(): Promise<any> {
    const magic = await this.reader.readExact(FRAME_MAGIC.length);
    for (let i = 0; i < FRAME_MAGIC.length; i++) {
      if (magic[i] !== FRAME_MAGIC[i]) {
        throw new Error(`不是 RemotePairing 服务（帧头为 ${fromUtf8(magic).replace(/[^\x20-\x7e]/g, ".")}）`);
      }
    }
    const length = readU16BE(await this.reader.readExact(2), 0);
    const body = await this.reader.readExact(length);
    const json = JSON.parse(fromUtf8(body));
    const plain = json?.message?.plain?._0;
    return plain !== undefined ? plain : json?.message;
  }

  close(): Promise<void> {
    return this.stream.close();
  }
}

export interface PeerHandshakeInfo {
  wireProtocolVersion?: number;
  minimumWireProtocolVersion?: number;
  allowsIncomingTunnelConnections?: boolean;
  allowsPairSetup?: boolean;
}

export class RemotePairingClient {
  private encryptedSequence = 0;
  private clientKey: Uint8Array = EMPTY;
  private serverKey: Uint8Array = EMPTY;
  private sharedSecret: Uint8Array = EMPTY;

  constructor(private readonly socket: RpPairingSocket) {}

  async close(): Promise<void> {
    this.clientKey.fill(0);
    this.serverKey.fill(0);
    this.sharedSecret.fill(0);
    await this.socket.close();
  }

  get preSharedKey(): Uint8Array {
    if (this.sharedSecret.length === 0) throw new Error("尚未完成 pair-verify");
    return this.sharedSecret;
  }

  async attemptPairVerify(): Promise<PeerHandshakeInfo> {
    await this.socket.sendPlain({
      request: {
        _0: {
          handshake: {
            _0: {
              hostOptions: { attemptPairVerify: true },
              wireProtocolVersion: WIRE_PROTOCOL_VERSION,
            },
          },
        },
      },
    });

    const response = await this.socket.receive();
    const handshake = response?.response?._1?.handshake?._0;
    if (!handshake) throw new Error("设备未返回握手响应");

    debugLog("pair", "握手响应", JSON.stringify(handshake).slice(0, 400));

    const options = handshake.deviceOptions ?? {};
    const info: PeerHandshakeInfo = {
      wireProtocolVersion: handshake.wireProtocolVersion,
      minimumWireProtocolVersion: handshake.minimumSupportedWireProtocolVersion,
      allowsIncomingTunnelConnections: options.allowsIncomingTunnelConnections,
      allowsPairSetup: options.allowsPairSetup,
    };

    if (info.allowsIncomingTunnelConnections === false) {
      throw new Error("设备声明不接受隧道连接（allowsIncomingTunnelConnections=false）。");
    }

    return info;
  }

  async validatePairing(record: PairingRecord): Promise<void> {
    const ephemeral = await generateX25519();

    await this.sendPairingData({
      data: toBase64(
        encodeTLV8([
          { type: TLV8Type.State, data: new Uint8Array([0x01]) },
          { type: TLV8Type.PublicKey, data: ephemeral.publicKey },
        ]),
      ),
      kind: "verifyManualPairing",
      startNewSession: true,
    });

    const m2 = decodeTLV8(await this.receivePairingData());
    if (hasError(m2)) {
      throw new PairVerifyRejected(errorCode(m2), "设备拒绝了这次 pair-verify");
    }
    const m2State = m2.get(TLV8Type.State);
    if (m2State?.length !== 1 || m2State[0] !== 2) throw new Error("pair-verify M2 状态无效");
    const devicePublicKey = m2.get(TLV8Type.PublicKey);
    if (!devicePublicKey || devicePublicKey.length !== 32) {
      throw new Error("设备未返回有效的临时公钥");
    }

    this.sharedSecret = await x25519SharedSecret(ephemeral.privateKey, devicePublicKey);
    const sessionKey = await hkdfSha512(this.sharedSecret, PAIR_VERIFY_SALT, PAIR_VERIFY_INFO);

    const identifier = utf8(record.identifier);
    const signature = await ed25519Sign(
      record.privateKey,
      concat(ephemeral.publicKey, identifier, devicePublicKey),
    );
    const inner = encodeTLV8([
      { type: TLV8Type.Identifier, data: identifier },
      { type: TLV8Type.Signature, data: signature },
    ]);
    const encrypted = await chachaSeal(sessionKey, pairVerifyNonce(3), inner);

    await this.sendPairingData({
      data: toBase64(
        encodeTLV8([
          { type: TLV8Type.State, data: new Uint8Array([0x03]) },
          { type: TLV8Type.EncryptedData, data: encrypted },
        ]),
      ),
      kind: "verifyManualPairing",
      startNewSession: false,
    });

    const m4 = decodeTLV8(await this.receivePairingData());
    if (hasError(m4)) {
      await this.sendPairVerifyFailed();
      throw new PairVerifyRejected(
        errorCode(m4),
        "配对记录校验未通过，请重新配对这台 iPhone 或重新导入配对文件。",
      );
    }

    const m4State = m4.get(TLV8Type.State);
    if (m4State?.length !== 1 || m4State[0] !== 4) throw new Error("pair-verify M4 状态无效");

    this.clientKey = await hkdfSha512(this.sharedSecret, EMPTY, CLIENT_ENCRYPT_INFO);
    this.serverKey = await hkdfSha512(this.sharedSecret, EMPTY, SERVER_ENCRYPT_INFO);
  }

  async createTcpListener(options: { peerConnectionsInfo?: boolean } = {}): Promise<number> {
    const listener: Record<string, unknown> = {
      key: toBase64(this.preSharedKey),
      transportProtocolType: "tcp",
    };
    if (options.peerConnectionsInfo) {
      listener.peerConnectionsInfo = [{ owningPID: 1, owningProcessName: "CoreDeviceService" }];
    }
    const response = await this.sendEncryptedRequest({ request: { _0: { createListener: listener } } });
    const port = response?.createListener?.port;
    if (typeof port !== "number" || port <= 0) throw new Error("设备未返回隧道端口");
    return port;
  }

  private async sendPairingData(payload: Record<string, unknown>): Promise<void> {
    await this.socket.sendPlain({ event: { _0: { pairingData: { _0: payload } } } });
  }

  private async receivePairingData(): Promise<Uint8Array> {
    const response = await this.socket.receive();
    const event = response?.event?._0 ?? response;
    const data = event?.pairingData?._0?.data ?? event?.pairingData?.data;
    if (typeof data !== "string") {
      throw new Error(`设备返回了意外的配对响应：${JSON.stringify(response).slice(0, 160)}`);
    }
    return fromBase64(data);
  }

  private async sendPairVerifyFailed(): Promise<void> {
    try {
      await this.socket.sendPlain({ event: { _0: { pairVerifyFailed: {} } } });
    } catch {
      // ignore
    }
  }

  private async sendEncryptedRequest(request: unknown): Promise<any> {
    if (this.clientKey.length === 0) throw new Error("尚未完成 pair-verify");
    const nonce = streamNonce(this.encryptedSequence);
    const ciphertext = await chachaSeal(this.clientKey, nonce, utf8(JSON.stringify(request)));
    await this.socket.sendEncrypted(ciphertext);

    const message = await this.socket.receive();
    const encoded = message?.streamEncrypted?._0;
    if (typeof encoded !== "string") throw new Error("设备未返回加密响应");

    const plaintext = await chachaOpen(this.serverKey, nonce, fromBase64(encoded));
    this.encryptedSequence += 1;

    const value = JSON.parse(fromUtf8(plaintext));
    const result = value?.response?._1;
    if (result === undefined) throw new Error("加密响应缺少 response._1");
    return result;
  }
}
