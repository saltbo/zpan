import type { Context } from 'hono'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { BASE62_PATTERN } from '../../shared/ids'
import { isDownloadFailureStatus, transferAuditActor, transferFailureReason } from '../middleware/audit-transfers'
import type { Env } from '../middleware/platform'
import { notFound } from '../usecases/ports'
import {
  type DirectShareOutcome,
  type ImageHostingOutcome,
  resolveDirectShareDownload,
  resolveImageHostingDownload,
  resolveRedirectDownloadAuditTarget,
  resolveRedirectTargetKind,
} from '../usecases/redirect'
import { recordDownloadFailure, recordDownloadIssued } from '../usecases/transfer-activity'

// Strip optional file extension from token (e.g. "ihaB3xK9.png" → "ihaB3xK9")
function stripExtension(token: string): string {
  const dot = token.lastIndexOf('.')
  return dot > 0 ? token.slice(0, dot) : token
}

function parseRedirectToken(raw: string): string {
  const token = stripExtension(raw)
  if (!BASE62_PATTERN.test(token)) throw notFound()
  return token
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
      c.get('deps'),
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
      c.get('deps'),
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
  const target = await resolveRedirectDownloadAuditTarget(c.get('deps'), parseRedirectToken(c.req.param('token')))
  await next()
  if (!target || !isDownloadFailureStatus(c.res.status)) return
  await recordDownloadFailure(c.get('deps'), transferAuditActor(c.get('principal')), target, transferFailureReason(c))
})

app.get('/:token', async (c) => {
  const token = parseRedirectToken(c.req.param('token'))

  const kind = await resolveRedirectTargetKind(c.get('deps'), token)
  if (kind === 'direct_share') return handleDirectShare(c, token)
  if (kind === 'image_hosting') return handleImageHosting(c, token)

  throw notFound()
})

export default app
