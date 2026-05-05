import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import {
  createQuotaStorePackageSchema,
  putQuotaStoreSettingsSchema,
  updateQuotaStorePackageSchema,
} from '../../shared/schemas'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import {
  createQuotaStorePackage,
  deleteQuotaStorePackage,
  getQuotaStorePackage,
  getQuotaStoreSettings,
  listQuotaStorePackages,
  putQuotaStoreSettings,
  syncPackageToCloud,
  updateQuotaStorePackage,
} from '../services/quota-store'

const adminQuotaStore = new Hono<Env>()
  .use(requireAdmin)
  .use(requireFeature('quota_store'))

  // ─── Settings ──────────────────────────────────────────────────────────────
  .get('/settings', async (c) => {
    const db = c.get('platform').db
    const settings = await getQuotaStoreSettings(db)
    return c.json(settings)
  })
  .put('/settings', zValidator('json', putQuotaStoreSettingsSchema), async (c) => {
    const db = c.get('platform').db
    const input = c.req.valid('json')
    const settings = await putQuotaStoreSettings(db, input)
    return c.json(settings)
  })

  // ─── Packages ──────────────────────────────────────────────────────────────
  .get('/packages', async (c) => {
    const db = c.get('platform').db
    const packages = await listQuotaStorePackages(db, false)
    return c.json({ items: packages, total: packages.length })
  })
  .post('/packages', zValidator('json', createQuotaStorePackageSchema), async (c) => {
    const db = c.get('platform').db
    const input = c.req.valid('json')
    const pkg = await createQuotaStorePackage(db, input)

    // Attempt catalog sync; surface sync errors in the response.
    const settings = await getQuotaStoreSettings(db)
    const cloudBaseUrl = settings.cloudBaseUrl ?? c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const sync = await syncPackageToCloud(db, pkg, cloudBaseUrl)
    const updated = await getQuotaStorePackage(db, pkg.id)

    return c.json({ package: updated ?? pkg, syncError: sync.cloudSyncStatus === 'error' ? sync.error : null }, 201)
  })
  .get('/packages/:id', async (c) => {
    const db = c.get('platform').db
    const pkg = await getQuotaStorePackage(db, c.req.param('id'))
    if (!pkg) return c.json({ error: 'Not found' }, 404)
    return c.json(pkg)
  })
  .patch('/packages/:id', zValidator('json', updateQuotaStorePackageSchema), async (c) => {
    const db = c.get('platform').db
    const input = c.req.valid('json')
    const updated = await updateQuotaStorePackage(db, c.req.param('id'), input)
    if (!updated) return c.json({ error: 'Not found' }, 404)

    // Re-sync to Cloud after update.
    const settings = await getQuotaStoreSettings(db)
    const cloudBaseUrl = settings.cloudBaseUrl ?? c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const sync = await syncPackageToCloud(db, updated, cloudBaseUrl)
    const final = await getQuotaStorePackage(db, updated.id)

    return c.json({ package: final ?? updated, syncError: sync.cloudSyncStatus === 'error' ? sync.error : null })
  })
  .delete('/packages/:id', async (c) => {
    const db = c.get('platform').db
    const ok = await deleteQuotaStorePackage(db, c.req.param('id'))
    if (!ok) return c.json({ error: 'Not found' }, 404)
    return c.json({ deleted: true })
  })

export default adminQuotaStore
