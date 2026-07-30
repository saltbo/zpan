import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { putIhostConfigSchema } from '../../../shared/schemas'
import type { IhostConfigResponse } from '../../../shared/types'
import type { Env } from '../../middleware/platform'
import {
  deleteImageHostingConfig,
  getImageHostingConfigView,
  putImageHostingConfig,
} from '../../usecases/image-hosting/config'
import type { ImageDomainProviderConfig, ImageHostingConfigRecord } from '../../usecases/ports'
import { unauthorized } from '../../usecases/ports'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'

const ihostConfigSchema = z
  .object({
    enabled: z.boolean(),
    customDomain: z.string().nullable(),
    domainVerifiedAt: z.number().int().nullable(),
    domainStatus: z.enum(['none', 'pending_dns', 'pending_tls', 'verified', 'failed']),
    domainError: z.string().nullable(),
    dnsInstructions: z
      .array(
        z.object({
          recordType: z.enum(['CNAME', 'A', 'AAAA']),
          name: z.string(),
          target: z.string(),
        }),
      )
      .nullable(),
    verificationPath: z.string().nullable(),
    refererAllowlist: z.array(z.string()).nullable(),
    createdAt: z.number().int().nullable(),
  })
  .openapi('ImageHostingConfig')

function providerDnsRecords(provider: ImageDomainProviderConfig | null) {
  if (!provider) return []
  return provider.settings.provider === 'manual'
    ? provider.settings.manual.records
    : [{ type: 'CNAME' as const, value: provider.settings.cloudflare.cnameTarget }]
}

function buildResponse(
  row: ImageHostingConfigRecord | null,
  provider: ImageDomainProviderConfig | null,
): IhostConfigResponse {
  if (!row) {
    return {
      enabled: false,
      customDomain: null,
      domainVerifiedAt: null,
      domainStatus: 'none',
      domainError: null,
      dnsInstructions: null,
      verificationPath: null,
      refererAllowlist: null,
      createdAt: null,
    }
  }
  const domainStatus = row.customDomain ? (row.domainStatus ?? 'pending_dns') : 'none'
  return {
    enabled: true,
    customDomain: row.customDomain,
    domainVerifiedAt: row.domainVerifiedAt?.getTime() ?? null,
    domainStatus,
    domainError: row.domainError,
    dnsInstructions: row.customDomain
      ? providerDnsRecords(provider).map((record) => ({
          recordType: record.type,
          name: row.customDomain as string,
          target: record.value,
        }))
      : null,
    verificationPath:
      row.customDomain && row.domainProvider === 'manual' && row.verificationToken
        ? `/.well-known/zpan-domain-verification/${row.verificationToken}`
        : null,
    refererAllowlist: row.refererAllowlist ? (JSON.parse(row.refererAllowlist) as string[]) : null,
    createdAt: row.createdAt.getTime(),
  }
}

const getRoute = authRoute(
  { scopes: [AuthorizationScope.IMAGE_HOSTING_CONFIG_READ] },
  {
    operationId: 'getImageHostingConfig',
    summary: 'Get image-hosting config',
    tags: ['Image Hosting'],
    method: 'get',
    path: '/',
    responses: {
      200: jsonContent(ihostConfigSchema, 'Image-hosting config'),
      401: errorResponse('Unauthorized'),
    },
  },
)

const putRoute = authRoute(
  { scopes: [AuthorizationScope.IMAGE_HOSTING_CONFIG_UPDATE], minTeamRole: 'owner' },
  {
    operationId: 'updateImageHostingConfig',
    summary: 'Update image-hosting config',
    tags: ['Image Hosting'],
    method: 'put',
    path: '/',
    request: jsonBody(putIhostConfigSchema),
    responses: {
      200: jsonContent(ihostConfigSchema, 'Updated config'),
      400: errorResponse('Custom domain or provider is invalid'),
      401: errorResponse('Unauthorized'),
      409: errorResponse('Domain already registered by another organization'),
    },
  },
)

const deleteRoute = authRoute(
  { scopes: [AuthorizationScope.IMAGE_HOSTING_CONFIG_DELETE], minTeamRole: 'owner' },
  {
    operationId: 'deleteImageHostingConfig',
    summary: 'Delete image-hosting config',
    tags: ['Image Hosting'],
    method: 'delete',
    path: '/',
    responses: {
      204: { description: 'Deleted' },
      401: errorResponse('Unauthorized'),
    },
  },
)

const app = new OpenAPIHono<Env>()

const ihostConfig = app
  .openapi(getRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    const result = await getImageHostingConfigView(c.get('deps'), orgId)
    return c.json(buildResponse(result.config, result.provider), 200)
  })
  .openapi(putRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    const result = await putImageHostingConfig(c.get('deps'), orgId, c.req.valid('json'), new URL(c.req.url).hostname)
    if (!result.ok) throw result.error
    return c.json(buildResponse(result.config, result.provider), 200)
  })
  .openapi(deleteRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    await deleteImageHostingConfig(c.get('deps'), orgId)
    return c.body(null, 204)
  })

export default ihostConfig
