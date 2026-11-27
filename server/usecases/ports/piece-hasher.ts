// SHA-1 over a stream of chunks, for torrent piece verification. Workers hashes
// through crypto.DigestStream and Node through createHash, so a piece is never
// buffered whole.
export interface Sha1Hasher {
  update(chunk: Uint8Array): Promise<void>
  digest(): Promise<Uint8Array>
}

export interface PieceHasherGateway {
  sha1(): Sha1Hasher
}
