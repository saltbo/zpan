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
