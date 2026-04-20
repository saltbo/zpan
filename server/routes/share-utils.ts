import { createHmac } from 'node:crypto'
import type { Context } from 'hono'
import type { Env } from '../middleware/platform'
import { S3Service } from '../services/s3'
import { isAccessibleByUser, type ShareRecipient } from '../services/share'

export const s3 = new S3Service()
export const PRESIGN_TTL_SECS = 5 * 60

export function cookieName(token: string): string {
  return `sharetk_${token}`
}

export function encodeChildRef(shareToken: string, matterId: string): string {
  const sig = createHmac('sha256', shareToken).update(matterId).digest('hex').slice(0, 16)
  return Buffer.from(`${matterId}.${sig}`).toString('base64url')
}

export function decodeChildRef(shareToken: string, childRef: string): string | null {
  try {
    const raw = Buffer.from(childRef, 'base64url').toString('utf-8')
    const dotIdx = raw.lastIndexOf('.')
    if (dotIdx < 0) return null
    const matterId = raw.slice(0, dotIdx)
    const sig = raw.slice(dotIdx + 1)
    const expectedSig = createHmac('sha256', shareToken).update(matterId).digest('hex').slice(0, 16)
    return sig === expectedSig ? matterId : null
  } catch {
    return null
  }
}

export function folderRootPath(matter: { parent: string; name: string }): string {
  return matter.parent ? `${matter.parent}/${matter.name}` : matter.name
}

// Escape LIKE wildcards so user-controlled folder names don't act as patterns.
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

export function buildBreadcrumb(rootName: string, relativePath: string): Array<{ name: string; path: string }> {
  const crumbs: Array<{ name: string; path: string }> = [{ name: rootName, path: '' }]
  if (!relativePath) return crumbs
  let accumulated = ''
  for (const part of relativePath.split('/')) {
    accumulated = accumulated ? `${accumulated}/${part}` : part
    crumbs.push({ name: part, path: accumulated })
  }
  return crumbs
}

export async function readUserId(c: Context<Env>): Promise<string | null> {
  const session = (await c.get('auth').api.getSession({ headers: c.req.raw.headers })) as {
    user: { id: string }
  } | null
  return session?.user?.id ?? null
}

export function checkAccessGate(
  passwordHash: string | null,
  recipients: ShareRecipient[],
  userId: string | null,
  cookieValue: string | undefined,
): 'ok' | 'password_required' {
  if (!passwordHash) return 'ok'
  if (userId && isAccessibleByUser(recipients, userId)) return 'ok'
  if (cookieValue === 'ok') return 'ok'
  return 'password_required'
}
