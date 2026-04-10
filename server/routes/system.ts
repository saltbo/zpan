import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { systemOptions } from '../db/schema'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'

const setOptionSchema = z.object({
  value: z.string(),
  public: z.boolean().optional(),
})

const app = new Hono<Env>()
  .get('/options', async (c) => {
    const db = c.get('platform').db
    const isAdmin = c.get('userRole') === 'admin'
    const rows = isAdmin
      ? await db.select().from(systemOptions)
      : await db.select().from(systemOptions).where(eq(systemOptions.public, true))
    const items = rows.map((r) => ({ key: r.key, value: r.value, public: !!r.public }))
    return c.json({ items, total: items.length })
  })
  .get('/options/:key', async (c) => {
    const db = c.get('platform').db
    const key = c.req.param('key')
    const rows = await db.select().from(systemOptions).where(eq(systemOptions.key, key))
    const row = rows[0]
    if (!row) return c.json({ error: 'Option not found' }, 404)
    if (!row.public && c.get('userRole') !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403)
    }
    return c.json({ key: row.key, value: row.value, public: !!row.public })
  })
  .put('/options/:key', requireAdmin, zValidator('json', setOptionSchema), async (c) => {
    const db = c.get('platform').db
    const key = c.req.param('key')
    const body = c.req.valid('json')
    const existing = await db
      .select({ key: systemOptions.key, public: systemOptions.public })
      .from(systemOptions)
      .where(eq(systemOptions.key, key))
    if (existing.length > 0) {
      const nextPublic = body.public ?? existing[0].public
      await db.update(systemOptions).set({ value: body.value, public: nextPublic }).where(eq(systemOptions.key, key))
      return c.json({ key, value: body.value, public: !!nextPublic })
    }
    const nextPublic = body.public ?? false
    await db.insert(systemOptions).values({ key, value: body.value, public: nextPublic })
    return c.json({ key, value: body.value, public: !!nextPublic }, 201)
  })
  .delete('/options/:key', requireAdmin, async (c) => {
    const db = c.get('platform').db
    const key = c.req.param('key')
    await db.delete(systemOptions).where(eq(systemOptions.key, key))
    return c.json({ key, deleted: true })
  })

export default app
