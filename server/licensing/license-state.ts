import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { licenseBindings } from '../db/schema'
import type { Database } from '../platform/interface'

export type LicenseBindingStatus = 'active' | 'disconnected' | 'revoked'

export interface LicenseState {
  id: string
  cloudBindingId: string
  instanceId: string
  cloudAccountId: string
  cloudAccountEmail: string | null
  status: LicenseBindingStatus
  refreshToken: string | null
  cachedCert: string | null
  cachedExpiresAt: number | null
  boundAt: number
  disconnectedAt: number | null
  lastRefreshAt: number | null
  lastRefreshError: string | null
}

export async function loadLicenseState(db: Database): Promise<LicenseState> {
  const row = await loadActiveLicenseBinding(db)
  return row ?? emptyLicenseState()
}

export async function loadActiveLicenseBinding(db: Database): Promise<LicenseState | null> {
  const rows = await db.select().from(licenseBindings).where(eq(licenseBindings.status, 'active')).limit(1)
  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    cloudBindingId: row.cloudBindingId,
    instanceId: row.instanceId,
    cloudAccountId: row.cloudAccountId,
    cloudAccountEmail: row.cloudAccountEmail,
    status: row.status as LicenseBindingStatus,
    refreshToken: row.refreshToken,
    cachedCert: row.cachedCertificate,
    cachedExpiresAt: row.cachedCertificateExpiresAt,
    boundAt: row.boundAt,
    disconnectedAt: row.disconnectedAt,
    lastRefreshAt: row.lastRefreshAt,
    lastRefreshError: row.lastRefreshError,
  }
}

export async function createLicenseBinding(
  db: Database,
  input: {
    cloudBindingId: string
    instanceId: string
    cloudAccountId: string
    cloudAccountEmail?: string | null
    refreshToken: string
    cachedCert: string
    cachedExpiresAt: number
    lastRefreshAt: number
  },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await clearLicenseBinding(db)
  await db.insert(licenseBindings).values({
    id: nanoid(),
    cloudBindingId: input.cloudBindingId,
    instanceId: input.instanceId,
    cloudAccountId: input.cloudAccountId,
    cloudAccountEmail: input.cloudAccountEmail ?? null,
    status: 'active',
    refreshToken: input.refreshToken,
    cachedCertificate: input.cachedCert,
    cachedCertificateExpiresAt: input.cachedExpiresAt,
    boundAt: now,
    lastRefreshAt: input.lastRefreshAt,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateLicenseBindingAfterRefresh(
  db: Database,
  input: {
    id: string
    refreshToken: string
    cachedCert: string
    cachedExpiresAt: number
    cloudAccountEmail?: string | null
    lastRefreshAt: number
  },
): Promise<void> {
  await db
    .update(licenseBindings)
    .set({
      refreshToken: input.refreshToken,
      cachedCertificate: input.cachedCert,
      cachedCertificateExpiresAt: input.cachedExpiresAt,
      cloudAccountEmail: input.cloudAccountEmail ?? undefined,
      lastRefreshAt: input.lastRefreshAt,
      lastRefreshError: null,
      updatedAt: input.lastRefreshAt,
    })
    .where(eq(licenseBindings.id, input.id))
}

export async function setLicenseRefreshError(db: Database, id: string, error: string): Promise<void> {
  await db
    .update(licenseBindings)
    .set({ lastRefreshError: error, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(licenseBindings.id, id))
}

export async function clearLicenseBinding(db: Database, status: LicenseBindingStatus = 'disconnected'): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await db
    .update(licenseBindings)
    .set({
      status,
      refreshToken: null,
      cachedCertificate: null,
      cachedCertificateExpiresAt: null,
      disconnectedAt: now,
      updatedAt: now,
    })
    .where(eq(licenseBindings.status, 'active'))
}

function emptyLicenseState(): LicenseState {
  return {
    id: '',
    cloudBindingId: '',
    instanceId: '',
    cloudAccountId: '',
    cloudAccountEmail: null,
    status: 'disconnected',
    refreshToken: null,
    cachedCert: null,
    cachedExpiresAt: null,
    boundAt: 0,
    disconnectedAt: null,
    lastRefreshAt: null,
    lastRefreshError: null,
  }
}
