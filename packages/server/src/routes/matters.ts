import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { requireAuth } from '../middleware/auth'

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    const userId = c.get('userId')!
    const parent = c.req.query('parent') ?? ''
    // TODO: implement with Drizzle query
    return c.json({ items: [], total: 0, page: 1, pageSize: 20 })
  })
  .post('/', async (c) => {
    // TODO: create matter + generate presigned URL
    return c.json({ message: 'not implemented' }, 501)
  })
  .get('/:alias', async (c) => {
    // TODO: get matter detail + download URL
    return c.json({ message: 'not implemented' }, 501)
  })
  .patch('/:alias/done', async (c) => {
    // TODO: mark upload complete
    return c.json({ message: 'not implemented' }, 501)
  })
  .patch('/:alias/name', async (c) => {
    // TODO: rename
    return c.json({ message: 'not implemented' }, 501)
  })
  .patch('/:alias/location', async (c) => {
    // TODO: move
    return c.json({ message: 'not implemented' }, 501)
  })
  .delete('/:alias', async (c) => {
    // TODO: soft delete (trash)
    return c.json({ message: 'not implemented' }, 501)
  })

export default app
