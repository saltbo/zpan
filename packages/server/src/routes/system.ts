import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'

const setOptionSchema = z.object({
  value: z.string(),
  public: z.boolean().optional(),
})

type OptionRow = { key: string; value: string; public: number }

const toOption = (r: OptionRow) => ({ key: r.key, value: r.value, public: !!r.public })

const app = new Hono<Env>()
  .get('/options', async (c) => {
    const db = c.get('platform').db
    const isAdmin = c.get('userRole') === 'admin'
    const rows = isAdmin
      ? await db.all<OptionRow>(sql`SELECT key, value, public FROM system_options ORDER BY key`)
      : await db.all<OptionRow>(sql`SELECT key, value, public FROM system_options WHERE public = 1 ORDER BY key`)
    return c.json({ items: rows.map(toOption), total: rows.length })
  })
  .get('/options/:key', async (c) => {
    const db = c.get('platform').db
    const key = c.req.param('key')
    const rows = await db.all<OptionRow>(sql`SELECT key, value, public FROM system_options WHERE key = ${key}`)
    const row = rows[0]
    if (!row) return c.json({ error: 'Option not found' }, 404)
    if (!row.public && c.get('userRole') !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403)
    }
    return c.json(toOption(row))
  })
  .put('/options/:key', requireAdmin, zValidator('json', setOptionSchema), async (c) => {
    const db = c.get('platform').db
    const key = c.req.param('key')
    const body = c.req.valid('json')
    const isPublic = body.public === undefined ? undefined : body.public ? 1 : 0
    const existing = await db.all<{ key: string; public: number }>(
      sql`SELECT key, public FROM system_options WHERE key = ${key}`,
    )
    if (existing.length > 0) {
      const nextPublic = isPublic ?? existing[0].public
      await db.run(sql`UPDATE system_options SET value = ${body.value}, public = ${nextPublic} WHERE key = ${key}`)
      return c.json({ key, value: body.value, public: !!nextPublic })
    }
    const nextPublic = isPublic ?? 0
    await db.run(sql`INSERT INTO system_options (key, value, public) VALUES (${key}, ${body.value}, ${nextPublic})`)
    return c.json({ key, value: body.value, public: !!nextPublic }, 201)
  })
  .delete('/options/:key', requireAdmin, async (c) => {
    const db = c.get('platform').db
    const key = c.req.param('key')
    await db.run(sql`DELETE FROM system_options WHERE key = ${key}`)
    return c.json({ key, deleted: true })
  })

export default app
