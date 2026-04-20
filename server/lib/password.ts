import crypto from 'node:crypto'

// node:crypto.scryptSync is native OpenSSL — safe on Cloudflare Workers (nodejs_compat)
// and avoids the JS-CPU budget issue that the pure-JS @noble/hashes scrypt triggers.
const SCRYPT_PARAMS = { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(password.normalize('NFKC'), salt, 64, SCRYPT_PARAMS)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

export function verifyPassword(hash: string, plaintext: string): boolean {
  const [saltHex, keyHex] = hash.split(':')
  if (!saltHex || !keyHex) return false
  const key = crypto.scryptSync(plaintext.normalize('NFKC'), Buffer.from(saltHex, 'hex'), 64, SCRYPT_PARAMS)
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'))
}
