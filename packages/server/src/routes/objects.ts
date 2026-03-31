import { Hono } from 'hono'
import { eq, and, asc, desc, like, sql, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Env } from '../middleware/platform'
import { requireAuth } from '../middleware/auth'
import { matters, storages, storageQuotas } from '../db/schema'
import type { StorageWithMeta } from '../services/s3'
import {
  createS3Client,
  selectStorage,
  expandFilePath,
  getUploadUrl,
  getDownloadUrl,
  headObject,
  copyObject,
} from '../services/s3'

const FILE_TYPE_PREFIXES: Record<string, string> = {
  image: 'image/',
  video: 'video/',
  audio: 'audio/',
  document: 'application/',
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1) : ''
}

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const parent = c.req.query('parent') ?? ''
    const status = c.req.query('status') ?? 'active'
    const type = c.req.query('type')
    const search = c.req.query('search')
    const page = Math.max(1, Number(c.req.query('page') ?? '1'))
    const pageSize = Math.max(1, Number(c.req.query('pageSize') ?? '20'))

    let where: SQL = and(
      eq(matters.uid, userId),
      eq(matters.parent, parent),
      eq(matters.status, status),
    )!

    if (type && FILE_TYPE_PREFIXES[type]) {
      where = and(where, like(matters.type, `${FILE_TYPE_PREFIXES[type]}%`))!
    }
    if (search) {
      where = and(where, like(matters.name, `%${search}%`))!
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countRows = await (db as any)
      .select({ value: sql<number>`count(*)` })
      .from(matters)
      .where(where)
    const total: number = countRows[0]?.value ?? 0

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
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const body = await c.req.json()
    const now = new Date()

    // Folder creation
    if (body.dirtype && body.dirtype > 0) {
      const [folder] = await db
        .insert(matters)
        .values({
          id: nanoid(),
          uid: userId,
          alias: nanoid(10),
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

    // File creation — select storage and generate presigned upload URL
    const allStorages = await db.select().from(storages)
    const storage = selectStorage(
      allStorages as unknown as StorageWithMeta[],
      'private',
      body.size ?? 0,
    )
    if (!storage) {
      return c.json({ error: 'No storage capacity available' }, 409)
    }

    const ext = fileExtension(body.name)
    const objectKey = expandFilePath(storage.filePath, {
      uid: userId,
      rawName: body.name,
      rawExt: ext,
      uuid: nanoid(),
    })

    const client = createS3Client(storage)
    const uploadUrl = await getUploadUrl(
      client,
      storage.bucket,
      objectKey,
      body.type ?? 'application/octet-stream',
    )

    const [matter] = await db
      .insert(matters)
      .values({
        id: nanoid(),
        uid: userId,
        alias: nanoid(10),
        name: body.name,
        type: body.type ?? 'application/octet-stream',
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
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const id = c.req.param('id')

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))
    if (!matter) return c.json({ error: 'Not found' }, 404)

    const [storage] = await db.select().from(storages).where(eq(storages.id, matter.storageId))
    if (!storage) return c.json({ error: 'Storage not found' }, 404)

    const client = createS3Client(storage)
    const head = await headObject(client, storage.bucket, matter.object)
    if (!head) return c.json({ error: 'S3 object not found — upload may not have completed' }, 409)

    const actualSize = head.size
    const now = new Date()

    // Activate the matter and update storage/quota usage
    const [updatedMatter] = await db
      .update(matters)
      .set({ status: 'active', size: actualSize, updatedAt: now })
      .where(eq(matters.id, id))
      .returning()

    await db
      .update(storages)
      .set({
        usedBytes: sql`${storages.usedBytes} + ${actualSize}`,
        updatedAt: now,
      })
      .where(eq(storages.id, storage.id))

    const [existingQuota] = await db
      .select()
      .from(storageQuotas)
      .where(eq(storageQuotas.uid, userId))

    if (existingQuota) {
      await db
        .update(storageQuotas)
        .set({ used: sql`${storageQuotas.used} + ${actualSize}` })
        .where(eq(storageQuotas.uid, userId))
    } else {
      await db.insert(storageQuotas).values({
        id: nanoid(),
        uid: userId,
        quota: 0,
        used: actualSize,
      })
    }

    return c.json(updatedMatter)
  })
  .get('/:id', async (c) => {
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const id = c.req.param('id')

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))
    if (!matter) return c.json({ error: 'Not found' }, 404)

    // Folders have no download URL
    if ((matter.dirtype ?? 0) > 0) return c.json(matter)

    const [storage] = await db.select().from(storages).where(eq(storages.id, matter.storageId))
    if (!storage) return c.json(matter)

    const client = createS3Client(storage)
    const downloadUrl = await getDownloadUrl(
      client,
      storage.bucket,
      matter.object,
      storage.customHost ?? undefined,
      storage.mode as 'private' | 'public',
    )

    return c.json({ ...matter, downloadUrl })
  })
  .patch('/:id', async (c) => {
    const userId = c.get('userId')!
    const db = c.get('platform').db
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
      // Validate target parent exists and belongs to user (unless moving to root)
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
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const id = c.req.param('id')
    const body = await c.req.json()

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))
    if (!matter) return c.json({ error: 'Not found' }, 404)

    const [updated] = await db
      .update(matters)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(matters.id, id))
      .returning()

    return c.json(updated)
  })
  .delete('/:id', async (c) => {
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const id = c.req.param('id')

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))
    if (!matter) return c.json({ error: 'Not found' }, 404)

    await db.delete(matters).where(eq(matters.id, id))
    return new Response(null, { status: 204 })
  })
  .post('/:id/copy', async (c) => {
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const id = c.req.param('id')
    const body = await c.req.json()
    const targetParent: string = body.parent ?? ''

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))
    if (!matter) return c.json({ error: 'Not found' }, 404)

    const [storage] = await db.select().from(storages).where(eq(storages.id, matter.storageId))
    if (!storage) return c.json({ error: 'Storage not found' }, 404)

    // Build new S3 key for the copy
    const ext = fileExtension(matter.name)
    const newObjectKey = expandFilePath(storage.filePath, {
      uid: userId,
      rawName: matter.name,
      rawExt: ext,
      uuid: nanoid(),
    })

    const client = createS3Client(storage)
    await copyObject(client, storage.bucket, matter.object, newObjectKey)

    const now = new Date()
    const fileSize = matter.size ?? 0

    // Create new matter record and update storage/quota usage
    const [newMatter] = await db
      .insert(matters)
      .values({
        id: nanoid(),
        uid: userId,
        alias: nanoid(10),
        name: matter.name,
        type: matter.type,
        size: fileSize,
        dirtype: matter.dirtype,
        parent: targetParent,
        object: newObjectKey,
        storageId: storage.id,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    await db
      .update(storages)
      .set({
        usedBytes: sql`${storages.usedBytes} + ${fileSize}`,
        updatedAt: now,
      })
      .where(eq(storages.id, storage.id))

    const [existingQuota] = await db
      .select()
      .from(storageQuotas)
      .where(eq(storageQuotas.uid, userId))

    if (existingQuota) {
      await db
        .update(storageQuotas)
        .set({ used: sql`${storageQuotas.used} + ${fileSize}` })
        .where(eq(storageQuotas.uid, userId))
    } else {
      await db.insert(storageQuotas).values({
        id: nanoid(),
        uid: userId,
        quota: 0,
        used: fileSize,
      })
    }

    return c.json(newMatter, 201)
  })

export default app
