export type TLSPacket = {
  header: Uint8Array
  content: Uint8Array
}

export type TLSClient = {
  getMetadata(): {
    cipherSuite?: string
    keyType?: string
    version?: string
    selectedAlpn?: string
  }
  isHandshakeDone(): boolean
  startHandshake(): Promise<void>
  handleReceivedBytes(data: Uint8Array): Promise<void>
  write(data: Uint8Array): Promise<void>
  end(error?: Error): Promise<void>
}

export function makeTLSClient(options: Record<string, unknown>): TLSClient
export function setCryptoImplementation(implementation: unknown): void
export const webcryptoCrypto: unknown
