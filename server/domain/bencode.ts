// A bencode decoder (BEP 3) for torrent info dictionaries. Byte strings stay as
// bytes, because piece hashes and non-UTF-8 names are binary; dictionaries keep
// their keys as UTF-8 strings. Decoding is strict: the input must be exactly one
// value, integers must be canonical, and dictionary keys must be sorted, so the
// bytes that are hashed are the bytes that were decoded.

export type BencodeValue = number | Uint8Array | BencodeValue[] | BencodeDict
export interface BencodeDict {
  [key: string]: BencodeValue
}

export class BencodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BencodeError'
  }
}

const CHAR_D = 0x64 // d
const CHAR_E = 0x65 // e
const CHAR_I = 0x69 // i
const CHAR_L = 0x6c // l
const CHAR_COLON = 0x3a
const CHAR_MINUS = 0x2d
const CHAR_0 = 0x30
const CHAR_9 = 0x39
const MAX_DEPTH = 64

const utf8 = new TextDecoder('utf-8', { fatal: true })

export function decodeBencode(bytes: Uint8Array): BencodeValue {
  let pos = 0

  const fail = (message: string): never => {
    throw new BencodeError(`${message} at byte ${pos}`)
  }

  const readDigits = (terminator: number): string => {
    const start = pos
    while (pos < bytes.length && bytes[pos] !== terminator && pos - start <= 20) pos++
    if (pos >= bytes.length || bytes[pos] !== terminator) fail('Unterminated number')
    const text = String.fromCharCode(...bytes.subarray(start, pos))
    pos++ // terminator
    return text
  }

  const readString = (): Uint8Array => {
    const text = readDigits(CHAR_COLON)
    if (!/^(0|[1-9][0-9]*)$/.test(text)) fail('Invalid string length')
    const length = Number(text)
    if (!Number.isSafeInteger(length) || pos + length > bytes.length) fail('String runs past the end')
    const value = bytes.subarray(pos, pos + length)
    pos += length
    return value
  }

  const readValue = (depth: number): BencodeValue => {
    if (depth > MAX_DEPTH) fail('Nesting too deep')
    if (pos >= bytes.length) fail('Unexpected end')
    const byte = bytes[pos]
    if (byte === CHAR_I) {
      pos++
      const text = readDigits(CHAR_E)
      if (!/^(0|-?[1-9][0-9]*)$/.test(text)) fail('Invalid integer')
      const value = Number(text)
      if (!Number.isSafeInteger(value)) fail('Integer out of range')
      return value
    }
    if (byte === CHAR_L) {
      pos++
      const list: BencodeValue[] = []
      while (bytes[pos] !== CHAR_E) {
        if (pos >= bytes.length) fail('Unterminated list')
        list.push(readValue(depth + 1))
      }
      pos++
      return list
    }
    if (byte === CHAR_D) {
      pos++
      const dict: BencodeDict = Object.create(null)
      let previous: Uint8Array | null = null
      while (bytes[pos] !== CHAR_E) {
        if (pos >= bytes.length) fail('Unterminated dictionary')
        const keyBytes = readString()
        if (previous && compareBytes(previous, keyBytes) >= 0) fail('Dictionary keys are not sorted')
        previous = keyBytes
        let key: string
        try {
          key = utf8.decode(keyBytes)
        } catch {
          return fail('Dictionary key is not UTF-8')
        }
        dict[key] = readValue(depth + 1)
      }
      pos++
      return dict
    }
    if (byte >= CHAR_0 && byte <= CHAR_9) return readString()
    if (byte === CHAR_MINUS) fail('Invalid string length')
    return fail('Unexpected byte')
  }

  const value = readValue(0)
  if (pos !== bytes.length) fail('Trailing bytes')
  return value
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

export function isBencodeDict(value: BencodeValue | undefined): value is BencodeDict {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)
}

export function bencodeText(value: BencodeValue | undefined): string | null {
  if (!(value instanceof Uint8Array)) return null
  try {
    return utf8.decode(value)
  } catch {
    return null
  }
}

export type BencodeInput = number | string | Uint8Array | BencodeInput[] | { [key: string]: BencodeInput }

// Encodes a value back to bytes; used by tests and by tools that build torrents.
// Strings are written as their UTF-8 bytes.
export function encodeBencode(value: BencodeInput): Uint8Array {
  const chunks: Uint8Array[] = []
  const encoder = new TextEncoder()
  const push = (text: string) => chunks.push(encoder.encode(text))
  const write = (item: BencodeInput): void => {
    if (typeof item === 'string') {
      const bytes = encoder.encode(item)
      push(`${bytes.length}:`)
      chunks.push(bytes)
    } else if (typeof item === 'number') {
      if (!Number.isSafeInteger(item)) throw new BencodeError('Only integers can be encoded')
      push(`i${item}e`)
    } else if (item instanceof Uint8Array) {
      push(`${item.length}:`)
      chunks.push(item)
    } else if (Array.isArray(item)) {
      push('l')
      for (const entry of item) write(entry)
      push('e')
    } else {
      push('d')
      const keys = Object.keys(item).sort((a, b) => compareBytes(encoder.encode(a), encoder.encode(b)))
      for (const key of keys) {
        write(key)
        write(item[key])
      }
      push('e')
    }
  }
  write(value)
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
