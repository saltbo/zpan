import { Hono } from 'hono'
import { eq, and, asc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createStorageSchema, updateStorageSchema } from '@zpan/shared/schemas'
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
    const parsed = createStorageSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400)
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
      console.error('[storages] Connection test failed:', err)
      return c.json({ error: 'Connection failed: invalid credentials or bucket not accessible' }, 400)
    }

    const now = new Date()
    const [created] = await db
      .insert(storages)
      .values({ id: nanoid(), ...data, createdAt: now, updatedAt: now })
      .returning()
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

    const parsed = updateStorageSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400)
    }

    const updates = parsed.data
    const credentialsChanged =
      ('endpoint' in updates && updates.endpoint !== existing.endpoint) ||
      ('region' in updates && updates.region !== existing.region) ||
      ('accessKey' in updates && updates.accessKey !== existing.accessKey) ||
      ('secretKey' in updates && updates.secretKey !== existing.secretKey) ||
      ('bucket' in updates && updates.bucket !== existing.bucket)

    if (credentialsChanged) {
      try {
        await testConnection({
          endpoint: updates.endpoint ?? existing.endpoint,
          region: updates.region ?? existing.region,
          accessKey: updates.accessKey ?? existing.accessKey,
          secretKey: updates.secretKey ?? existing.secretKey,
          bucket: updates.bucket ?? existing.bucket,
        })
      } catch (err) {
        console.error('[storages] Connection test failed:', err)
        return c.json({ error: 'Connection failed: invalid credentials or bucket not accessible' }, 400)
      }
    }

    const [updated] = await db
      .update(storages)
      .set({ ...updates, updatedAt: new Date() })
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
      .where(and(eq(matters.storageId, id), eq(matters.status, 'active')))
      .limit(1)

    if (activeFiles.length > 0) {
      return c.json({ error: 'Storage has active files, cannot delete' }, 409)
    }

    await db.delete(storages).where(eq(storages.id, id))
    return new Response(null, { status: 204 })
  })

export default app
