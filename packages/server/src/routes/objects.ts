import { Hono } from 'hono'
import { eq, and, asc, desc, like, sql, count, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Env } from '../middleware/platform'
import { requireAuth } from '../middleware/auth'
import { matters, storages, storageQuotas } from '../db/schema'
import {
  createS3Client,
  getUploadUrl,
  getDownloadUrl,
  headObject,
  copyObject,
  expandFilePath,
  selectStorage,
} from '../services/s3'
import { collectDescendants, permanentDeleteMatters } from '../services/objects'

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

    // File creation — user uploads always go to private storage
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

    if (status !== 'active' && status !== 'trashed') {
      return c.json({ error: 'Status must be active or trashed' }, 400)
    }

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))

    if (!matter) return c.json({ error: 'Not found' }, 404)

    const now = new Date()
    const idsToUpdate = [id]

    if (matter.dirtype && matter.dirtype > 0) {
      const descendants = await collectDescendants(db, [id], userId)
      idsToUpdate.push(...descendants.map((d) => d.id))
    }

    await db.update(matters).set({ status, updatedAt: now }).where(inArray(matters.id, idsToUpdate))

    const [updated] = await db.select().from(matters).where(eq(matters.id, id))

    return c.json(updated)
  })
  .delete('/trash', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!

    const trashed = await db
      .select()
      .from(matters)
      .where(and(eq(matters.uid, userId), eq(matters.status, 'trashed')))

    if (trashed.length === 0) return new Response(null, { status: 204 })

    await permanentDeleteMatters(db, userId, trashed)

    return new Response(null, { status: 204 })
  })
  .post('/batch', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { ids, action, parent } = await c.req.json()

    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }

    const targets = await db
      .select()
      .from(matters)
      .where(and(eq(matters.uid, userId), inArray(matters.id, ids)))

    if (targets.length === 0) return c.json({ error: 'Not found' }, 404)

    if (action === 'trash' || action === 'restore') {
      const status = action === 'trash' ? 'trashed' : 'active'
      const allIds = [...ids]

      const folderIds = targets.filter((m) => m.dirtype && m.dirtype > 0).map((m) => m.id)
      if (folderIds.length > 0) {
        const descendants = await collectDescendants(db, folderIds, userId)
        allIds.push(...descendants.map((d) => d.id))
      }

      await db
        .update(matters)
        .set({ status, updatedAt: new Date() })
        .where(inArray(matters.id, allIds))

      return c.json({ affected: allIds.length })
    }

    if (action === 'delete') {
      const nonTrashed = targets.find((m) => m.status !== 'trashed')
      if (nonTrashed) {
        return c.json({ error: 'Must be trashed before permanent delete' }, 409)
      }

      const allItems = [...targets]
      const folderIds = targets.filter((m) => m.dirtype && m.dirtype > 0).map((m) => m.id)
      if (folderIds.length > 0) {
        const descendants = await collectDescendants(db, folderIds, userId)
        allItems.push(...descendants)
      }

      const affected = await permanentDeleteMatters(db, userId, allItems)
      return c.json({ affected })
    }

    if (action === 'move') {
      if (parent === undefined) {
        return c.json({ error: 'parent is required for move action' }, 400)
      }

      if (parent !== '') {
        const [parentFolder] = await db
          .select()
          .from(matters)
          .where(and(eq(matters.id, parent), eq(matters.uid, userId)))
        if (!parentFolder) return c.json({ error: 'Target parent not found' }, 404)
      }

      await db
        .update(matters)
        .set({ parent, updatedAt: new Date() })
        .where(inArray(matters.id, ids))

      return c.json({ affected: targets.length })
    }

    return c.json({ error: 'Invalid action' }, 400)
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
    if (matter.status !== 'trashed') {
      return c.json({ error: 'Must be trashed before permanent delete' }, 409)
    }

    const allItems = [matter]
    if (matter.dirtype && matter.dirtype > 0) {
      const descendants = await collectDescendants(db, [id], userId)
      allItems.push(...descendants)
    }

    await permanentDeleteMatters(db, userId, allItems)

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

    // For files, copy the S3 object first (outside transaction)
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
    }

    const [copy] = await db.transaction(async (tx) => {
      const result = await tx
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

      if (matter.dirtype === 0 && matter.size && matter.size > 0 && storage) {
        await tx
          .update(storages)
          .set({ usedBytes: sql`${storages.usedBytes} + ${matter.size}` })
          .where(eq(storages.id, storage.id))

        await tx
          .insert(storageQuotas)
          .values({ id: nanoid(), uid: userId, quota: 0, used: matter.size })
          .onConflictDoUpdate({
            target: storageQuotas.uid,
            set: { used: sql`${storageQuotas.used} + ${matter.size}` },
          })
      }

      return result
    })

    return c.json(copy, 201)
  })

export default app
