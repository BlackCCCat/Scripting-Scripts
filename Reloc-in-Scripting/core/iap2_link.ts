import { concat } from "./bytes";
import { IAP2LinkFlags, IAP2Message, IAP2MessageBuffer, IAP2Packet } from "./iap2_wire";
import { BufferedReader, writeAll, type ByteStream } from "./stream";

export class IAP2LinkError extends Error {
  constructor(
    readonly kind: "timeout" | "protocol" | "reset",
    message: string,
  ) {
    super(message);
  }
}

export class IAP2Link {
  private readonly reader: BufferedReader;
  private sequence: number;
  private peerSequence = 0;
  private readonly controlSession = 1;
  private maximumPacket = 4096;
  private retransmitMs = 2000;

  private readonly messageQueue: IAP2Message[] = [];
  private readonly assembler = new IAP2MessageBuffer();
  private pendingHeader: Uint8Array | null = null;
  private closed = false;

  constructor(
    private readonly stream: ByteStream,
    private readonly emit: (event: string, details: Record<string, unknown>) => void = () => {},
  ) {
    const rand = new Uint8Array(1);
    crypto.getRandomValues(rand);
    this.sequence = rand[0];
    this.reader = new BufferedReader(stream);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stream.close().catch(() => undefined);
  }

  /**
   * 发送 iAP2 RST 复位包，通知 iOS iap2d 立即卸载外设 GPS（同步上游 Reloc v1.0.1）。
   */
  async sendReset(): Promise<void> {
    if (this.closed) return;
    const rst = new IAP2Packet({
      flags: IAP2LinkFlags.RST,
      sequence: this.sequence,
      acknowledgement: this.peerSequence,
      session: 0,
      payload: null,
    });
    await this.writePacket(rst).catch(() => undefined);
  }

  private async readPacket(timeoutMs: number): Promise<IAP2Packet | null> {
    const deadline = Date.now() + Math.max(timeoutMs, 1);

    if (!this.pendingHeader) {
      const header = await this.reader.readExactOrTimeout(9, timeoutMs);
      if (!header) return null;
      this.pendingHeader = header;
    }

    const header = this.pendingHeader;
    let totalSize: number;
    try {
      totalSize = IAP2Packet.validateHeaderData(header);
    } catch (error) {
      this.pendingHeader = null;
      throw new IAP2LinkError(
        "protocol",
        error instanceof Error ? error.message : "Malformed iAP2 header",
      );
    }

    if (totalSize === 9) {
      this.pendingHeader = null;
      return IAP2Packet.decode(header);
    }

    const remaining = Math.max(1, deadline - Date.now());
    const rest = await this.reader.readExactOrTimeout(totalSize - 9, remaining);
    if (!rest) {
      // 保留 pendingHeader，等待后续分片到齐
      return null;
    }

    this.pendingHeader = null;
    return IAP2Packet.decode(concat(header, rest));
  }

  private async writePacket(packet: IAP2Packet): Promise<void> {
    await writeAll(this.stream, packet.encode());
  }

  async handshake(): Promise<void> {
    // version=1, window=1, maxLen=4096, retry=2000ms, cumAck=22ms, maxRetrans=5, maxCumAck=1 + session(1, 0, 2)
    const offer = new Uint8Array([
      1, 1, 0x10, 0x00, 0x07, 0xd0, 0x00, 0x16, 5, 1, 1, 0, 2,
    ]);
    const syn = new IAP2Packet({
      flags: IAP2LinkFlags.SYN,
      sequence: this.sequence,
      acknowledgement: 0,
      session: 0,
      payload: offer,
    });
    const synAckMask = IAP2LinkFlags.SYN | IAP2LinkFlags.ACK;

    for (let attempt = 0; attempt < 3; attempt++) {
      await this.writePacket(syn);
      const response = await this.readPacket(2000);
      if (!response) continue;

      if ((response.flags & synAckMask) !== synAckMask) {
        throw new IAP2LinkError("protocol", "Expected SYN+ACK during iAP2 handshake");
      }
      const payload = response.payload;
      if (response.acknowledgement !== this.sequence || payload.length < 13) {
        throw new IAP2LinkError("protocol", "Invalid handshake acknowledgement or parameters");
      }

      const version = payload[0];
      const window = payload[1];
      const maxSize = (payload[2] << 8) | payload[3];
      const retryMs = (payload[4] << 8) | payload[5];
      const sessions = payload.subarray(10);

      if (version !== 1 || window < 1 || maxSize < 10 || sessions.length % 3 !== 0) {
        throw new IAP2LinkError("protocol", "Unsupported peer iAP2 link parameters");
      }

      let hasControlSession = false;
      for (let idx = 0; idx < sessions.length; idx += 3) {
        if (sessions[idx] === 1 && sessions[idx + 1] === 0 && sessions[idx + 2] === 2) {
          hasControlSession = true;
          break;
        }
      }
      if (!hasControlSession) {
        throw new IAP2LinkError("protocol", "Peer did not accept control session (1, 0, 2)");
      }

      this.maximumPacket = Math.min(maxSize, 4096);
      this.retransmitMs = Math.max(retryMs, 100);
      this.peerSequence = response.sequence;
      await this.acknowledge();

      this.emit("link_ready", {
        control_session: this.controlSession,
        max_packet: this.maximumPacket,
        retransmit_ms: retryMs,
      });
      return;
    }

    throw new IAP2LinkError("timeout", "No iAP2 SYN acknowledgement from device");
  }

  async acknowledge(): Promise<void> {
    const ack = new IAP2Packet({
      flags: IAP2LinkFlags.ACK,
      sequence: this.sequence,
      acknowledgement: this.peerSequence,
      session: 0,
      payload: null,
    });
    await this.writePacket(ack);
  }

  async accept(packet: IAP2Packet): Promise<void> {
    if ((packet.flags & IAP2LinkFlags.RST) !== 0) {
      throw new IAP2LinkError("reset", "Peer reset the iAP2 link (RST)");
    }
    if ((packet.flags & IAP2LinkFlags.SYN) !== 0) {
      if (packet.sequence !== this.peerSequence) {
        throw new IAP2LinkError("protocol", "Unexpected new SYN during established link");
      }
      await this.acknowledge();
      return;
    }
    if (packet.payload.length > 0 && (packet.flags & IAP2LinkFlags.EAK) === 0) {
      const expectedNext = (this.peerSequence + 1) & 0xff;
      if (packet.sequence === expectedNext) {
        this.peerSequence = packet.sequence;
        if (packet.session !== this.controlSession) {
          throw new IAP2LinkError("protocol", `Data received on unnegotiated session ${packet.session}`);
        }
        const assembled = this.assembler.feed(packet.payload);
        this.messageQueue.push(...assembled);
      }
      await this.acknowledge();
    }
  }

  private async waitAckForSequence(sequence: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      const incoming = await this.readPacket(remaining);
      if (!incoming) return false;
      await this.accept(incoming);
      if (
        (incoming.flags & IAP2LinkFlags.ACK) !== 0 &&
        incoming.acknowledgement === sequence
      ) {
        return true;
      }
    }
  }

  async send(message: IAP2Message): Promise<void> {
    const raw = message.encode();
    if (raw.length < 6 || raw.length > 0xffff) {
      throw new IAP2LinkError("protocol", "iAP2 message exceeds maximum length");
    }
    const chunkLimit = Math.max(1, this.maximumPacket - 10);

    let offset = 0;
    while (offset < raw.length) {
      const end = Math.min(offset + chunkLimit, raw.length);
      const chunk = raw.subarray(offset, end);
      offset = end;

      this.sequence = (this.sequence + 1) & 0xff;
      let acknowledged = false;

      for (let attempt = 1; attempt <= 6; attempt++) {
        const pkt = new IAP2Packet({
          flags: IAP2LinkFlags.ACK,
          sequence: this.sequence,
          acknowledgement: this.peerSequence,
          session: this.controlSession,
          payload: chunk,
        });
        await this.writePacket(pkt);
        acknowledged = await this.waitAckForSequence(this.sequence, this.retransmitMs);
        if (acknowledged) break;
        this.emit("retransmit", { attempt });
      }

      if (!acknowledged) {
        throw new IAP2LinkError("timeout", "Peer did not acknowledge iAP2 data packet");
      }
    }
  }

  /**
   * 停止/重连收尾阶段限时尽力发送单帧控制或 NMEA 报文（同步上游 Reloc v1.0.2），避免通道已挂起时阻塞清理。
   */
  async sendBestEffort(message: IAP2Message, timeoutMs = 250): Promise<void> {
    if (this.closed) return;
    const raw = message.encode();
    if (raw.length < 6 || raw.length > 0xffff) return;
    const chunkLimit = Math.max(1, this.maximumPacket - 10);

    let offset = 0;
    while (offset < raw.length) {
      const end = Math.min(offset + chunkLimit, raw.length);
      const chunk = raw.subarray(offset, end);
      offset = end;

      this.sequence = (this.sequence + 1) & 0xff;
      const pkt = new IAP2Packet({
        flags: IAP2LinkFlags.ACK,
        sequence: this.sequence,
        acknowledgement: this.peerSequence,
        session: this.controlSession,
        payload: chunk,
      });
      try {
        await this.writePacket(pkt);
        await this.waitAckForSequence(this.sequence, Math.min(200, timeoutMs));
      } catch {
        return;
      }
    }
  }

  async receive(timeoutMs: number): Promise<IAP2Message | null> {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    while (this.messageQueue.length === 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const packet = await this.readPacket(remaining);
      if (!packet) return null;
      await this.accept(packet);
    }
    return this.messageQueue.shift() ?? null;
  }
}
