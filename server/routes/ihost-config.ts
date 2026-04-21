import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { putIhostConfigSchema } from '../../shared/schemas'
import type { IhostConfigResponse } from '../../shared/types'
import { imageHostingConfigs } from '../db/schema'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { CfConflictError, createCfClient } from '../services/cf-custom-hostnames'

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

function catchUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes('UNIQUE constraint failed') || msg.includes('unique constraint')
}

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)

    const getEnv = c.get('platform').getEnv.bind(c.get('platform'))
    const cfClient = createCfClient(getEnv)
    const isCfConfigured = !!getEnv('CF_API_TOKEN')
    const cnameTarget = getEnv('CF_CNAME_TARGET') ?? ''

    const rows = await db.select().from(imageHostingConfigs).where(eq(imageHostingConfigs.orgId, orgId)).limit(1)

    if (rows.length === 0) {
      return c.json({ enabled: false })
    }

    const row = rows[0]

    // Lazily refresh verification status when domain is unverified and CF is configured.
    if (row.customDomain && !row.domainVerifiedAt && row.cfHostnameId && isCfConfigured) {
      const status = await cfClient.getStatus(row.cfHostnameId)
      if (status.status === 'active') {
        const now = new Date()
        await db
          .update(imageHostingConfigs)
          .set({ domainVerifiedAt: now, updatedAt: now })
          .where(eq(imageHostingConfigs.orgId, orgId))
        row.domainVerifiedAt = now
      }
    }

    return c.json(buildResponse(row, cnameTarget, isCfConfigured))
  })
  .put('/', requireTeamRole('owner'), zValidator('json', putIhostConfigSchema), async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)

    const body = c.req.valid('json')
    const getEnv = c.get('platform').getEnv.bind(c.get('platform'))
    const cfClient = createCfClient(getEnv)
    const isCfConfigured = !!getEnv('CF_API_TOKEN')
    const cnameTarget = getEnv('CF_CNAME_TARGET') ?? ''
    const appHost = getEnv('APP_HOST')

    // Reject the app's own default host as a custom domain.
    if (body.customDomain && appHost && body.customDomain === appHost) {
      return c.json({ error: 'Custom domain cannot be the application default host' }, 400)
    }

    const existing = await db.select().from(imageHostingConfigs).where(eq(imageHostingConfigs.orgId, orgId)).limit(1)

    const now = new Date()
    const newDomain = body.customDomain ?? null
    const newReferers = body.refererAllowlist !== undefined ? body.refererAllowlist : null

    if (existing.length === 0) {
      // Insert new config row.
      let cfHostnameId: string | null = null
      if (newDomain && isCfConfigured) {
        try {
          const result = await cfClient.register(newDomain)
          cfHostnameId = result.id || null
        } catch (e) {
          if (e instanceof CfConflictError) {
            return c.json({ error: 'Domain already registered by another organization' }, 409)
          }
          throw e
        }
      }

      try {
        await db.insert(imageHostingConfigs).values({
          orgId,
          customDomain: newDomain,
          cfHostnameId,
          domainVerifiedAt: null,
          refererAllowlist: newReferers ? JSON.stringify(newReferers) : null,
          createdAt: now,
          updatedAt: now,
        })
      } catch (e) {
        if (catchUniqueViolation(e)) {
          return c.json({ error: 'Domain already registered by another organization' }, 409)
        }
        throw e
      }

      return c.json(
        buildResponse(
          {
            customDomain: newDomain,
            cfHostnameId,
            domainVerifiedAt: null,
            refererAllowlist: newReferers ? JSON.stringify(newReferers) : null,
            createdAt: now,
          },
          cnameTarget,
          isCfConfigured,
        ),
      )
    }

    // Update existing config row.
    const old = existing[0]
    const oldDomain = old.customDomain
    let cfHostnameId = old.cfHostnameId
    let domainVerifiedAt = old.domainVerifiedAt

    if (newDomain !== oldDomain) {
      // Delete old CF hostname if one existed.
      if (oldDomain && cfHostnameId) {
        try {
          await cfClient.delete(cfHostnameId)
        } catch {
          // Best-effort — log but don't fail so DB stays consistent.
          console.warn(`CF delete failed for hostname ${cfHostnameId}; continuing`)
        }
        cfHostnameId = null
      }

      domainVerifiedAt = null

      // Register new CF hostname if needed.
      if (newDomain && isCfConfigured) {
        try {
          const result = await cfClient.register(newDomain)
          cfHostnameId = result.id || null
        } catch (e) {
          if (e instanceof CfConflictError) {
            return c.json({ error: 'Domain already registered by another organization' }, 409)
          }
          throw e
        }
      }
    }

    const refererAllowlistValue =
      body.refererAllowlist !== undefined
        ? body.refererAllowlist
          ? JSON.stringify(body.refererAllowlist)
          : null
        : old.refererAllowlist

    try {
      await db
        .update(imageHostingConfigs)
        .set({
          customDomain: newDomain,
          cfHostnameId,
          domainVerifiedAt,
          refererAllowlist: refererAllowlistValue,
          updatedAt: now,
        })
        .where(eq(imageHostingConfigs.orgId, orgId))
    } catch (e) {
      if (catchUniqueViolation(e)) {
        return c.json({ error: 'Domain already registered by another organization' }, 409)
      }
      throw e
    }

    return c.json(
      buildResponse(
        {
          customDomain: newDomain,
          cfHostnameId,
          domainVerifiedAt,
          refererAllowlist: refererAllowlistValue,
          createdAt: old.createdAt,
        },
        cnameTarget,
        isCfConfigured,
      ),
    )
  })
  .delete('/', requireTeamRole('owner'), async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)

    const existing = await db.select().from(imageHostingConfigs).where(eq(imageHostingConfigs.orgId, orgId)).limit(1)

    if (existing.length === 0) {
      return c.body(null, 204)
    }

    const row = existing[0]
    const getEnv = c.get('platform').getEnv.bind(c.get('platform'))
    const cfClient = createCfClient(getEnv)

    // Best-effort CF cleanup — do not fail if CF call errors.
    if (row.cfHostnameId) {
      try {
        await cfClient.delete(row.cfHostnameId)
      } catch {
        console.warn(`CF delete failed for hostname ${row.cfHostnameId} during config DELETE; continuing`)
      }
    }

    await db.delete(imageHostingConfigs).where(eq(imageHostingConfigs.orgId, orgId))

    return c.body(null, 204)
  })

export default app
