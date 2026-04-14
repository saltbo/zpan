import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBreadcrumb, isPublicPath } from '../services/profile.js'
import { S3Service } from '../services/s3.js'
import { createTestApp } from '../test/setup.js'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue('https://presigned-download.example.com')
})

async function insertUser(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  opts: { id: string; username: string; email: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO user (id, name, email, email_verified, username, created_at, updated_at)
    VALUES (${opts.id}, 'Test User', ${opts.email}, 1, ${opts.username}, ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES (${`org-${opts.id}`}, 'Personal', ${`personal-${opts.id}`}, ${now})
  `)
  await db.run(sql`
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES (${`member-${opts.id}`}, ${`org-${opts.id}`}, ${opts.id}, 'owner', ${now})
  `)
  return { orgId: `org-${opts.id}` }
}

async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES ('st-1', 'Test', 'private', 'bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function insertMatter(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  opts: {
    id: string
    orgId: string
    name: string
    parent?: string
    isPublic?: boolean
    dirtype?: number
    object?: string
  },
) {
  const now = Date.now()
  const isPublic = opts.isPublic === true ? 1 : 0
  const dirtype = opts.dirtype ?? 0
  const object = opts.object ?? `key/${opts.name}`
  const parent = opts.parent ?? ''
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, is_public, status, created_at, updated_at)
    VALUES (${opts.id}, ${opts.orgId}, ${`alias-${opts.id}`}, ${opts.name}, 'image/jpeg', 1024, ${dirtype}, ${parent}, ${object}, 'st-1', ${isPublic}, 'active', ${now}, ${now})
  `)
}

describe('GET /api/profiles/:username', () => {
  it('returns 404 when user does not exist', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/profiles/nonexistent')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'User not found' })
  })

  it('returns user info and empty shares when user has no public files', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/profiles/testuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { username: string }; shares: unknown[] }
    expect(body.user.username).toBe('testuser')
    expect(body.shares).toEqual([])
  })

  it('only returns isPublic=true files', async () => {
    const { app, db } = await createTestApp()
    const { orgId } = await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })
    await insertStorage(db)
    await insertMatter(db, { id: 'm1', orgId, name: 'public.jpg', isPublic: true })
    await insertMatter(db, { id: 'm2', orgId, name: 'private.jpg', isPublic: false })

    const res = await app.request('/api/profiles/testuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { shares: Array<{ name: string }> }
    expect(body.shares).toHaveLength(1)
    expect(body.shares[0].name).toBe('public.jpg')
  })

  it('works without authentication', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    // No auth headers supplied — request should still succeed
    const res = await app.request('/api/profiles/testuser')
    expect(res.status).toBe(200)
  })

  it('returns user info when user exists but has no personal org', async () => {
    const { app, db } = await createTestApp()
    // Insert user without an org
    const now = Date.now()
    await db.run(sql`
      INSERT INTO user (id, name, email, email_verified, username, created_at, updated_at)
      VALUES ('user-2', 'Orphan User', 'orphan@example.com', 1, 'orphanuser', ${now}, ${now})
    `)

    const res = await app.request('/api/profiles/orphanuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { username: string }; shares: unknown[] }
    expect(body.user.username).toBe('orphanuser')
    expect(body.shares).toEqual([])
  })

  it('attaches presigned download url for public file matters', async () => {
    const { app, db } = await createTestApp()
    const { orgId } = await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })
    await insertStorage(db)
    await insertMatter(db, { id: 'm1', orgId, name: 'photo.jpg', isPublic: true, dirtype: 0, object: 'key/photo.jpg' })

    const res = await app.request('/api/profiles/testuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { shares: Array<{ name: string; downloadUrl?: string }> }
    expect(body.shares[0].downloadUrl).toBe('https://presigned-download.example.com')
  })

  it('returns folders ordered before files', async () => {
    const { app, db } = await createTestApp()
    const { orgId } = await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })
    await insertStorage(db)
    await insertMatter(db, { id: 'm-file', orgId, name: 'file.jpg', isPublic: true, dirtype: 0 })
    await insertMatter(db, { id: 'm-folder', orgId, name: 'MyFolder', isPublic: true, dirtype: 1, object: '' })

    const res = await app.request('/api/profiles/testuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { shares: Array<{ name: string; dirtype: number }> }
    expect(body.shares[0].dirtype).toBe(1) // folder comes first
  })
})

describe('GET /api/profiles/:username/browse', () => {
  it('returns 404 for unknown username', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/profiles/nonexistent/browse')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'User not found' })
  })

  it('returns 404 when dir is not a public path', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })
    await insertStorage(db)

    const res = await app.request('/api/profiles/testuser/browse?dir=SecretFolder')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'Not found' })
  })

  it('returns children and breadcrumb when dir is a public folder', async () => {
    const { app, db } = await createTestApp()
    const { orgId } = await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })
    await insertStorage(db)
    // Public folder at root
    await insertMatter(db, { id: 'f1', orgId, name: 'Photos', isPublic: true, dirtype: 1, object: '', parent: '' })
    // Child file inside folder
    await insertMatter(db, { id: 'f2', orgId, name: 'img.jpg', isPublic: false, dirtype: 0, parent: 'Photos' })

    const res = await app.request('/api/profiles/testuser/browse?dir=Photos')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ name: string }>; breadcrumb: string[] }
    expect(body.breadcrumb).toEqual(['Photos'])
    expect(body.items).toHaveLength(1)
    expect(body.items[0].name).toBe('img.jpg')
  })

  it('returns empty items with empty breadcrumb when browsing root with no dir param', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/profiles/testuser/browse')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; breadcrumb: string[] }
    expect(body.breadcrumb).toEqual([])
    expect(body.items).toEqual([])
  })

  it('attaches presigned download url for file matters when browsing', async () => {
    const { app, db } = await createTestApp()
    const { orgId } = await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })
    await insertStorage(db)
    await insertMatter(db, { id: 'f1', orgId, name: 'Docs', isPublic: true, dirtype: 1, object: '', parent: '' })
    await insertMatter(db, {
      id: 'f2',
      orgId,
      name: 'doc.pdf',
      isPublic: false,
      dirtype: 0,
      object: 'key/doc.pdf',
      parent: 'Docs',
    })

    const res = await app.request('/api/profiles/testuser/browse?dir=Docs')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ name: string; downloadUrl?: string }> }
    expect(body.items[0].downloadUrl).toBe('https://presigned-download.example.com')
  })
})

describe('buildBreadcrumb', () => {
  it('returns empty array for empty string', () => {
    expect(buildBreadcrumb('')).toEqual([])
  })

  it('returns single segment for a simple name', () => {
    expect(buildBreadcrumb('photos')).toEqual(['photos'])
  })

  it('splits nested path into segments', () => {
    expect(buildBreadcrumb('a/b/c')).toEqual(['a', 'b', 'c'])
  })

  it('returns two segments for one-level-deep path', () => {
    expect(buildBreadcrumb('Parent/Child')).toEqual(['Parent', 'Child'])
  })
})

describe('isPublicPath', () => {
  it('returns false when no matching public matter exists', async () => {
    const { db } = await createTestApp()
    const { orgId } = await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })
    await insertStorage(db)

    const result = await isPublicPath(db, orgId, 'NonExistentFolder')
    expect(result).toBe(false)
  })

  it('returns true when the folder is marked public', async () => {
    const { db } = await createTestApp()
    const { orgId } = await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })
    await insertStorage(db)
    await insertMatter(db, { id: 'f1', orgId, name: 'PublicDir', isPublic: true, dirtype: 1, object: '', parent: '' })

    const result = await isPublicPath(db, orgId, 'PublicDir')
    expect(result).toBe(true)
  })

  it('returns true for a nested path when a parent segment is public', async () => {
    const { db } = await createTestApp()
    const { orgId } = await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })
    await insertStorage(db)
    await insertMatter(db, { id: 'f1', orgId, name: 'PublicDir', isPublic: true, dirtype: 1, object: '', parent: '' })

    // 'PublicDir/SubDir' — the first segment is public so the whole path is accessible
    const result = await isPublicPath(db, orgId, 'PublicDir/SubDir')
    expect(result).toBe(true)
  })

  it('returns false when folder exists but is not public', async () => {
    const { db } = await createTestApp()
    const { orgId } = await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })
    await insertStorage(db)
    await insertMatter(db, {
      id: 'f1',
      orgId,
      name: 'PrivateDir',
      isPublic: false,
      dirtype: 1,
      object: '',
      parent: '',
    })

    const result = await isPublicPath(db, orgId, 'PrivateDir')
    expect(result).toBe(false)
  })
})
