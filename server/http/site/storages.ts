import { zValidator } from '@hono/zod-validator'
import { createStorageSchema, updateStorageSchema } from '@shared/schemas'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import {
  createStorage,
  deleteStorage,
  getStorage,
  listStorages,
  type StorageFeatureBlock,
  updateStorage,
} from '../../usecases/site/storage'

const featureNotAvailable = (block: StorageFeatureBlock) => ({ error: 'feature_not_available', ...block }) as const

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => c.json(await listStorages(c.get('deps'))))
  .post('/', zValidator('json', createStorageSchema), async (c) => {
    const result = await createStorage(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      input: c.req.valid('json'),
    })
    if (!result.ok) return c.json(featureNotAvailable(result.block), 402)
    return c.json(result.storage, 201)
  })
  .get('/:id', async (c) => {
    const storage = await getStorage(c.get('deps'), c.req.param('id'))
    if (!storage) return c.json({ error: 'Storage not found' }, 404)
    return c.json(storage)
  })
  .put('/:id', zValidator('json', updateStorageSchema), async (c) => {
    const result = await updateStorage(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      id: c.req.param('id'),
      input: c.req.valid('json'),
    })
    if (result.ok) return c.json(result.storage)
    if (result.reason === 'not_found') return c.json({ error: 'Storage not found' }, 404)
    return c.json(featureNotAvailable(result.block), 402)
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id')
    const result = await deleteStorage(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      id,
    })
    if (result.ok) return c.json({ id, deleted: true })
    if (result.reason === 'not_found') return c.json({ error: 'Storage not found' }, 404)
    return c.json({ error: 'Storage is referenced by existing files' }, 409)
  })

export default app
