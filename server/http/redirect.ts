import type { Context } from 'hono'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { IMAGE_TOKEN_PATTERN, SHARE_TOKEN_PATTERN } from '../../shared/ids'
import { isDownloadFailureStatus, transferAuditActor, transferFailureReason } from '../middleware/audit-transfers'
import type { Env } from '../middleware/platform'
import { notFound } from '../usecases/ports'
import {
  type DirectShareOutcome,
  type ImageHostingOutcome,
  resolveDirectShareDownload,
  resolveDirectShareRedirectTarget,
  resolveImageHostingDownload,
  resolveImageHostingRedirectTarget,
} from '../usecases/redirect'
import { recordDownloadFailure, recordDownloadIssued } from '../usecases/transfer-activity'

type ParsedRedirectToken = { kind: 'direct_share'; token: string } | { kind: 'image_hosting'; token: string }

const REDIRECT_TOKEN_PATTERN = /^([si][A-Za-z0-9]{11})(?:\.[A-Za-z0-9]{1,16})?$/

function parseRedirectToken(raw: string): ParsedRedirectToken {
  const token = REDIRECT_TOKEN_PATTERN.exec(raw)?.[1]
  if (!token) throw notFound()
  if (SHARE_TOKEN_PATTERN.test(token)) return { kind: 'direct_share', token }
  if (IMAGE_TOKEN_PATTERN.test(token)) return { kind: 'image_hosting', token }
  throw notFound()
}

const cloudBaseUrl = (c: Context<Env>) => c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT

function presignedRedirect(c: Context<Env>, url: string): Response {
  const res = c.redirect(url, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

async function handleDirectShare(c: Context<Env>, token: string): Promise<Response> {
  const { resolved, auditTarget } = await resolveDirectShareRedirectTarget(c.get('deps'), token)
  c.set('redirectDownloadAuditTarget', auditTarget)
  const outcome: DirectShareOutcome = await resolveDirectShareDownload(c.get('deps'), {
    resolved,
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
  const { resolved, auditTarget } = await resolveImageHostingRedirectTarget(c.get('deps'), token)
  c.set('redirectDownloadAuditTarget', auditTarget)
  const outcome: ImageHostingOutcome = await resolveImageHostingDownload(c.get('deps'), {
    resolved,
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
  c.set('redirectDownloadAuditTarget', null)
  await next()
  const target = c.get('redirectDownloadAuditTarget')
  if (!target || !isDownloadFailureStatus(c.res.status)) return
  await recordDownloadFailure(c.get('deps'), transferAuditActor(c.get('principal')), target, transferFailureReason(c))
})

app.get('/:token', async (c) => {
  const parsed = parseRedirectToken(c.req.param('token'))
  return parsed.kind === 'direct_share' ? handleDirectShare(c, parsed.token) : handleImageHosting(c, parsed.token)
})

export default app
