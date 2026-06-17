import { timingSafeEqual } from 'node:crypto'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../../shared/constants'
import type { BindingState } from '../../../shared/types'
import { originFromRequestUrl } from '../../domain/site-public-origin'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { syncPendingRemoteDownloadUsageReports } from '../../usecases/downloads/remote-download-usage'
import { unauthorized } from '../../usecases/ports'
import { buildCloudInstanceInfo, runtimeInfo } from '../../usecases/site/instance-info'
import {
  initiatePairing,
  loadBindingState,
  normalizeHost,
  pollPairing,
  runLicensingRefresh,
  triggerRefresh,
  unbindLicense,
} from '../../usecases/site/licensing'
import { getSitePublicOrigin } from '../../usecases/site/public-origin'
import { syncPendingCloudTrafficReports } from '../../usecases/store/traffic-metering'
import { errorResponse, jsonContent } from '../openapi'

function getCloudBaseUrl(c: Context<Env>): string {
  return c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
}

async function getInstanceOrigin(c: Context<Env>): Promise<string | null> {
  return (await getSitePublicOrigin(c.get('deps'))) ?? originFromRequestUrl(c.req.url)
}

async function requireInstanceOrigin(c: Context<Env>): Promise<string> {
  return (await getInstanceOrigin(c)) ?? new URL(c.req.url).origin
}

async function configuredPublicHost(c: Context<Env>): Promise<string | null> {
  const origin = await getInstanceOrigin(c)
  return origin ? new URL(origin).host : null
}

async function getRequestHost(c: Context<Env>): Promise<string> {
  const configured = await getSitePublicOrigin(c.get('deps'))
  if (configured) return new URL(configured).host
  const forwardedHost = c.req.header('x-forwarded-host') ?? c.req.header('host')
  return normalizeHost(forwardedHost) ?? new URL(c.req.url).host
}

function cloudDashboardUrl(cloudBaseUrl: string): string {
  return `${cloudBaseUrl.replace(/\/$/, '')}/dashboard`
}

function secretsMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  const enc = new TextEncoder()
  return timingSafeEqual(enc.encode(provided), enc.encode(expected))
}

function isAuthorizedCronRequest(c: Context<Env>) {
  const expectedSecret = c.get('platform').getEnv('REFRESH_CRON_SECRET')
  const provided = c.req.query('secret') ?? ''
  return Boolean(expectedSecret && secretsMatch(provided, expectedSecret))
}

const bindingStateSchema = z
  .object({
    bound: z.boolean(),
    active: z.boolean().optional(),
    account_email: z.string().optional(),
    edition: z.string().optional(),
    features: z.array(z.string()).optional(),
    license_id: z.string().optional(),
    license_valid_until: z.number().int().optional(),
    certificate_expires_at: z.number().int().optional(),
    last_refresh_at: z.number().int().optional(),
    last_refresh_error: z.string().optional(),
    cloud_dashboard_url: z.string().optional(),
  })
  .openapi('LicenseBindingState')

const pairingSchema = z
  .object({ code: z.string(), pairingUrl: z.string(), expiresAt: z.string() })
  .openapi('LicensePairing')

const pairingStatusSchema = z
  .object({ status: z.string(), edition: z.string().optional(), cloud_store_id: z.string().optional() })
  .openapi('LicensePairingStatus')

const statusRoute = createRoute({
  operationId: 'getLicensingStatus',
  summary: 'Get licensing status',
  tags: ['Licensing'],
  method: 'get',
  path: '/status',
  responses: { 200: jsonContent(bindingStateSchema, 'Binding state') },
})

const initiatePairingRoute = createRoute({
  operationId: 'initiateLicensePairing',
  summary: 'Initiate cloud pairing',
  tags: ['Licensing'],
  method: 'post',
  path: '/pairings',
  middleware: [requireAdmin] as const,
  responses: { 200: jsonContent(pairingSchema, 'Pairing') },
})

const pollPairingRoute = createRoute({
  operationId: 'pollLicensePairing',
  summary: 'Poll cloud pairing status',
  tags: ['Licensing'],
  method: 'get',
  path: '/pairings/{code}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ code: z.string() }) },
  responses: {
    200: jsonContent(pairingStatusSchema, 'Pairing status'),
    502: errorResponse('Cloud error'),
  },
})

const refreshRoute = createRoute({
  operationId: 'refreshLicense',
  summary: 'Refresh the license',
  tags: ['Licensing'],
  method: 'post',
  path: '/refresh-runs',
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(z.object({ success: z.boolean(), last_refresh_at: z.number().int().nullable() }), 'Refreshed'),
  },
})

const unbindRoute = createRoute({
  operationId: 'unbindLicense',
  summary: 'Unbind the license',
  tags: ['Licensing'],
  method: 'delete',
  path: '/binding',
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(z.object({ deleted: z.boolean(), cloud_unbind_error: z.string().nullable() }), 'Unbound'),
  },
})

const publicApp = new OpenAPIHono<Env>()

// Cron-secret-authorized sync endpoints — called by external schedulers, not SDK
// users. Kept as plain routes, excluded from the OpenAPI document.
publicApp.post('/refresh-cron', async (c) => {
  if (!isAuthorizedCronRequest(c)) throw unauthorized()
  const cloudBaseUrl = getCloudBaseUrl(c)
  const origin = await getInstanceOrigin(c)
  const instance = origin
    ? await buildCloudInstanceInfo(c.get('deps'), { url: origin, runtime: runtimeInfo(c.get('platform')) })
    : undefined
  await runLicensingRefresh(c.get('deps'), cloudBaseUrl, instance)
  return c.json({ ok: true })
})
publicApp.post('/traffic-sync-runs', async (c) => {
  if (!isAuthorizedCronRequest(c)) throw unauthorized()
  const cloudBaseUrl = getCloudBaseUrl(c)
  const [traffic, remoteDownload] = await Promise.all([
    syncPendingCloudTrafficReports(c.get('deps'), { cloudBaseUrl }),
    syncPendingRemoteDownloadUsageReports(c.get('deps'), { cloudBaseUrl }),
  ])
  return c.json({ ok: true, ...traffic, remoteDownload })
})

export const licensing = publicApp.openapi(statusRoute, async (c) => {
  const cloudBaseUrl = getCloudBaseUrl(c)
  const currentHost =
    (await configuredPublicHost(c)) ??
    normalizeHost(c.req.header('x-forwarded-host') ?? c.req.header('host')) ??
    new URL(c.req.url).host
  const state = await loadBindingState(c.get('deps'), { currentHost, cloudBaseUrl })
  return c.json({ ...state, cloud_dashboard_url: cloudDashboardUrl(cloudBaseUrl) } satisfies BindingState, 200)
})

const adminApp = new OpenAPIHono<Env>()

export const licensingAdmin = adminApp
  .openapi(initiatePairingRoute, async (c) => {
    const pairing = await initiatePairing(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      instanceUrl: await requireInstanceOrigin(c),
      runtime: runtimeInfo(c.get('platform')),
    })
    return c.json(pairing, 200)
  })
  .openapi(pollPairingRoute, async (c) => {
    const result = await pollPairing(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      code: c.req.valid('param').code,
      currentHost: await getRequestHost(c),
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })
    if (!result.ok) throw result.error
    if (result.status === 'approved') {
      return c.json({ status: 'approved', edition: result.edition, cloud_store_id: result.cloudStoreId }, 200)
    }
    return c.json({ status: result.status }, 200)
  })
  .openapi(refreshRoute, async (c) => {
    const { lastRefreshAt } = await triggerRefresh(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      instanceUrl: await requireInstanceOrigin(c),
      runtime: runtimeInfo(c.get('platform')),
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })
    return c.json({ success: true, last_refresh_at: lastRefreshAt }, 200)
  })
  .openapi(unbindRoute, async (c) => {
    const { cloudUnbindError } = await unbindLicense(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })
    return c.json({ deleted: true, cloud_unbind_error: cloudUnbindError }, 200)
  })
