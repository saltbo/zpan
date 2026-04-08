import { batchIdsSchema, batchMoveSchema } from '@zpan/shared/schemas'
import type { Storage as SharedStorage } from '@zpan/shared/types'
import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { batchDelete, batchMove, batchTrash, MatterNotFoundError, MatterNotTrashedError } from '../services/matter'
import { getStorage } from '../services/storage'

const app = new Hono<Env>()
  .use(requireAuth)
  .post('/move', async (c) => {
    const orgId = c.get('orgId')!
    const db = c.get('platform').db
    const parsed = batchMoveSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

    try {
      await batchMove(db, orgId, parsed.data.ids, parsed.data.parent)
      return c.json({ ok: true })
    } catch (e) {
      if (e instanceof MatterNotFoundError) return c.json({ error: e.message }, 404)
      /* v8 ignore next */
      throw e
    }
  })
  .post('/trash', async (c) => {
    const orgId = c.get('orgId')!
    const db = c.get('platform').db
    const parsed = batchIdsSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

    try {
      await batchTrash(db, orgId, parsed.data.ids)
      return c.json({ ok: true })
    } catch (e) {
      if (e instanceof MatterNotFoundError) return c.json({ error: e.message }, 404)
      /* v8 ignore next */
      throw e
    }
  })
  .post('/delete', async (c) => {
    const orgId = c.get('orgId')!
    const db = c.get('platform').db
    const parsed = batchIdsSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

    try {
      const result = await batchDelete(db, orgId, parsed.data.ids)
      /* v8 ignore start -- S3 integration requires live storage */
      if (result) {
        const storage = await getStorage(db, result.storageId)
        if (storage) {
          const { S3Service } = await import('../services/s3')
          await new S3Service().deleteObjects(storage as unknown as SharedStorage, result.objectKeys)
        }
      }
      /* v8 ignore stop */
      return c.json({ ok: true })
    } catch (e) {
      if (e instanceof MatterNotFoundError) return c.json({ error: e.message }, 404)
      if (e instanceof MatterNotTrashedError) return c.json({ error: e.message }, 400)
      /* v8 ignore next */
      throw e
    }
  })

export default app
