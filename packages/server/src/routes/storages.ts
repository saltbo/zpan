import { Hono } from 'hono'
import { eq, asc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createStorageSchema } from '@zpan/shared/schemas'
import type { Env } from '../middleware/platform'
import { requireAdmin } from '../middleware/auth'
import { storages, matters } from '../db/schema'
import { testConnection } from '../services/s3'

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const rows = await db.select().from(storages).orderBy(asc(storages.priority))
    return c.json({ items: rows, total: rows.length })
  })
  .post('/', async (c) => {
    const db = c.get('platform').db
    const body = await c.req.json()
    const parsed = createStorageSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400)
    }

    const data = parsed.data
    try {
      await testConnection({
        endpoint: data.endpoint,
        region: data.region,
        accessKey: data.accessKey,
        secretKey: data.secretKey,
        bucket: data.bucket,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: `Connection failed: ${message}` }, 400)
    }

    const now = new Date()
    const record = {
      id: nanoid(),
      ...data,
      usedBytes: 0,
      status: 1,
      createdAt: now,
      updatedAt: now,
    }

    const [created] = await db.insert(storages).values(record).returning()
    return c.json(created, 201)
  })
  .get('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const [row] = await db.select().from(storages).where(eq(storages.id, id))
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
  })
  .put('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')

    const [existing] = await db.select().from(storages).where(eq(storages.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)

    const body = await c.req.json()
    const credentialsChanged =
      (body.endpoint && body.endpoint !== existing.endpoint) ||
      (body.accessKey && body.accessKey !== existing.accessKey) ||
      (body.secretKey && body.secretKey !== existing.secretKey) ||
      (body.bucket && body.bucket !== existing.bucket) ||
      (body.region && body.region !== existing.region)

    if (credentialsChanged) {
      try {
        await testConnection({
          endpoint: body.endpoint ?? existing.endpoint,
          region: body.region ?? existing.region,
          accessKey: body.accessKey ?? existing.accessKey,
          secretKey: body.secretKey ?? existing.secretKey,
          bucket: body.bucket ?? existing.bucket,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ error: `Connection failed: ${message}` }, 400)
      }
    }

    const [updated] = await db
      .update(storages)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(storages.id, id))
      .returning()
    return c.json(updated)
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')

    const [existing] = await db.select().from(storages).where(eq(storages.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)

    const activeFiles = await db
      .select()
      .from(matters)
      .where(eq(matters.storageId, id))
      .limit(1)

    if (activeFiles.length > 0) {
      return c.json({ error: 'Storage has active files, cannot delete' }, 409)
    }

    await db.delete(storages).where(eq(storages.id, id))
    return new Response(null, { status: 204 })
  })

export default app
