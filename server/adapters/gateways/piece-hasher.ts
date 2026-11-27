import { createHash } from 'node:crypto'
import type { PieceHasherGateway, Sha1Hasher } from '../../usecases/ports'

// crypto.DigestStream exists only on Cloudflare Workers.
interface DigestStreamLike extends WritableStream<Uint8Array> {
  readonly digest: Promise<ArrayBuffer>
}
type DigestStreamConstructor = new (algorithm: string) => DigestStreamLike

function digestStreamConstructor(): DigestStreamConstructor | null {
  // SAFETY: the standard Crypto type lacks the Workers-only DigestStream; the
  // typeof check below confirms it before use.
  const candidate = (globalThis.crypto as unknown as { DigestStream?: DigestStreamConstructor }).DigestStream
  return typeof candidate === 'function' ? candidate : null
}

function workersHasher(DigestStream: DigestStreamConstructor): Sha1Hasher {
  const stream = new DigestStream('SHA-1')
  const writer = stream.getWriter()
  return {
    async update(chunk) {
      await writer.write(chunk)
    },
    async digest() {
      await writer.close()
      return new Uint8Array(await stream.digest)
    },
  }
}

function nodeHasher(): Sha1Hasher {
  const hash = createHash('sha1')
  return {
    async update(chunk) {
      hash.update(chunk)
    },
    async digest() {
      return new Uint8Array(hash.digest())
    },
  }
}

export function createPieceHasherGateway(): PieceHasherGateway {
  return {
    sha1() {
      const DigestStream = digestStreamConstructor()
      return DigestStream ? workersHasher(DigestStream) : nodeHasher()
    },
  }
}
