import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { FREE_STORAGE_LIMIT } from '../../shared/constants'
import { createStorageSchema, updateStorageSchema } from '../../shared/schemas'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'

function enablesEgressCreditBilling(input: { egressCreditBillingEnabled?: boolean }) {
  return input.egressCreditBillingEnabled === true
}

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const result = await c.get('deps').storages.list()
    return c.json(result)
  })
  .post('/', zValidator('json', createStorageSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const [total, state] = await Promise.all([c.get('deps').storages.count(), loadBindingState(db)])
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
    const input = c.req.valid('json')
    if (enablesEgressCreditBilling(input) && !hasFeature('quota_store', state)) {
      return c.json({ error: 'feature_not_available', feature: 'quota_store' }, 402)
    }
    const storage = await c.get('deps').storages.create(input)
    await c.get('deps').activity.record({
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
    const id = c.req.param('id')
    const storage = await c.get('deps').storages.get(id)
    if (!storage) return c.json({ error: 'Storage not found' }, 404)
    return c.json(storage)
  })
  .put('/:id', zValidator('json', updateStorageSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const id = c.req.param('id')
    const input = c.req.valid('json')
    if (enablesEgressCreditBilling(input) && !hasFeature('quota_store', await loadBindingState(db))) {
      return c.json({ error: 'feature_not_available', feature: 'quota_store' }, 402)
    }
    const storage = await c.get('deps').storages.update(id, input)
    if (!storage) return c.json({ error: 'Storage not found' }, 404)
    await c.get('deps').activity.record({
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
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const id = c.req.param('id')
    const existing = await c.get('deps').storages.get(id)
    const result = await c.get('deps').storages.delete(id)
    if (result === 'not_found') return c.json({ error: 'Storage not found' }, 404)
    if (result === 'in_use') return c.json({ error: 'Storage is referenced by existing files' }, 409)
    await c.get('deps').activity.record({
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
