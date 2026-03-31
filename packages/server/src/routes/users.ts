import { Hono } from 'hono'
import { eq, like, or, sql, inArray } from 'drizzle-orm'
import type { Env } from '../middleware/platform'
import { requireAdmin } from '../middleware/auth'
import { user } from '../db/auth-schema'
import { storageQuotas, matters, storages } from '../db/schema'

const VALID_ROLES = ['admin', 'user'] as const
const MAX_PAGE_SIZE = 100

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const page = Math.max(1, Number(c.req.query('page') ?? '1'))
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query('pageSize') ?? '20')))
    const search = c.req.query('search')

    const offset = (page - 1) * pageSize
    const where = search
      ? or(like(user.name, `%${search}%`), like(user.email, `%${search}%`))
      : undefined

    const [users, countResult] = await Promise.all([
      db.select().from(user).where(where).limit(pageSize).offset(offset),
      db.select({ total: sql<number>`count(*)` }).from(user).where(where),
    ])

    const uids = users.map((u) => u.id)
    const quotas = uids.length > 0
      ? await db.select().from(storageQuotas).where(inArray(storageQuotas.uid, uids))
      : []
    const quotaMap = new Map(quotas.map((q) => [q.uid, q]))
    const items = users.map((u) => ({ ...u, quota: quotaMap.get(u.id) ?? null }))

    return c.json({ items, total: Number(countResult[0].total), page, pageSize })
  })
  .get('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')

    const rows = await db.select().from(user).where(eq(user.id, id))
    if (rows.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const quotaRows = await db.select().from(storageQuotas).where(eq(storageQuotas.uid, id))

    return c.json({ ...rows[0], quota: quotaRows[0] ?? null })
  })
  .patch('/:id', async (c) => {
    const db = c.get('platform').db
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = await c.req.json<{ role?: string; banned?: boolean; quota?: number }>()

    const rows = await db.select().from(user).where(eq(user.id, id))
    if (rows.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const headers = c.req.raw.headers

    if (body.role !== undefined) {
      if (!VALID_ROLES.includes(body.role as typeof VALID_ROLES[number])) {
        return c.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, 400)
      }
      const role = body.role as typeof VALID_ROLES[number]
      await auth.api.setRole({ headers, body: { userId: id, role } })
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

    const updated = await db.select().from(user).where(eq(user.id, id))
    const quotaRows = await db.select().from(storageQuotas).where(eq(storageQuotas.uid, id))

    return c.json({ ...updated[0], quota: quotaRows[0] ?? null })
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const auth = c.get('auth')
    const id = c.req.param('id')
    const currentUserId = c.get('userId')

    if (id === currentUserId) {
      return c.json({ error: 'Cannot delete yourself' }, 400)
    }

    // TODO: S3 object cleanup — iterate matters grouped by storageId,
    // build S3 clients from storages table, and delete objects before
    // removing DB records. Blocked on S3 service (not yet implemented).

    await db.transaction(async (tx) => {
      await tx.delete(matters).where(eq(matters.uid, id))
      await tx.delete(storageQuotas).where(eq(storageQuotas.uid, id))
    })
    await auth.api.removeUser({ headers: c.req.raw.headers, body: { userId: id } })

    return c.body(null, 204)
  })

export default app
