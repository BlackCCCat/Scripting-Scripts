import { createServer, type Socket } from "node:net";
import { concat, utf8, toBase64, fromBase64 } from "./bytes";
import { hkdfSha512, chachaOpen, chachaSeal, ed25519Sign } from "./crypto_utils";
import { createSRP, equalBytes } from "./srp";
import { encode, decode, type OpackValue } from "./opack";
import { pairingTXT } from "./bonjour";
import { RpPairingSocket } from "./rppairing";
import { wrapSocket } from "./tcp";
import { delay, withTimeout } from "./stream";
import { debugLog, describeError } from "./debug";
import { decodeTLV8, encodeTLV8, TLV8Type as T, hasError, type TLV8Entry } from "./tlv8";
import type { PairingRecord } from "./pairing";

export interface PairingHostIdentity {
  identifier: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  hostAltIRK: Uint8Array;
}

export type PairSetupEvent =
  | { type: "ready"; identifier: string; port: number }
  | { type: "connected" }
  | { type: "pin"; pin: string }
  | { type: "status"; message: string };

export async function createHostIdentity(): Promise<PairingHostIdentity> {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const privateDER = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey) as ArrayBuffer);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  if (privateDER.length !== 48 || publicKey.length !== 32) throw new Error("无法生成配对身份");
  const privateKey = privateDER.slice(16);
  privateDER.fill(0);
  return {
    identifier: crypto.randomUUID().toUpperCase(),
    privateKey,
    publicKey,
    hostAltIRK: crypto.getRandomValues(new Uint8Array(16)),
  };
}

export function createPIN(): string {
  const sample = new Uint32Array(1);
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= 4_294_000_000);
  const pin = String(sample[0] % 1_000_000).padStart(6, "0");
  sample.fill(0);
  return pin;
}

function nonce(step: number) {
  return concat(new Uint8Array(4), utf8(`PS-Msg0${step}`));
}

async function acceptPairing(
  socket: RpPairingSocket,
  host: PairingHostIdentity,
  pin: string,
): Promise<PairingRecord> {
  let sessionKey: Uint8Array | undefined;
  let cipher: Uint8Array | undefined;
  let plain: Uint8Array | undefined;

  async function send(entries: TLV8Entry[]) {
    await socket.sendPlain({
      event: {
        _0: {
          pairingData: {
            _0: {
              data: toBase64(encodeTLV8(entries)),
              startNewSession: false,
              kind: "setupManualPairing",
            },
          },
        },
      },
    });
  }

  async function receive(state: number) {
    const value = await socket.receive();
    const encoded = value?.event?._0?.pairingData?._0?.data;
    if (typeof encoded !== "string" || encoded.length > 65535) throw new Error("无效的配对消息");
    const tlv = decodeTLV8(fromBase64(encoded));
    const states = tlv.get(T.State);
    if (hasError(tlv) || states?.length !== 1 || states[0] !== state) throw new Error("配对状态不匹配");
    return tlv;
  }

  try {
    const request = await socket.receive();
    const handshake = request?.request?._0?.handshake?._0;
    if (!handshake || handshake.hostOptions?.attemptPairVerify === true) {
      throw new Error("仅支持设备发起的首次配对");
    }
    await socket.sendPlain({
      response: {
        forRequestIdentifier: 0,
        _1: {
          handshake: {
            _0: {
              wireProtocolVersion: 26,
              minimumSupportedWireProtocolVersion: 8,
              deviceOptions: {
                allowsPairSetup: true,
                allowsPinlessPairing: false,
                allowsIncomingTunnelConnections: false,
                allowsUpgradeOfLockdownPairings: false,
                allowsSharingSensitiveInfo: false,
              },
              peerDeviceInfo: {
                udid: "",
                deviceKVSIncludesSensitiveInfo: false,
                identifier: "",
                name: "Reloc",
                model: "Mac17,7",
              },
            },
          },
        },
      },
    });

    await receive(1);
    const challenge = await createSRP(pin);
    await send([
      { type: T.State, data: new Uint8Array([2]) },
      { type: T.Salt, data: challenge.salt },
      { type: T.PublicKey, data: challenge.publicKey },
    ]);

    const m3 = await receive(3);
    const A = m3.get(T.PublicKey);
    const proof = m3.get(T.Proof);
    if (!A || proof?.length !== 64) throw new Error("无效的 SRP 证明");
    const reply = await challenge.prove(A);
    sessionKey = reply.key;
    if (!equalBytes(proof, reply.clientProof)) {
      await send([
        { type: T.State, data: new Uint8Array([4]) },
        { type: T.ErrorResponse, data: new Uint8Array([2]) },
      ]);
      throw new Error("配对码不匹配，请重试");
    }
    await send([
      { type: T.State, data: new Uint8Array([4]) },
      { type: T.Proof, data: reply.serverProof },
    ]);

    cipher = await hkdfSha512(sessionKey, utf8("Pair-Setup-Encrypt-Salt"), utf8("Pair-Setup-Encrypt-Info"));
    const m5 = await receive(5);
    const encrypted = m5.get(T.EncryptedData);
    if (!encrypted || encrypted.length < 16) throw new Error("缺少设备身份");
    plain = await chachaOpen(cipher, nonce(5), encrypted);

    const identity = decodeTLV8(plain);
    const infoBytes = identity.get(T.Info);
    if (!infoBytes) throw new Error("缺少设备身份信息");
    const info = decode(infoBytes) as { [key: string]: OpackValue };
    if (
      !info ||
      typeof info !== "object" ||
      Array.isArray(info) ||
      info instanceof Uint8Array ||
      !(info.altIRK instanceof Uint8Array) ||
      info.altIRK.length !== 16
    ) {
      throw new Error("设备身份信息无效");
    }
    for (const field of ["accountID", "model", "name", "remotepairing_udid"]) {
      const value = info[field];
      if (typeof value !== "string" || utf8(value).length > 1024 || value.includes("\0")) {
        throw new Error("设备身份字段无效");
      }
    }

    const deviceIRK = info.altIRK.slice();
    const accessoryX = await hkdfSha512(
      sessionKey,
      utf8("Pair-Setup-Accessory-Sign-Salt"),
      utf8("Pair-Setup-Accessory-Sign-Info"),
    );
    let signature: Uint8Array;
    try {
      signature = await ed25519Sign(
        host.privateKey,
        concat(accessoryX, utf8(host.identifier), host.publicKey),
      );
    } finally {
      accessoryX.fill(0);
    }

    const m6 = encodeTLV8([
      { type: T.Identifier, data: utf8(host.identifier) },
      { type: T.PublicKey, data: host.publicKey },
      { type: T.Signature, data: signature },
      {
        type: T.Info,
        data: encode({
          altIRK: host.hostAltIRK,
          btAddr: "11:22:33:44:55:66",
          mac: new Uint8Array([17, 34, 51, 68, 85, 102]),
          remotepairing_serial_number: "AAAAAAAAAAAA",
          accountID: host.identifier,
          remotepairing_udid: "",
          model: "Mac17,7",
          name: "Reloc",
        }),
      },
    ]);

    try {
      await send([
        { type: T.EncryptedData, data: await chachaSeal(cipher, nonce(6), m6) },
        { type: T.State, data: new Uint8Array([6]) },
      ]);
    } finally {
      m6.fill(0);
    }

    // 留出极短窗口让系统设置完成信任写入
    await delay(600);

    return {
      identifier: host.identifier,
      privateKey: host.privateKey.slice(),
      publicKey: host.publicKey.slice(),
      altIrk: deviceIRK,
      hostAltIrk: host.hostAltIRK.slice(),
      deviceName: typeof info.name === "string" ? info.name : "",
      deviceUDID: typeof info.remotepairing_udid === "string" ? info.remotepairing_udid : "",
    };
  } finally {
    sessionKey?.fill(0);
    cipher?.fill(0);
    plain?.fill(0);
  }
}

export interface OnDevicePairingHandle {
  promise: Promise<PairingRecord>;
  cancel: (reason?: string) => void;
}

export function startOnDevicePairing(
  host: PairingHostIdentity,
  pin: string,
  onEvent: (event: PairSetupEvent) => void,
): OnDevicePairingHandle {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error("配对码必须是 6 位数字");
  }

  const sockets = new Set<Socket>();
  let publication: BonjourPublication | undefined;
  let active = false;
  let attempts = 0;
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let done!: (record: PairingRecord) => void;
  let fail!: (error: Error) => void;
  const result = new Promise<PairingRecord>((resolve, reject) => {
    done = resolve;
    fail = reject;
  });
  void result.catch(() => undefined);

  const server = createServer({ noDelay: true }, (socket) => {
    if (ended || active || attempts >= 3) {
      socket.destroy();
      return;
    }
    active = true;
    attempts++;
    sockets.add(socket);
    debugLog("pairsetup", `设备连入，第 ${attempts} 次尝试`);
    onEvent({ type: "connected" });
    onEvent({ type: "pin", pin });

    const stream = wrapSocket(socket);
    void withTimeout(acceptPairing(new RpPairingSocket(stream, "device"), host, pin), 90000, "配对握手超时")
      .then(
        (record) => {
          debugLog("pairsetup", "配对握手成功");
          if (ended) record.privateKey.fill(0);
          else {
            ended = true;
            done(record);
          }
        },
        (error) => {
          debugLog("pairsetup", `第 ${attempts} 次配对失败`, describeError(error));
          if (!ended) {
            if (attempts >= 3) {
              ended = true;
              fail(new Error("配对失败次数过多，请重新开始"));
            } else {
              onEvent({
                type: "status",
                message: error instanceof Error ? error.message : "配对失败，请重试",
              });
            }
          }
        },
      )
      .finally(() => {
        socket.destroy();
        sockets.delete(socket);
        active = false;
      });
  });

  server.maxConnections = 1;
  server.on("error", (error) => {
    if (!ended) {
      ended = true;
      fail(error);
    }
  });

  function cleanup() {
    ended = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    try {
      publication?.stop();
    } catch {
      // ignore
    }
    for (const socket of sockets) socket.destroy();
    if (server.listening || server.address()) {
      try {
        server.close();
      } catch {
        // ignore
      }
    }
  }

  const promise = (async () => {
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen({ port: 0 }, () => {
            server.removeListener("error", reject);
            resolve();
          });
        }),
        10000,
        "启动配对监听超时",
      );

      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("没有可用的配对监听端口");
      }

      if (typeof Bonjour === "undefined" || typeof Bonjour.publish !== "function") {
        throw new Error("当前环境不支持 Bonjour 本地广播");
      }

      publication = await Bonjour.publish({
        name: host.identifier,
        type: "_remotepairing-pairable-host._tcp",
        port: address.port,
        txtRecord: pairingTXT(host.identifier, host.hostAltIRK),
        includePeerToPeer: true,
      });

      debugLog("pairsetup", `已广播 _remotepairing-pairable-host._tcp 端口 ${address.port}`);
      onEvent({ type: "ready", identifier: host.identifier, port: address.port });
      onEvent({ type: "pin", pin });

      timer = setTimeout(() => {
        if (!ended) {
          ended = true;
          fail(new Error("等待配对超时，请返回 Reloc 重试"));
        }
      }, 300_000);

      return await result;
    } finally {
      cleanup();
    }
  })();

  return {
    promise,
    cancel: (reason = "已取消配对") => {
      if (!ended) {
        ended = true;
        fail(new Error(reason));
      }
      cleanup();
    },
  };
}
