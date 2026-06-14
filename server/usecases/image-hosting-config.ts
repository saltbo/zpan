// The image-hosting config resource usecase. Owns every business decision behind
// the /api/ihost/config routes — the per-org config row lifecycle and, with it,
// the Cloudflare custom-hostname lifecycle: lazily verifying a pending domain on
// read, registering / deleting CF hostnames on write, rejecting the app's own
// host, detecting duplicate-domain conflicts (CF 409 + DB UNIQUE), and the
// best-effort CF cleanup on delete. The http handler only validates the body,
// resolves the request-scoped CF env, calls these functions, and serializes the
// ImageHostingConfigRecord into the IhostConfigResponse DTO.
//
// Expected business outcomes (no config, app-host-rejected, domain conflict)
// come back as discriminated unions; the handler maps each to its HTTP status.
// CF registration errors that are *not* conflicts propagate so the handler 500s.

import type { PutIhostConfigInput } from '@shared/schemas'
import {
  CfConflictError,
  type CfHostnamesProvider,
  type ImageHostingConfigRecord,
  type ImageHostingConfigRepo,
} from './ports'

export type ImageHostingConfigDeps = {
  imageHostingConfigs: ImageHostingConfigRepo
  cfHostnames: CfHostnamesProvider
}

// The request-scoped Cloudflare settings the http layer resolves from the
// platform env and hands to the write/read functions. `apiToken` presence is the
// "CF is configured" switch; the usecase never reads infrastructure itself.
export interface CfSettings {
  isConfigured: boolean
  appHost: string | null
}

// A DB UNIQUE-constraint failure on the custom-domain column means another org
// already claimed the domain. Adapters surface it as a thrown error; recognize
// it here so the http layer maps to a flat 409.
function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes('UNIQUE constraint failed') || msg.includes('unique constraint')
}

// ── GET ──────────────────────────────────────────────────────────────────────
// Read the config, lazily verifying a pending custom domain when CF is
// configured. Returns null when no config row exists (handler → { enabled:false }).

export async function getImageHostingConfig(
  deps: ImageHostingConfigDeps,
  orgId: string,
  cf: CfSettings,
): Promise<ImageHostingConfigRecord | null> {
  const row = await deps.imageHostingConfigs.getByOrg(orgId)
  if (!row) return null

  // Lazily refresh verification status when domain is unverified and CF is configured.
  if (row.customDomain && !row.domainVerifiedAt && row.cfHostnameId && cf.isConfigured) {
    const status = await deps.cfHostnames.getStatus(row.cfHostnameId)
    if (status.status === 'active') {
      const now = new Date()
      await deps.imageHostingConfigs.update(orgId, { domainVerifiedAt: now })
      row.domainVerifiedAt = now
    }
  }

  return row
}

// ── PUT ──────────────────────────────────────────────────────────────────────

export type PutImageHostingConfigOutcome =
  | { ok: true; config: ImageHostingConfigRecord }
  | { ok: false; reason: 'app_host'; status: number }
  | { ok: false; reason: 'domain_conflict'; status: number }

// Create or update the config row, threading the CF hostname lifecycle. The
// returned record mirrors what was persisted (timestamps as Date) so the handler
// can serialize it directly without a re-read.
export async function putImageHostingConfig(
  deps: ImageHostingConfigDeps,
  orgId: string,
  body: PutIhostConfigInput,
  cf: CfSettings,
): Promise<PutImageHostingConfigOutcome> {
  // Reject the app's own default host as a custom domain.
  if (body.customDomain && cf.appHost && body.customDomain === cf.appHost) {
    return { ok: false, reason: 'app_host', status: 400 }
  }

  const existing = await deps.imageHostingConfigs.getByOrg(orgId)

  const now = new Date()
  const newDomain = body.customDomain ?? null
  const newReferers = body.refererAllowlist !== undefined ? body.refererAllowlist : null

  if (!existing) {
    // Insert new config row.
    let cfHostnameId: string | null = null
    if (newDomain && cf.isConfigured) {
      try {
        const result = await deps.cfHostnames.register(newDomain)
        cfHostnameId = result.id || null
      } catch (e) {
        if (e instanceof CfConflictError) return { ok: false, reason: 'domain_conflict', status: 409 }
        throw e
      }
    }

    const refererAllowlist = newReferers ? JSON.stringify(newReferers) : null
    try {
      await deps.imageHostingConfigs.create({ orgId, customDomain: newDomain, cfHostnameId, refererAllowlist })
    } catch (e) {
      if (isUniqueViolation(e)) return { ok: false, reason: 'domain_conflict', status: 409 }
      throw e
    }

    return {
      ok: true,
      config: {
        orgId,
        customDomain: newDomain,
        cfHostnameId,
        domainVerifiedAt: null,
        refererAllowlist,
        createdAt: now,
        updatedAt: now,
      },
    }
  }

  // Update existing config row.
  const old = existing
  const oldDomain = old.customDomain
  let cfHostnameId = old.cfHostnameId
  let domainVerifiedAt = old.domainVerifiedAt

  if (newDomain !== oldDomain) {
    // Delete old CF hostname if one existed.
    if (oldDomain && cfHostnameId) {
      try {
        await deps.cfHostnames.delete(cfHostnameId)
      } catch {
        // Best-effort — log but don't fail so DB stays consistent.
        console.warn(`CF delete failed for hostname ${cfHostnameId}; continuing`)
      }
      cfHostnameId = null
    }

    domainVerifiedAt = null

    // Register new CF hostname if needed.
    if (newDomain && cf.isConfigured) {
      try {
        const result = await deps.cfHostnames.register(newDomain)
        cfHostnameId = result.id || null
      } catch (e) {
        if (e instanceof CfConflictError) return { ok: false, reason: 'domain_conflict', status: 409 }
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
    await deps.imageHostingConfigs.update(orgId, {
      customDomain: newDomain,
      cfHostnameId,
      domainVerifiedAt,
      refererAllowlist: refererAllowlistValue,
    })
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: 'domain_conflict', status: 409 }
    throw e
  }

  return {
    ok: true,
    config: {
      orgId,
      customDomain: newDomain,
      cfHostnameId,
      domainVerifiedAt,
      refererAllowlist: refererAllowlistValue,
      createdAt: old.createdAt,
      updatedAt: now,
    },
  }
}

// ── DELETE ─────────────────────────────────────────────────────────────────────
// Best-effort CF cleanup then remove the row. Idempotent: a missing row is a
// no-op success.

export async function deleteImageHostingConfig(deps: ImageHostingConfigDeps, orgId: string): Promise<void> {
  const row = await deps.imageHostingConfigs.getByOrg(orgId)
  if (!row) return

  // Best-effort CF cleanup — do not fail if CF call errors.
  if (row.cfHostnameId) {
    try {
      await deps.cfHostnames.delete(row.cfHostnameId)
    } catch {
      console.warn(`CF delete failed for hostname ${row.cfHostnameId} during config DELETE; continuing`)
    }
  }

  await deps.imageHostingConfigs.delete(orgId)
}
