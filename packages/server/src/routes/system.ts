import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Env } from '../middleware/platform'
import { requireAdmin } from '../middleware/auth'
import { systemOptions } from '../db/schema'

const app = new Hono<Env>()
  .get('/options/:key', async (c) => {
    const db = c.get('platform').db
    const key = c.req.param('key')

    const rows = await db.select().from(systemOptions).where(eq(systemOptions.key, key))
    if (rows.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const option = rows[0]
    if (!option.public) {
      const userId = c.get('userId')
      const userRole = c.get('userRole')
      if (!userId || userRole !== 'admin') {
        return c.json({ error: 'Not found' }, 404)
      }
    }

    return c.json({ key: option.key, value: option.value })
  })
  .put('/options/:key', requireAdmin, async (c) => {
    const db = c.get('platform').db
    const key = c.req.param('key')
    const body = await c.req.json<{ value?: string; public?: boolean }>()

    const set: { value?: string; public?: boolean } = {}
    if (body.value !== undefined) set.value = body.value
    if (body.public !== undefined) set.public = body.public
    if (Object.keys(set).length === 0) {
      return c.json({ error: 'No fields to update' }, 400)
    }

    const rows = await db
      .insert(systemOptions)
      .values({ key, value: body.value ?? '', public: body.public ?? false })
      .onConflictDoUpdate({ target: systemOptions.key, set })
      .returning()

    return c.json(rows[0])
  })

export default app
