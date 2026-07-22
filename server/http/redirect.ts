import type { Context } from 'hono'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import {
  isDownloadFailureStatus,
  recordDownloadFailure,
  recordDownloadIssued,
  type TransferAuditTarget,
  transferAuditActor,
  transferFailureReason,
} from '../middleware/audit-transfers'
import type { Env } from '../middleware/platform'
import { notFound } from '../usecases/ports'
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

async function handleDirectShare(c: Context<Env>, token: string): Promise<Response> {
  const outcome: DirectShareOutcome = await resolveDirectShareDownload(c.get('deps'), {
    token,
    cloudBaseUrl: cloudBaseUrl(c),
  })
  if (outcome.ok) {
    await recordDownloadIssued(
      c.get('deps').audit,
      transferAuditActor(c.get('principal')),
      'share_download',
      {
        orgId: outcome.receipt.orgId,
        targetType: 'share',
        targetId: outcome.receipt.shareId,
        targetName: outcome.receipt.matterName,
        bytes: outcome.receipt.bytes,
        source: 'direct_share',
        metadata: {
          shareId: outcome.receipt.shareId,
          matterId: outcome.receipt.matterId,
          storageId: outcome.receipt.storageId,
        },
      },
      outcome.receipt.trafficEventId,
    )
    return presignedRedirect(c, outcome.url)
  }
  throw outcome.error
}

async function handleImageHosting(c: Context<Env>, token: string): Promise<Response> {
  const outcome: ImageHostingOutcome = await resolveImageHostingDownload(c.get('deps'), {
    token,
    cloudBaseUrl: cloudBaseUrl(c),
    refererHeader: c.req.header('Referer') ?? null,
    requestOrigin: new URL(c.req.url).origin,
  })
  if (outcome.ok) {
    await recordDownloadIssued(
      c.get('deps').audit,
      transferAuditActor(c.get('principal')),
      'image_hosting_download',
      {
        orgId: outcome.receipt.orgId,
        targetType: 'image',
        targetId: outcome.receipt.imageId,
        targetName: outcome.receipt.imagePath,
        bytes: outcome.receipt.bytes,
        source: 'image_hosting',
        metadata: { imageId: outcome.receipt.imageId, storageId: outcome.receipt.storageId },
      },
      outcome.receipt.trafficEventId,
    )
    return presignedRedirect(c, outcome.url)
  }
  throw outcome.error
}

const app = new Hono<Env>()

app.use('/:token', async (c, next) => {
  const target = await redirectDownloadAuditTarget(c, stripExtension(c.req.param('token')))
  await next()
  if (!target || !isDownloadFailureStatus(c.res.status)) return
  await recordDownloadFailure(
    c.get('deps').audit,
    transferAuditActor(c.get('principal')),
    target,
    transferFailureReason(c),
  )
})

app.get('/:token', async (c) => {
  const raw = c.req.param('token')
  const token = stripExtension(raw)

  if (token.startsWith('ds_')) return handleDirectShare(c, token)
  if (token.startsWith('ih_')) return handleImageHosting(c, token)

  throw notFound()
})

async function redirectDownloadAuditTarget(c: Context<Env>, token: string): Promise<TransferAuditTarget | null> {
  if (token.startsWith('ds_')) {
    const resolved = await c.get('deps').share.resolveByToken(token)
    if (resolved.status !== 'ok' || resolved.share.kind !== 'direct') return null
    return {
      orgId: resolved.share.orgId,
      targetType: 'share',
      targetId: resolved.share.id,
      targetName: resolved.matter.name,
      bytes: resolved.matter.size ?? 0,
      source: 'direct_share',
      metadata: {
        shareId: resolved.share.id,
        matterId: resolved.matter.id,
        storageId: resolved.matter.storageId,
      },
    }
  }

  if (token.startsWith('ih_')) {
    const resolved = await c.get('deps').imageHosting.resolveActiveByToken(token)
    if (!resolved) return null
    return {
      orgId: resolved.image.orgId,
      targetType: 'image',
      targetId: resolved.image.id,
      targetName: resolved.image.path,
      bytes: resolved.image.size,
      source: 'image_hosting',
      metadata: { imageId: resolved.image.id, storageId: resolved.image.storageId },
    }
  }

  return null
}

export default app
