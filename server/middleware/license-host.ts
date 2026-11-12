import type { Context } from 'hono'
import { normalizeHost } from '../usecases/site/licensing'
import { getSitePublicOrigin } from '../usecases/site/public-origin'
import type { Env } from './platform'

export async function licenseRequestHost(c: Context<Env>): Promise<string> {
  if (c.get('platform').getEnv('ZPAN_PREVIEW') === 'true') return new URL(c.req.url).host
  const configured = await getSitePublicOrigin(c.get('deps'))
  if (configured) return new URL(configured).host
  return normalizeHost(c.req.header('host')) ?? new URL(c.req.url).host
}
