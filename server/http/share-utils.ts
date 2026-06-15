import type { Context } from 'hono'
import type { Env } from '../middleware/platform'

// Pure share-token helpers live in usecases/share-ref (so the share + redirect
// usecases can import them without reaching into http). Re-exported here so the
// handlers keep a single import surface.
export {
  buildBreadcrumb,
  checkAccessGate,
  decodeChildRef,
  encodeChildRef,
  folderRootPath,
  PRESIGN_TTL_SECS,
} from '../usecases/share-ref'

export function cookieName(token: string): string {
  return `sharetk_${token}`
}

export function viewCookieName(token: string): string {
  return `sharevw_${token}`
}

// Escape LIKE wildcards so user-controlled folder names don't act as patterns.
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

export async function readUserId(c: Context<Env>): Promise<string | null> {
  const session = (await c.get('auth').api.getSession({ headers: c.req.raw.headers })) as {
    user: { id: string }
  } | null
  return session?.user?.id ?? null
}
