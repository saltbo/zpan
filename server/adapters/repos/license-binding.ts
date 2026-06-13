import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { licenseBindings } from '../../db/schema'
import { executeWriteTransaction } from '../../db/transaction'
import type { Database } from '../../platform/interface'
import type {
  CreateLicenseBindingInput,
  LicenseBindingRepo,
  LicenseBindingStatus,
  LicenseState,
  UpdateLicenseBindingInput,
} from '../../usecases/ports'

async function loadLicenseState(db: Database): Promise<LicenseState> {
  const row = await loadActiveLicenseBinding(db)
  return row ?? emptyLicenseState()
}

async function loadActiveLicenseBinding(db: Database): Promise<LicenseState | null> {
  const rows = await db.select().from(licenseBindings).where(eq(licenseBindings.status, 'active')).limit(1)
  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    cloudBindingId: row.cloudBindingId,
    cloudStoreId: row.cloudStoreId,
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

async function createLicenseBinding(db: Database, input: CreateLicenseBindingInput): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await executeWriteTransaction(db, [
    db
      .update(licenseBindings)
      .set({
        status: 'disconnected',
        refreshToken: null,
        cachedCertificate: null,
        cachedCertificateExpiresAt: null,
        disconnectedAt: now,
        updatedAt: now,
      })
      .where(eq(licenseBindings.status, 'active')),
    db.insert(licenseBindings).values({
      id: nanoid(),
      cloudBindingId: input.cloudBindingId,
      cloudStoreId: input.cloudStoreId ?? null,
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
    }),
  ])
}

async function updateLicenseBindingAfterRefresh(db: Database, input: UpdateLicenseBindingInput): Promise<void> {
  await db
    .update(licenseBindings)
    .set({
      refreshToken: input.refreshToken,
      cloudStoreId: input.cloudStoreId ?? undefined,
      cachedCertificate: input.cachedCert,
      cachedCertificateExpiresAt: input.cachedExpiresAt,
      cloudAccountEmail: input.cloudAccountEmail ?? undefined,
      lastRefreshAt: input.lastRefreshAt,
      lastRefreshError: null,
      updatedAt: input.lastRefreshAt,
    })
    .where(eq(licenseBindings.id, input.id))
}

async function setLicenseRefreshError(db: Database, id: string, error: string): Promise<void> {
  await db
    .update(licenseBindings)
    .set({ lastRefreshError: error, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(licenseBindings.id, id))
}

async function clearLicenseBinding(db: Database, status: LicenseBindingStatus = 'disconnected'): Promise<void> {
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
    cloudStoreId: null,
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

export function createLicenseBindingRepo(db: Database): LicenseBindingRepo {
  return {
    loadLicenseState: () => loadLicenseState(db),
    loadActiveLicenseBinding: () => loadActiveLicenseBinding(db),
    createLicenseBinding: (input) => createLicenseBinding(db, input),
    updateLicenseBindingAfterRefresh: (input) => updateLicenseBindingAfterRefresh(db, input),
    setLicenseRefreshError: (id, error) => setLicenseRefreshError(db, id, error),
    clearLicenseBinding: (status) => clearLicenseBinding(db, status),
  }
}
