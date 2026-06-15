import type { Context } from 'hono'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { Env } from '../middleware/platform'
import {
  type DirectShareOutcome,
  type ImageHostingOutcome,
  resolveDirectShareDownload,
  resolveImageHostingDownload,
} from '../usecases/redirect'

// Strip optional file extension from token (e.g. "ih_aB3xK9.png" → "ih_aB3xK9")
function stripExtension(token: string): string {
  const dot = token.lastIndexOf('.')
  return dot > 0 ? token.slice(0, dot) : token
}

const cloudBaseUrl = (c: Context<Env>) => c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT

function presignedRedirect(c: Context<Env>, url: string): Response {
  const res = c.redirect(url, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function insufficientCredits(c: Context<Env>): Response {
  return c.json({ error: 'insufficient_credits', code: 'insufficient_credits', resource: 'storage_egress' }, 402)
}

async function handleDirectShare(c: Context<Env>, token: string): Promise<Response> {
  const outcome: DirectShareOutcome = await resolveDirectShareDownload(c.get('deps'), {
    token,
    cloudBaseUrl: cloudBaseUrl(c),
  })
  if (outcome.ok) return presignedRedirect(c, outcome.url)
  switch (outcome.reason) {
    case 'matter_trashed':
      return c.json({ error: 'File no longer available' }, 410)
    case 'not_found':
      return c.json({ error: 'Share not found or revoked' }, 404)
    case 'expired':
      return c.json({ error: 'Share has expired' }, 410)
    case 'limit_exceeded':
      return c.json({ error: 'Download limit exceeded' }, 410)
    case 'storage_not_found':
      return c.json({ error: 'Storage not found' }, 404)
    case 'quota_exceeded':
      return c.json({ error: 'Traffic quota exceeded' }, 422)
    case 'insufficient_credits':
      return insufficientCredits(c)
  }
}

async function handleImageHosting(c: Context<Env>, token: string): Promise<Response> {
  const outcome: ImageHostingOutcome = await resolveImageHostingDownload(c.get('deps'), {
    token,
    cloudBaseUrl: cloudBaseUrl(c),
    refererHeader: c.req.header('Referer') ?? null,
    requestOrigin: new URL(c.req.url).origin,
  })
  if (outcome.ok) return presignedRedirect(c, outcome.url)
  switch (outcome.reason) {
    case 'not_found':
      return c.json({ error: 'Not found' }, 404)
    case 'forbidden_referer':
      return c.json({ error: 'forbidden referer' }, 403)
    case 'storage_not_found':
      return c.json({ error: 'Storage not found' }, 404)
    case 'quota_exceeded':
      return c.json({ error: 'Traffic quota exceeded' }, 422)
    case 'insufficient_credits':
      return insufficientCredits(c)
  }
}

const app = new Hono<Env>().get('/:token', async (c) => {
  const raw = c.req.param('token')
  const token = stripExtension(raw)

  if (token.startsWith('ds_')) return handleDirectShare(c, token)
  if (token.startsWith('ih_')) return handleImageHosting(c, token)

  return c.json({ error: 'Not found' }, 404)
})

export default app
