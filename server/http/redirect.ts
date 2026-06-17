import type { Context } from 'hono'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { ErrorReason } from '../../shared/schemas'
import type { Env } from '../middleware/platform'
import {
  type DirectShareOutcome,
  type ImageHostingOutcome,
  resolveDirectShareDownload,
  resolveImageHostingDownload,
} from '../usecases/redirect'
import { apiError } from './openapi'

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
  return apiError(c, 402, 'Insufficient credits', {
    reason: ErrorReason.INSUFFICIENT_CREDITS,
    metadata: { resource: 'storage_egress' },
  })
}

async function handleDirectShare(c: Context<Env>, token: string): Promise<Response> {
  const outcome: DirectShareOutcome = await resolveDirectShareDownload(c.get('deps'), {
    token,
    cloudBaseUrl: cloudBaseUrl(c),
  })
  if (outcome.ok) return presignedRedirect(c, outcome.url)
  switch (outcome.reason) {
    case 'matter_trashed':
      return apiError(c, 410, 'File no longer available')
    case 'not_found':
      return apiError(c, 404, 'Share not found or revoked')
    case 'expired':
      return apiError(c, 410, 'Share has expired')
    case 'limit_exceeded':
      return apiError(c, 410, 'Download limit exceeded')
    case 'storage_not_found':
      return apiError(c, 404, 'Storage not found')
    case 'quota_exceeded':
      return apiError(c, 422, 'Traffic quota exceeded', {
        reason: ErrorReason.QUOTA_EXCEEDED,
        status: 'RESOURCE_EXHAUSTED',
      })
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
      return apiError(c, 404, 'Not found')
    case 'forbidden_referer':
      return apiError(c, 403, 'forbidden referer')
    case 'storage_not_found':
      return apiError(c, 404, 'Storage not found')
    case 'quota_exceeded':
      return apiError(c, 422, 'Traffic quota exceeded', {
        reason: ErrorReason.QUOTA_EXCEEDED,
        status: 'RESOURCE_EXHAUSTED',
      })
    case 'insufficient_credits':
      return insufficientCredits(c)
  }
}

const app = new Hono<Env>().get('/:token', async (c) => {
  const raw = c.req.param('token')
  const token = stripExtension(raw)

  if (token.startsWith('ds_')) return handleDirectShare(c, token)
  if (token.startsWith('ih_')) return handleImageHosting(c, token)

  return apiError(c, 404, 'Not found')
})

export default app
