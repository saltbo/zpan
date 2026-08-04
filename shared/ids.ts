import { customAlphabet } from 'nanoid'

export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const BASE62_PATTERN = /^[A-Za-z0-9]+$/
export const DEFAULT_ID_LENGTH = 22

const randomBase62 = customAlphabet(BASE62_ALPHABET)

export function generateId(length = DEFAULT_ID_LENGTH): string {
  return randomBase62(length)
}

export function generateToken(length: number): string {
  return randomBase62(length)
}

export function isBase62(value: string): boolean {
  return BASE62_PATTERN.test(value)
}

export function encodeBase62Bytes(value: Uint8Array): string {
  if (value.length === 0) throw new RangeError('Base62 byte input must not be empty')
  let leadingZeros = 0
  while (leadingZeros < value.length && value[leadingZeros] === 0) leadingZeros += 1
  let integer = 0n
  for (const byte of value.subarray(leadingZeros)) integer = integer * 256n + BigInt(byte)

  let encoded = ''
  while (integer > 0n) {
    encoded = BASE62_ALPHABET[Number(integer % 62n)] + encoded
    integer /= 62n
  }
  return BASE62_ALPHABET[0].repeat(leadingZeros) + encoded
}

export function decodeBase62Bytes(value: string): Uint8Array {
  if (!isBase62(value)) throw new Error('Invalid Base62 value')
  let leadingZeros = 0
  while (leadingZeros < value.length && value[leadingZeros] === BASE62_ALPHABET[0]) leadingZeros += 1
  let integer = 0n
  for (const character of value.slice(leadingZeros)) {
    integer = integer * 62n + BigInt(BASE62_ALPHABET.indexOf(character))
  }

  const bytes: number[] = []
  while (integer > 0n) {
    bytes.push(Number(integer % 256n))
    integer /= 256n
  }
  bytes.reverse()
  return Uint8Array.from([...new Array<number>(leadingZeros).fill(0), ...bytes])
}
