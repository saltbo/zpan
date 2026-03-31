import { Hono } from 'hono'
import { eq, and, asc, desc, like, sql, count } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Env } from '../middleware/platform'
import { requireAuth } from '../middleware/auth'
import { matters, storages, storageQuotas } from '../db/schema'
import {
  createS3Client,
  getUploadUrl,
  getDownloadUrl,
  headObject,
  deleteObject,
  copyObject,
  expandFilePath,
  selectStorage,
} from '../services/s3'

function extFromName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1)
}

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const parent = c.req.query('parent') ?? ''
    const status = c.req.query('status') ?? 'active'
    const type = c.req.query('type')
    const search = c.req.query('search')
    const page = Math.max(1, Number(c.req.query('page') ?? '1'))
    const pageSize = Math.max(1, Math.min(100, Number(c.req.query('pageSize') ?? '20')))

    const conditions = [
      eq(matters.uid, userId),
      eq(matters.parent, parent),
      eq(matters.status, status),
    ]

    if (type) {
      conditions.push(like(matters.type, `${type}/%`))
    }
    if (search) {
      conditions.push(like(matters.name, `%${search}%`))
    }

    const where = and(...conditions)

    const [{ total }] = await db.select({ total: count() }).from(matters).where(where)

    const items = await db
      .select()
      .from(matters)
      .where(where)
      .orderBy(desc(matters.dirtype), asc(matters.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return c.json({ items, total, page, pageSize })
  })
  .post('/', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const body = await c.req.json()
    const now = new Date()
    const id = nanoid()
    const alias = nanoid(10)

    // Folder creation
    if (body.dirtype && body.dirtype > 0) {
      const [folder] = await db
        .insert(matters)
        .values({
          id,
          uid: userId,
          alias,
          name: body.name,
          type: '',
          size: 0,
          dirtype: body.dirtype,
          parent: body.parent ?? '',
          object: '',
          storageId: '',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      return c.json(folder, 201)
    }

    // File creation — select storage and generate presigned URL
    const allStorages = await db.select().from(storages)
    const storage = selectStorage(allStorages, 'private', body.size ?? 0)
    if (!storage) {
      return c.json({ error: 'No storage capacity available' }, 409)
    }

    const rawExt = extFromName(body.name)
    const objectKey = expandFilePath(storage.filePath, {
      uid: userId,
      rawName: body.name,
      rawExt,
      uuid: id,
    })

    const client = createS3Client(storage)
    const uploadUrl = await getUploadUrl(client, storage.bucket, objectKey, body.type)

    const [matter] = await db
      .insert(matters)
      .values({
        id,
        uid: userId,
        alias,
        name: body.name,
        type: body.type,
        size: body.size ?? 0,
        dirtype: 0,
        parent: body.parent ?? '',
        object: objectKey,
        storageId: storage.id,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return c.json({ matter, uploadUrl }, 201)
  })
  .post('/:id/uploaded', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const id = c.req.param('id')

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))

    if (!matter) return c.json({ error: 'Not found' }, 404)

    const [storage] = await db.select().from(storages).where(eq(storages.id, matter.storageId))

    const client = createS3Client(storage)
    const head = await headObject(client, storage.bucket, matter.object)
    if (!head) return c.json({ error: 'S3 object not found' }, 409)

    const now = new Date()
    const actualSize = head.size

    const [updated] = await db.transaction(async (tx) => {
      const result = await tx
        .update(matters)
        .set({ status: 'active', size: actualSize, updatedAt: now })
        .where(eq(matters.id, id))
        .returning()

      await tx
        .update(storages)
        .set({ usedBytes: sql`${storages.usedBytes} + ${actualSize}` })
        .where(eq(storages.id, matter.storageId))

      await tx
        .insert(storageQuotas)
        .values({ id: nanoid(), uid: userId, quota: 0, used: actualSize })
        .onConflictDoUpdate({
          target: storageQuotas.uid,
          set: { used: sql`${storageQuotas.used} + ${actualSize}` },
        })

      return result
    })

    return c.json(updated)
  })
  .get('/:id', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const id = c.req.param('id')

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))

    if (!matter) return c.json({ error: 'Not found' }, 404)

    // Folders have no download URL
    if (matter.dirtype && matter.dirtype > 0) return c.json(matter)

    const [storage] = await db.select().from(storages).where(eq(storages.id, matter.storageId))

    const client = createS3Client(storage)
    const downloadUrl = await getDownloadUrl(
      client,
      storage.bucket,
      matter.object,
      storage.customHost || undefined,
      storage.mode as 'private' | 'public',
    )

    return c.json({ ...matter, downloadUrl })
  })
  .patch('/:id', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const id = c.req.param('id')
    const body = await c.req.json()

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))

    if (!matter) return c.json({ error: 'Not found' }, 404)

    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (body.name !== undefined) {
      updates.name = body.name
    }

    if (body.parent !== undefined) {
      // Validate target parent exists and belongs to user (unless root)
      if (body.parent !== '') {
        const [parentFolder] = await db
          .select()
          .from(matters)
          .where(and(eq(matters.id, body.parent), eq(matters.uid, userId)))
        if (!parentFolder) return c.json({ error: 'Target parent not found' }, 404)
      }
      updates.parent = body.parent
    }

    const [updated] = await db.update(matters).set(updates).where(eq(matters.id, id)).returning()

    return c.json(updated)
  })
  .patch('/:id/status', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const id = c.req.param('id')
    const { status } = await c.req.json()

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))

    if (!matter) return c.json({ error: 'Not found' }, 404)

    const [updated] = await db
      .update(matters)
      .set({ status, updatedAt: new Date() })
      .where(eq(matters.id, id))
      .returning()

    return c.json(updated)
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const id = c.req.param('id')

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))

    if (!matter) return c.json({ error: 'Not found' }, 404)

    if (matter.dirtype === 0 && matter.object && matter.storageId) {
      const [storage] = await db.select().from(storages).where(eq(storages.id, matter.storageId))

      if (storage) {
        const client = createS3Client(storage)
        await deleteObject(client, storage.bucket, matter.object)
      }
    }

    await db.delete(matters).where(eq(matters.id, id))
    return new Response(null, { status: 204 })
  })
  .post('/:id/copy', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const id = c.req.param('id')
    const { parent } = await c.req.json()

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))

    if (!matter) return c.json({ error: 'Not found' }, 404)

    const [storage] = await db.select().from(storages).where(eq(storages.id, matter.storageId))

    const newId = nanoid()
    const newAlias = nanoid(10)
    const now = new Date()

    // For files, copy the S3 object
    let newObjectKey = ''
    if (matter.dirtype === 0 && matter.object && storage) {
      const rawExt = extFromName(matter.name)
      newObjectKey = expandFilePath(storage.filePath, {
        uid: userId,
        rawName: matter.name,
        rawExt,
        uuid: newId,
      })

      const client = createS3Client(storage)
      await copyObject(client, storage.bucket, matter.object, newObjectKey)

      // Update storage usage and user quota
      await db
        .update(storages)
        .set({ usedBytes: sql`${storages.usedBytes} + ${matter.size}` })
        .where(eq(storages.id, storage.id))

      await db
        .insert(storageQuotas)
        .values({ id: nanoid(), uid: userId, quota: 0, used: matter.size ?? 0 })
        .onConflictDoUpdate({
          target: storageQuotas.uid,
          set: { used: sql`${storageQuotas.used} + ${matter.size}` },
        })
    }

    const [copy] = await db
      .insert(matters)
      .values({
        id: newId,
        uid: userId,
        alias: newAlias,
        name: matter.name,
        type: matter.type,
        size: matter.size,
        dirtype: matter.dirtype,
        parent: parent ?? '',
        object: newObjectKey,
        storageId: matter.storageId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return c.json(copy, 201)
  })

export default app
