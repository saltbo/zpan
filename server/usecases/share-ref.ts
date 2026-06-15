// Pure share-token helpers shared by the share + redirect usecases and the http
// layer: child-ref signing/verification, folder path math, breadcrumb building,
// and the password/recipient access gate. Framework-free (node:crypto only), so
// usecases may import it; http/share-utils re-exports it for the handlers.

import { createHmac } from 'node:crypto'
import { isAccessibleByUser } from '../domain/share'
import type { ShareRecipientRecord } from './ports'

export const PRESIGN_TTL_SECS = 5 * 60

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

export function checkAccessGate(
  passwordHash: string | null,
  recipients: ShareRecipientRecord[],
  userId: string | null,
  cookieValue: string | undefined,
): 'ok' | 'password_required' {
  if (!passwordHash) return 'ok'
  if (userId && isAccessibleByUser(recipients, userId)) return 'ok'
  if (cookieValue === 'ok') return 'ok'
  return 'password_required'
}
