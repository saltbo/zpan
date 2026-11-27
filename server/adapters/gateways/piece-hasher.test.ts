import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createPieceHasherGateway } from './piece-hasher'

const expected = createHash('sha1').update('hello world').digest()

async function hash(): Promise<Uint8Array> {
  const hasher = createPieceHasherGateway().sha1()
  await hasher.update(new TextEncoder().encode('hello '))
  await hasher.update(new TextEncoder().encode('world'))
  return hasher.digest()
}

// Stands in for the Workers-only crypto.DigestStream.
class FakeDigestStream extends WritableStream<Uint8Array> {
  static instances = 0
  readonly digest: Promise<ArrayBuffer>

  constructor(algorithm: string) {
    const hash = createHash(algorithm.replace('-', '').toLowerCase())
    let resolve: (value: ArrayBuffer) => void = () => {}
    super({
      write(chunk) {
        hash.update(chunk)
      },
      close() {
        const out = hash.digest()
        resolve(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength))
      },
    })
    this.digest = new Promise((done) => {
      resolve = done
    })
    FakeDigestStream.instances++
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis.crypto, 'DigestStream')
})

describe('createPieceHasherGateway', () => {
  it('hashes with node:crypto where DigestStream is missing', async () => {
    expect(Buffer.from(await hash())).toEqual(expected)
  })

  it('hashes through crypto.DigestStream where the runtime has it', async () => {
    Object.defineProperty(globalThis.crypto, 'DigestStream', { value: FakeDigestStream, configurable: true })
    const before = FakeDigestStream.instances
    expect(Buffer.from(await hash())).toEqual(expected)
    expect(FakeDigestStream.instances).toBe(before + 1)
  })
})
