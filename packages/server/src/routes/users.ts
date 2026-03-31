import { Hono } from 'hono'
import { eq, like, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { Env } from '../middleware/platform'
import { requireAdmin } from '../middleware/auth'
import { user } from '../db/auth-schema'
import { storageQuotas, matters } from '../db/schema'
import type { Database } from '../platform/interface'

// The Database union type breaks .select({}) overload resolution.
// Cast to one branch — runtime is identical for standard query builder ops.
function asDb(db: Database) {
  return db as BetterSQLite3Database<typeof import('../db/schema')>
}

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = asDb(c.get('platform').db)
    const page = Number(c.req.query('page') ?? '1')
    const pageSize = Number(c.req.query('pageSize') ?? '20')
    const search = c.req.query('search')

    const offset = (page - 1) * pageSize
    const where = search
      ? or(like(user.name, `%${search}%`), like(user.email, `%${search}%`))
      : undefined

    const [users, countResult] = await Promise.all([
      db.select().from(user).where(where).limit(pageSize).offset(offset),
      db.select({ total: sql<number>`count(*)` }).from(user).where(where),
    ])

    const quotas = users.length > 0
      ? await db.select().from(storageQuotas)
      : []
    const quotaMap = new Map(quotas.map((q) => [q.uid, q]))
    const items = users.map((u) => ({ ...u, quota: quotaMap.get(u.id) ?? null }))

    return c.json({ items, total: Number(countResult[0].total), page, pageSize })
  })
  .get('/:id', async (c) => {
    const db = asDb(c.get('platform').db)
    const id = c.req.param('id')

    const rows = await db.select().from(user).where(eq(user.id, id))
    if (rows.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const quotaRows = await db.select().from(storageQuotas).where(eq(storageQuotas.uid, id))

    return c.json({ ...rows[0], quota: quotaRows[0] ?? null })
  })
  .patch('/:id', async (c) => {
    const db = asDb(c.get('platform').db)
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = await c.req.json<{ role?: string; banned?: boolean; quota?: number }>()

    const headers = c.req.raw.headers

    if (body.role !== undefined) {
      await auth.api.setRole({
        headers,
        body: { userId: id, role: body.role as 'admin' | 'user' },
      })
    }

    if (body.banned === true) {
      await auth.api.banUser({ headers, body: { userId: id } })
    } else if (body.banned === false) {
      await auth.api.unbanUser({ headers, body: { userId: id } })
    }

    if (body.quota !== undefined) {
      await db
        .insert(storageQuotas)
        .values({ id: crypto.randomUUID(), uid: id, quota: body.quota })
        .onConflictDoUpdate({ target: storageQuotas.uid, set: { quota: body.quota } })
    }

    const rows = await db.select().from(user).where(eq(user.id, id))
    if (rows.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    return c.json(rows[0])
  })
  .delete('/:id', async (c) => {
    const db = asDb(c.get('platform').db)
    const auth = c.get('auth')
    const id = c.req.param('id')
    const currentUserId = c.get('userId')

    if (id === currentUserId) {
      return c.json({ error: 'Cannot delete yourself' }, 400)
    }

    await db.delete(matters).where(eq(matters.uid, id))
    await db.delete(storageQuotas).where(eq(storageQuotas.uid, id))
    await auth.api.removeUser({ headers: c.req.raw.headers, body: { userId: id } })

    return c.body(null, 204)
  })

export default app
