import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { FREE_STORAGE_LIMIT } from '../../shared/constants'
import { createStorageSchema, updateStorageSchema } from '../../shared/schemas'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { recordActivity } from '../services/activity'
import {
  countStorages,
  createStorage,
  deleteStorage,
  getStorage,
  listStorages,
  updateStorage,
} from '../services/storage'

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const result = await listStorages(db)
    return c.json(result)
  })
  .post('/', zValidator('json', createStorageSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const [total, state] = await Promise.all([countStorages(db), loadBindingState(db)])
    if (!hasFeature('storages_unlimited', state) && total >= FREE_STORAGE_LIMIT) {
      return c.json(
        {
          error: 'feature_not_available',
          feature: 'storages_unlimited',
          currentCount: total,
          limit: FREE_STORAGE_LIMIT,
        },
        402,
      )
    }
    const storage = await createStorage(db, c.req.valid('json'))
    await recordActivity(db, {
      orgId,
      userId,
      action: 'storage_create',
      targetType: 'storage',
      targetId: storage.id,
      targetName: storage.title,
      metadata: { mode: storage.mode },
    })
    return c.json(storage, 201)
  })
  .get('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const storage = await getStorage(db, id)
    if (!storage) return c.json({ error: 'Storage not found' }, 404)
    return c.json(storage)
  })
  .put('/:id', zValidator('json', updateStorageSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const id = c.req.param('id')
    const storage = await updateStorage(db, id, c.req.valid('json'))
    if (!storage) return c.json({ error: 'Storage not found' }, 404)
    await recordActivity(db, {
      orgId,
      userId,
      action: 'storage_update',
      targetType: 'storage',
      targetId: storage.id,
      targetName: storage.title,
      metadata: { mode: storage.mode },
    })
    return c.json(storage)
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const id = c.req.param('id')
    const existing = await getStorage(db, id)
    const result = await deleteStorage(db, id)
    if (result === 'not_found') return c.json({ error: 'Storage not found' }, 404)
    if (result === 'in_use') return c.json({ error: 'Storage is referenced by existing files' }, 409)
    await recordActivity(db, {
      orgId,
      userId,
      action: 'storage_delete',
      targetType: 'storage',
      targetId: id,
      targetName: existing?.title ?? id,
      metadata: { mode: existing?.mode },
    })
    return c.json({ id, deleted: true })
  })

export default app
