import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Env } from '../middleware/platform'
import { requireAdmin } from '../middleware/auth'
import { systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'

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
    const body = await c.req.json<{ value: string; public?: boolean }>()

    const set: Record<string, unknown> = { value: body.value }
    if (body.public !== undefined) {
      set.public = body.public
    }

    const rows = await db
      .insert(systemOptions)
      .values({ key, value: body.value, public: body.public ?? false })
      .onConflictDoUpdate({ target: systemOptions.key, set })
      .returning()

    return c.json(rows[0])
  })

export default app

const defaultOptions = [
  { key: 'site.name', value: 'ZPan', public: true },
  { key: 'site.description', value: 'S3-native file hosting', public: true },
]

export async function seedSystemOptions(db: Database) {
  for (const opt of defaultOptions) {
    await db
      .insert(systemOptions)
      .values(opt)
      .onConflictDoNothing({ target: systemOptions.key })
  }
}
