import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { requireAuth } from '../middleware/auth'

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    const userId = c.get('userId')!
    const _parent = c.req.query('parent') ?? ''
    const _status = c.req.query('status') ?? 'active'
    const _type = c.req.query('type')
    const _search = c.req.query('search')
    const _page = Number(c.req.query('page') ?? '1')
    const _pageSize = Number(c.req.query('pageSize') ?? '20')
    // TODO: Drizzle query with filters
    return c.json({ items: [], total: 0, page: _page, pageSize: _pageSize })
  })
  .post('/', async (c) => {
    // TODO: create object (file or folder), return presigned URL for files
    return c.json({ message: 'not implemented' }, 501)
  })
  .get('/:id', async (c) => {
    // TODO: get object detail + download URL
    return c.json({ message: 'not implemented' }, 501)
  })
  .patch('/:id', async (c) => {
    // TODO: update attributes (name, parent)
    return c.json({ message: 'not implemented' }, 501)
  })
  .patch('/:id/status', async (c) => {
    // TODO: status transition (active, trashed)
    // active: upload done or restore from trash
    // trashed: move to recycle bin
    return c.json({ message: 'not implemented' }, 501)
  })
  .delete('/:id', async (c) => {
    // TODO: permanent delete (DB record + S3 object)
    return c.json({ message: 'not implemented' }, 501)
  })
  .post('/:id/copy', async (c) => {
    // TODO: copy object to target parent
    return c.json({ message: 'not implemented' }, 501)
  })

export default app
