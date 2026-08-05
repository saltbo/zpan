import { customAlphabet } from 'nanoid'

export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const BASE62_PATTERN = /^[A-Za-z0-9]+$/
export const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]+$/
export const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/
export const DEFAULT_ID_LENGTH = 22
export const PUBLIC_TOKEN_RANDOM_LENGTH = 11
export const PUBLIC_TOKEN_LENGTH = 1 + PUBLIC_TOKEN_RANDOM_LENGTH
export const SHARE_TOKEN_PREFIX = 's'
export const IMAGE_TOKEN_PREFIX = 'i'
export const SHARE_TOKEN_PATTERN = /^s[A-Za-z0-9]{11}$/
export const IMAGE_TOKEN_PATTERN = /^i[A-Za-z0-9]{11}$/
export const LEGACY_DIRECT_SHARE_TOKEN_PATTERN = /^ds_[A-Za-z0-9_-]+$/
export const LEGACY_IMAGE_TOKEN_PATTERN = /^ih[A-Za-z0-9_-]+$/
export const COMPATIBLE_SHARE_TOKEN_PATTERN = /^(?:s[A-Za-z0-9]{11}|ds_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{10})$/
export const COMPATIBLE_IMAGE_TOKEN_PATTERN = /^(?:i[A-Za-z0-9]{11}|ih[A-Za-z0-9_-]+)$/

const randomBase62 = customAlphabet(BASE62_ALPHABET)

export function generateId(length = DEFAULT_ID_LENGTH): string {
  return randomBase62(length)
}

export function generateToken(length: number): string {
  return randomBase62(length)
}

export function generateShareToken(): string {
  return `${SHARE_TOKEN_PREFIX}${generateToken(PUBLIC_TOKEN_RANDOM_LENGTH)}`
}

export function generateImageToken(): string {
  return `${IMAGE_TOKEN_PREFIX}${generateToken(PUBLIC_TOKEN_RANDOM_LENGTH)}`
}
