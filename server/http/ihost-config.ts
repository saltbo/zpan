import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { putIhostConfigSchema } from '../../shared/schemas'
import type { IhostConfigResponse } from '../../shared/types'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  type CfSettings,
  deleteImageHostingConfig,
  getImageHostingConfig,
  putImageHostingConfig,
} from '../usecases/image-hosting-config'

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
  if (row.customDomain) {
    domainStatus = verifiedAtMs ? 'verified' : 'pending'
  }

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

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)

    const getEnv = c.get('platform').getEnv.bind(c.get('platform'))
    const isCfConfigured = !!getEnv('CF_API_TOKEN')
    const cnameTarget = getEnv('CF_CNAME_TARGET') ?? ''
    const cf: CfSettings = { isConfigured: isCfConfigured, appHost: getEnv('APP_HOST') ?? null }

    const row = await getImageHostingConfig(c.get('deps'), orgId, cf)
    if (!row) {
      return c.json({ enabled: false })
    }

    return c.json(buildResponse(row, cnameTarget, isCfConfigured))
  })
  .put('/', requireTeamRole('owner'), zValidator('json', putIhostConfigSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)

    const body = c.req.valid('json')
    const getEnv = c.get('platform').getEnv.bind(c.get('platform'))
    const isCfConfigured = !!getEnv('CF_API_TOKEN')
    const cnameTarget = getEnv('CF_CNAME_TARGET') ?? ''
    const cf: CfSettings = { isConfigured: isCfConfigured, appHost: getEnv('APP_HOST') ?? null }

    const result = await putImageHostingConfig(c.get('deps'), orgId, body, cf)
    if (!result.ok) {
      if (result.reason === 'app_host') {
        return c.json({ error: 'Custom domain cannot be the application default host' }, 400)
      }
      return c.json({ error: 'Domain already registered by another organization' }, 409)
    }

    return c.json(buildResponse(result.config, cnameTarget, isCfConfigured))
  })
  .delete('/', requireTeamRole('owner'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)

    await deleteImageHostingConfig(c.get('deps'), orgId)

    return c.body(null, 204)
  })

export default app
