import { Hono } from 'hono'
import { eq, and, asc, desc, like, sql, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  createFolderSchema,
  createFileSchema,
  updateObjectSchema,
  copyObjectSchema,
  updateStatusSchema,
} from '@zpan/shared/schemas'
import type { Env } from '../middleware/platform'
import type { Database } from '../platform/interface'
import { requireAuth } from '../middleware/auth'
import { matters, storages, storageQuotas } from '../db/schema'
import {
  createS3Client,
  selectStorage,
  expandFilePath,
  getUploadUrl,
  getDownloadUrl,
  headObject,
  copyObject,
  deleteObject,
} from '../services/s3'
import type { StorageMode } from '@zpan/shared/constants'

const FILE_TYPE_PREFIXES: Record<string, string> = {
  image: 'image/',
  video: 'video/',
  audio: 'audio/',
  document: 'application/pdf',
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1) : ''
}

async function upsertQuotaUsage(db: Database, uid: string, sizeDelta: number): Promise<void> {
  const [existing] = await db.select().from(storageQuotas).where(eq(storageQuotas.uid, uid))

  if (existing) {
    await db
      .update(storageQuotas)
      .set({ used: sql`${storageQuotas.used} + ${sizeDelta}` })
      .where(eq(storageQuotas.uid, uid))
  } else {
    await db.insert(storageQuotas).values({
      id: nanoid(),
      uid,
      quota: 0,
      used: sizeDelta,
    })
  }
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
      const parsed = createFolderSchema.safeParse(body)
      if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

      const data = parsed.data
      const [folder] = await db
        .insert(matters)
        .values({
          id: nanoid(),
          uid: userId,
          alias: nanoid(10),
          name: data.name,
          type: '',
          size: 0,
          dirtype: data.dirtype,
          parent: data.parent,
          object: '',
          storageId: '',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      return c.json(folder, 201)
    }

    // File creation
    const parsed = createFileSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

    const data = parsed.data

    // Select storage — private mode for user uploads
    const allStorages = await db.select().from(storages)
    const storage = selectStorage(
      allStorages as unknown as Parameters<typeof selectStorage>[0],
      'private' as StorageMode,
      data.size,
    )
    if (!storage) {
      return c.json({ error: 'No storage capacity available' }, 409)
    }

    const ext = fileExtension(data.name)
    const objectKey = expandFilePath(storage.filePath, {
      uid: userId,
      rawName: data.name,
      rawExt: ext,
      uuid: nanoid(),
    })

    const client = createS3Client(storage)
    const uploadUrl = await getUploadUrl(client, storage.bucket, objectKey, data.type)

    const [matter] = await db
      .insert(matters)
      .values({
        id: nanoid(),
        uid: userId,
        alias: nanoid(10),
        name: data.name,
        type: data.type,
        size: data.size,
        dirtype: 0,
        parent: data.parent,
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

    // Activate matter and update storage/quota in a transaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedMatter = await (db as any).transaction(async (tx: any) => {
      const [row] = await tx
        .update(matters)
        .set({
          status: 'active',
          size: actualSize,
          type: head.contentType,
          updatedAt: now,
        })
        .where(eq(matters.id, id))
        .returning()

      await tx
        .update(storages)
        .set({
          usedBytes: sql`${storages.usedBytes} + ${actualSize}`,
          updatedAt: now,
        })
        .where(eq(storages.id, storage.id))

      await upsertQuotaUsage(tx as unknown as Database, userId, actualSize)

      return row
    })

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
      storage.mode as StorageMode,
    )

    return c.json({ ...matter, downloadUrl })
  })
  .patch('/:id', async (c) => {
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const id = c.req.param('id')

    const parsed = updateObjectSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

    const body = parsed.data

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))
    if (!matter) return c.json({ error: 'Not found' }, 404)

    const updates: Partial<typeof matters.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (body.name !== undefined) {
      updates.name = body.name
    }

    if (body.parent !== undefined) {
      // Validate target parent exists, belongs to user, and is a folder
      if (body.parent !== '') {
        const [parentFolder] = await db
          .select()
          .from(matters)
          .where(and(eq(matters.id, body.parent), eq(matters.uid, userId)))
        if (!parentFolder || (parentFolder.dirtype ?? 0) === 0)
          return c.json({ error: 'Target parent must be a folder' }, 400)
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

    const parsed = updateStatusSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))
    if (!matter) return c.json({ error: 'Not found' }, 404)

    const [updated] = await db
      .update(matters)
      .set({ status: parsed.data.status, updatedAt: new Date() })
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

    const fileSize = matter.size ?? 0

    // Delete S3 object and decrement quotas for files
    if ((matter.dirtype ?? 0) === 0 && matter.storageId) {
      const [storage] = await db.select().from(storages).where(eq(storages.id, matter.storageId))

      if (storage && matter.object) {
        const client = createS3Client(storage)
        await deleteObject(client, storage.bucket, matter.object)
      }

      if (fileSize > 0) {
        await db
          .update(storages)
          .set({
            usedBytes: sql`${storages.usedBytes} - ${fileSize}`,
            updatedAt: new Date(),
          })
          .where(eq(storages.id, matter.storageId))

        await db
          .update(storageQuotas)
          .set({ used: sql`${storageQuotas.used} - ${fileSize}` })
          .where(eq(storageQuotas.uid, userId))
      }
    }

    await db.delete(matters).where(eq(matters.id, id))
    return new Response(null, { status: 204 })
  })
  .post('/:id/copy', async (c) => {
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const id = c.req.param('id')

    const parsed = copyObjectSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

    const targetParent = parsed.data.parent

    const [matter] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.uid, userId)))
    if (!matter) return c.json({ error: 'Not found' }, 404)

    // Only files can be copied
    if ((matter.dirtype ?? 0) > 0) return c.json({ error: 'Cannot copy a folder' }, 400)

    // Validate target parent
    if (targetParent !== '') {
      const [parentFolder] = await db
        .select()
        .from(matters)
        .where(and(eq(matters.id, targetParent), eq(matters.uid, userId)))
      if (!parentFolder || (parentFolder.dirtype ?? 0) === 0)
        return c.json({ error: 'Target parent must be a folder' }, 400)
    }

    const [storage] = await db.select().from(storages).where(eq(storages.id, matter.storageId))
    if (!storage) return c.json({ error: 'Storage not found' }, 404)

    const ext = fileExtension(matter.name)
    const newObjectKey = expandFilePath(storage.filePath, {
      uid: userId,
      rawName: matter.name,
      rawExt: ext,
      uuid: nanoid(),
    })

    // S3 copy is outside the transaction (not transactional)
    const client = createS3Client(storage)
    await copyObject(client, storage.bucket, matter.object, newObjectKey)

    const now = new Date()
    const fileSize = matter.size ?? 0

    // DB insert + quota updates in a transaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newMatter = await (db as any).transaction(async (tx: any) => {
      const [row] = await tx
        .insert(matters)
        .values({
          id: nanoid(),
          uid: userId,
          alias: nanoid(10),
          name: matter.name,
          type: matter.type,
          size: fileSize,
          dirtype: 0,
          parent: targetParent,
          object: newObjectKey,
          storageId: storage.id,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      await tx
        .update(storages)
        .set({
          usedBytes: sql`${storages.usedBytes} + ${fileSize}`,
          updatedAt: now,
        })
        .where(eq(storages.id, storage.id))

      await upsertQuotaUsage(tx as unknown as Database, userId, fileSize)

      return row
    })

    return c.json(newMatter, 201)
  })

export default app
