import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import type { Context } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../../shared/constants'
import type { BindingState } from '../../../shared/types'
import { originFromRequestUrl } from '../../domain/site-public-origin'
import type { Env } from '../../middleware/platform'
import { runtimeInfo } from '../../usecases/site/instance-info'
import {
  initiatePairing,
  loadBindingState,
  normalizeHost,
  pollPairing,
  triggerRefresh,
  unbindLicense,
} from '../../usecases/site/licensing'
import { getSitePublicOrigin } from '../../usecases/site/public-origin'
import { authRoute, errorResponse, jsonContent } from '../openapi'

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

const licenseEntitlementsSchema = z
  .object({
    bound: z.boolean(),
    active: z.boolean(),
    edition: z.enum(['pro', 'business']).nullable(),
    features: z.array(z.string()),
  })
  .openapi('LicenseEntitlements')

const pairingSchema = z
  .object({ code: z.string(), pairingUrl: z.string(), expiresAt: z.string() })
  .openapi('LicensePairing')

const pairingStatusSchema = z
  .object({ status: z.string(), edition: z.string().optional(), cloud_store_id: z.string().optional() })
  .openapi('LicensePairingStatus')

const entitlementsRoute = authRoute(
  { scopes: [AuthorizationScope.LICENSING_READ] },
  {
    operationId: 'getLicenseEntitlements',
    summary: 'Get the current user-visible license entitlements',
    tags: ['Licensing'],
    method: 'get',
    path: '/entitlements',
    responses: { 200: jsonContent(licenseEntitlementsSchema, 'License entitlements') },
  },
)

const bindingRoute = authRoute(
  { scopes: [AuthorizationScope.LICENSING_READ], siteRole: 'admin' },
  {
    operationId: 'getLicenseBinding',
    summary: 'Get license binding details',
    tags: ['Licensing'],
    method: 'get',
    path: '/binding',
    responses: { 200: jsonContent(bindingStateSchema, 'License binding') },
  },
)

const initiatePairingRoute = authRoute(
  { scopes: [AuthorizationScope.LICENSING_UPDATE], siteRole: 'admin' },
  {
    operationId: 'initiateLicensePairing',
    summary: 'Initiate cloud pairing',
    tags: ['Licensing'],
    method: 'post',
    path: '/pairings',
    responses: { 200: jsonContent(pairingSchema, 'Pairing') },
  },
)

const pollPairingRoute = authRoute(
  { scopes: [AuthorizationScope.LICENSING_READ], siteRole: 'admin' },
  {
    operationId: 'pollLicensePairing',
    summary: 'Poll cloud pairing status',
    tags: ['Licensing'],
    method: 'get',
    path: '/pairings/{code}',
    request: { params: z.object({ code: z.string() }) },
    responses: {
      200: jsonContent(pairingStatusSchema, 'Pairing status'),
      502: errorResponse('Cloud error'),
    },
  },
)

const refreshRoute = authRoute(
  { scopes: [AuthorizationScope.LICENSING_UPDATE], siteRole: 'admin' },
  {
    operationId: 'refreshLicense',
    summary: 'Refresh the license',
    tags: ['Licensing'],
    method: 'post',
    path: '/refresh-runs',
    responses: {
      200: jsonContent(z.object({ success: z.boolean(), last_refresh_at: z.number().int().nullable() }), 'Refreshed'),
    },
  },
)

const unbindRoute = authRoute(
  { scopes: [AuthorizationScope.LICENSING_UPDATE], siteRole: 'admin' },
  {
    operationId: 'unbindLicense',
    summary: 'Unbind the license',
    tags: ['Licensing'],
    method: 'delete',
    path: '/binding',
    responses: {
      204: { description: 'Unbound' },
      502: errorResponse('Cloud unbind failed'),
    },
  },
)

async function loadCurrentBinding(c: Context<Env>) {
  const cloudBaseUrl = getCloudBaseUrl(c)
  const currentHost =
    (await configuredPublicHost(c)) ??
    normalizeHost(c.req.header('x-forwarded-host') ?? c.req.header('host')) ??
    new URL(c.req.url).host
  return {
    ...(await loadBindingState(c.get('deps'), { currentHost, cloudBaseUrl })),
    cloud_dashboard_url: cloudDashboardUrl(cloudBaseUrl),
  } satisfies BindingState
}

export const licensing = new OpenAPIHono<Env>().openapi(entitlementsRoute, async (c) => {
  const state = await loadCurrentBinding(c)
  return c.json(
    {
      bound: state.bound,
      active: state.active ?? false,
      edition: state.edition ?? null,
      features: state.features ?? [],
    },
    200,
  )
})

const adminApp = new OpenAPIHono<Env>()

export const licensingAdmin = adminApp
  .openapi(bindingRoute, async (c) => c.json(await loadCurrentBinding(c), 200))
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
    })
    return c.json({ success: true, last_refresh_at: lastRefreshAt }, 200)
  })
  .openapi(unbindRoute, async (c) => {
    const result = await unbindLicense(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
    })
    if (!result.ok) throw result.error
    return c.body(null, 204)
  })
