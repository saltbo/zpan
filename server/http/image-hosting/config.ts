import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { putIhostConfigSchema } from '../../../shared/schemas'
import type { IhostConfigResponse } from '../../../shared/types'
import { requireAuth, requireTeamRole } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import {
  type CfSettings,
  deleteImageHostingConfig,
  getImageHostingConfig,
  putImageHostingConfig,
} from '../../usecases/image-hosting/config'
import { unauthorized } from '../../usecases/ports'
import { errorResponse, jsonBody, jsonContent } from '../openapi'

const ihostConfigSchema = z
  .object({
    enabled: z.boolean(),
    customDomain: z.string().nullable(),
    domainVerifiedAt: z.number().int().nullable(),
    domainStatus: z.enum(['none', 'pending', 'verified']),
    dnsInstructions: z.object({ recordType: z.string(), name: z.string(), target: z.string() }).nullable(),
    refererAllowlist: z.array(z.string()).nullable(),
    createdAt: z.number().int(),
  })
  .openapi('ImageHostingConfig')

// GET returns the full config when configured, or just `{ enabled: false }`.
const ihostConfigResponseSchema = z
  .union([ihostConfigSchema, z.object({ enabled: z.literal(false) })])
  .openapi('ImageHostingConfigResponse')

function toUnixMs(d: Date | null | undefined): number | null {
  if (!d) return null
  return d instanceof Date ? d.getTime() : null
}

function buildResponse(
  row: {
    customDomain: string | null
    cfHostnameId: string | null
    domainVerifiedAt: Date | null
    refererAllowlist: string | null
    createdAt: Date
  },
  cnameTarget: string,
  isCfConfigured: boolean,
): IhostConfigResponse {
  const verifiedAtMs = toUnixMs(row.domainVerifiedAt)

  let domainStatus: IhostConfigResponse['domainStatus'] = 'none'
  if (row.customDomain) domainStatus = verifiedAtMs ? 'verified' : 'pending'

  let dnsInstructions: IhostConfigResponse['dnsInstructions'] = null
  if (row.customDomain) {
    dnsInstructions = {
      recordType: isCfConfigured ? 'CNAME' : 'manual',
      name: row.customDomain,
      target: isCfConfigured ? cnameTarget : 'See docs/ihost-custom-domain-node.md for manual Caddy setup',
    }
  }

  const refererAllowlist = row.refererAllowlist ? (JSON.parse(row.refererAllowlist) as string[]) : null

  return {
    enabled: true,
    customDomain: row.customDomain,
    domainVerifiedAt: verifiedAtMs,
    domainStatus,
    dnsInstructions,
    refererAllowlist,
    createdAt: row.createdAt.getTime(),
  }
}

function cfFrom(c: { get(k: 'platform'): { getEnv(k: string): string | undefined } }) {
  const getEnv = c.get('platform').getEnv.bind(c.get('platform'))
  const isCfConfigured = !!getEnv('CF_API_TOKEN')
  const cnameTarget = getEnv('CF_CNAME_TARGET') ?? ''
  const cf: CfSettings = { isConfigured: isCfConfigured, appHost: getEnv('APP_HOST') ?? null }
  return { isCfConfigured, cnameTarget, cf }
}

const getRoute = createRoute({
  operationId: 'getImageHostingConfig',
  summary: 'Get image-hosting config',
  tags: ['Image Hosting'],
  method: 'get',
  path: '/',
  responses: {
    200: jsonContent(ihostConfigResponseSchema, 'Image-hosting config'),
    401: errorResponse('Unauthorized'),
  },
})

const putRoute = createRoute({
  operationId: 'updateImageHostingConfig',
  summary: 'Update image-hosting config',
  tags: ['Image Hosting'],
  method: 'put',
  path: '/',
  middleware: [requireTeamRole('owner')] as const,
  request: jsonBody(putIhostConfigSchema),
  responses: {
    200: jsonContent(ihostConfigSchema, 'Updated config'),
    400: errorResponse('Custom domain cannot be the application default host'),
    401: errorResponse('Unauthorized'),
    409: errorResponse('Domain already registered by another organization'),
  },
})

const deleteRoute = createRoute({
  operationId: 'deleteImageHostingConfig',
  summary: 'Delete image-hosting config',
  tags: ['Image Hosting'],
  method: 'delete',
  path: '/',
  middleware: [requireTeamRole('owner')] as const,
  responses: {
    204: { description: 'Deleted' },
    401: errorResponse('Unauthorized'),
  },
})

const app = new OpenAPIHono<Env>()
app.use(requireAuth)

const ihostConfig = app
  .openapi(getRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    const { isCfConfigured, cnameTarget, cf } = cfFrom(c)
    const row = await getImageHostingConfig(c.get('deps'), orgId, cf)
    if (!row) return c.json({ enabled: false as const }, 200)
    return c.json(buildResponse(row, cnameTarget, isCfConfigured), 200)
  })
  .openapi(putRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    const { isCfConfigured, cnameTarget, cf } = cfFrom(c)
    const result = await putImageHostingConfig(c.get('deps'), orgId, c.req.valid('json'), cf)
    if (!result.ok) throw result.error
    return c.json(buildResponse(result.config, cnameTarget, isCfConfigured), 200)
  })
  .openapi(deleteRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    await deleteImageHostingConfig(c.get('deps'), orgId)
    return c.body(null, 204)
  })

export default ihostConfig
