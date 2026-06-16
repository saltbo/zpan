import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getUserQuota, listQuotaOverview } from '../usecases/quota'
import { errorResponse, jsonContent } from './openapi'

// Quota types are already wire-shaped (timestamps are ISO strings, not Date), so
// the schemas match the usecase return types directly — no DTO mapper needed.
const currentStoragePlanSchema = z.object({
  sourceId: z.string(),
  packageId: z.string().nullable(),
  name: z.string(),
  storageBytes: z.number().int(),
  trafficBytes: z.number().int(),
  trafficOveragePriceCents: z.number().int().nullable(),
  expiresAt: z.string().nullable(),
  subscription: z.boolean(),
})

const effectiveQuotaSchema = z
  .object({
    orgId: z.string(),
    baseQuota: z.number().int(),
    entitlementQuota: z.number().int(),
    quota: z.number().int(),
    used: z.number().int(),
    baseTrafficQuota: z.number().int(),
    entitlementTrafficQuota: z.number().int(),
    trafficQuota: z.number().int(),
    trafficUsed: z.number().int(),
    trafficPeriod: z.string(),
    storagePlanName: z.string().nullable(),
    storageExtraNames: z.array(z.string()),
    trafficPlanName: z.string().nullable(),
    trafficExtraNames: z.array(z.string()),
    currentPlan: currentStoragePlanSchema.nullable(),
  })
  .openapi('EffectiveQuota')

const quotaOverviewItemSchema = effectiveQuotaSchema
  .extend({ id: z.string(), orgName: z.string(), orgType: z.string() })
  .openapi('QuotaOverviewItem')

const quotaOverviewSchema = z
  .object({ items: z.array(quotaOverviewItemSchema), total: z.number().int() })
  .openapi('QuotaOverview')

const listQuotaOverviewRoute = createRoute({
  operationId: 'listQuotaOverview',
  summary: 'List quota overview across all spaces',
  tags: ['Quotas'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  responses: { 200: jsonContent(quotaOverviewSchema, 'Quota overview') },
})

const getMyQuotaRoute = createRoute({
  operationId: 'getMyQuota',
  summary: "Get the current user's effective quota",
  tags: ['Quotas'],
  method: 'get',
  path: '/me',
  middleware: [requireAuth] as const,
  responses: {
    200: jsonContent(effectiveQuotaSchema, 'Effective quota'),
    404: errorResponse('No organization found'),
  },
})

// Quota overview across all orgs (personal + team), used by the admin dashboard.
// Per-team entitlement management lives under /api/teams.
const adminQuotas = new OpenAPIHono<Env>().openapi(listQuotaOverviewRoute, async (c) =>
  c.json(await listQuotaOverview(c.get('deps')), 200),
)

const userQuotas = new OpenAPIHono<Env>().openapi(getMyQuotaRoute, async (c) => {
  const quota = await getUserQuota(c.get('deps'), { userId: c.get('userId')!, orgId: c.get('orgId') ?? undefined })
  if (!quota) return c.json({ error: 'No organization found' }, 404)
  return c.json(quota, 200)
})

export { adminQuotas, userQuotas }
