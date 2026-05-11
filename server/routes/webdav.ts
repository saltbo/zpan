import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { DirType, ObjectStatus } from '../../shared/constants'
import type { Storage as S3Storage } from '../../shared/types'
import { matters } from '../db/schema'
import type { Env } from '../middleware/platform'
import {
  copyMatter,
  createMatter,
  decrementUsage,
  incrementUsageIfAllowed,
  trashMatter,
  updateMatter,
} from '../services/matter'
import { NameConflictError } from '../services/matter-name-conflict'
import { buildObjectKey } from '../services/path-template'
import { S3Service } from '../services/s3'
import { getStorage, selectStorage } from '../services/storage'
import {
  ensureFolder,
  joinMatterPath,
  listChildren,
  resolveExistingWebDavPath,
  resolveWebDavPath,
  WebDavPathError,
} from '../services/webdav-path'
import { matterEntry, mountRootEntry, multistatus, workspaceEntry } from '../services/webdav-xml'

const s3 = new S3Service()
const READ_METHODS = new Set(['OPTIONS', 'PROPFIND', 'GET', 'HEAD'])
const WRITE_METHODS = new Set(['PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY'])
const WEBDAV_RESOURCE = 'webdav'

type DavContext = Context<Env>
type DavAuth = { orgId: string; userId?: string }

async function requireWebDavApiKey(c: DavContext): Promise<DavAuth | Response> {
  const method = c.req.method.toUpperCase()
  const action = READ_METHODS.has(method) ? 'read' : WRITE_METHODS.has(method) ? 'write' : null
  if (!action) return c.text('Method Not Allowed', 405)

  const authHeader = c.req.raw.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.text('Unauthorized', 401)

  const key = authHeader.slice('Bearer '.length).trim()
  if (!key) return c.text('Unauthorized', 401)

  try {
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const result = (await (c.get('auth').api as any).verifyApiKey({
      body: { key, permissions: { [WEBDAV_RESOURCE]: [action] } },
    })) as {
      valid: boolean
      key: { referenceId: string; userId?: string } | null
      error: { message?: string } | null
    }
    if (!result?.valid || !result.key?.referenceId) return c.text(result?.error?.message ?? 'Unauthorized', 401)
    return { orgId: result.key.referenceId, userId: result.key.userId }
  } catch {
    return c.text('Invalid API key', 401)
  }
}

function davPath(c: DavContext): string {
  return new URL(c.req.url).pathname
}

function davError(c: DavContext, error: unknown): Response {
  if (error instanceof WebDavPathError) return new Response(error.message, { status: error.status })
  if (error instanceof NameConflictError) return c.text(error.message, 409)
  throw error
}

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}

function destinationPath(c: DavContext): string | Response {
  const header = c.req.header('Destination')
  if (!header) return c.text('Destination header required', 400)
  const url = new URL(header, c.req.url)
  if (url.origin !== new URL(c.req.url).origin) return c.text('Cross-origin DAV destination rejected', 400)
  return url.pathname
}

async function ensureParentCollection(
  db: Env['Variables']['platform']['db'],
  orgId: string,
  workspaceSlug: string,
  parent: string,
): Promise<void> {
  if (!parent) return
  const target = await resolveWebDavPath(db, orgId, `/dav/${workspaceSlug}/${parent}`)
  ensureFolder(target)
}

const app = new Hono<Env>().on(
  ['OPTIONS', 'PROPFIND', 'GET', 'HEAD', 'PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY'],
  '/*',
  async (c) => {
    const auth = await requireWebDavApiKey(c)
    if (auth instanceof Response) return auth

    switch (c.req.method.toUpperCase()) {
      case 'OPTIONS':
        return new Response(null, {
          status: 204,
          headers: { Allow: 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY', DAV: '1' },
        })
      case 'PROPFIND':
        return propfind(c, auth)
      case 'GET':
      case 'HEAD':
        return readFile(c, auth)
      case 'PUT':
        return putFile(c, auth)
      case 'MKCOL':
        return makeCollection(c, auth)
      case 'DELETE':
        return deleteMatter(c, auth)
      case 'MOVE':
        return moveMatter(c, auth)
      case 'COPY':
        return copyMatterRoute(c, auth)
      default:
        return c.text('Method Not Allowed', 405)
    }
  },
)

async function propfind(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const target = await resolveWebDavPath(db, auth.orgId, davPath(c))
    const depth = c.req.header('Depth') ?? '1'
    const entries = []

    if (target.mountRoot) {
      entries.push(mountRootEntry())
      if (depth !== '0') entries.push(workspaceEntry(target.workspace))
    } else if (!target.matter) {
      entries.push(workspaceEntry(target.workspace))
      if (depth !== '0')
        entries.push(...(await listChildren(db, auth.orgId, '')).map((m) => matterEntry(target.workspace, m)))
    } else {
      entries.push(matterEntry(target.workspace, target.matter))
      if (depth !== '0' && target.matter.dirtype !== DirType.FILE) {
        const parent = joinMatterPath(target.matter.parent, target.matter.name)
        entries.push(...(await listChildren(db, auth.orgId, parent)).map((m) => matterEntry(target.workspace, m)))
      }
    }

    return c.body(multistatus(entries), 207, { 'Content-Type': 'application/xml; charset=utf-8' })
  } catch (e) {
    return davError(c, e)
  }
}

async function readFile(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const { matter } = await resolveExistingWebDavPath(db, auth.orgId, davPath(c))
    if (!matter) throw new WebDavPathError('Not found', 404)
    if (matter.dirtype !== DirType.FILE) return c.text('Cannot read collection as file', 405)
    const storage = (await getStorage(db, matter.storageId)) as unknown as S3Storage | null
    if (!storage) return c.text('Storage not found', 404)

    if (c.req.method.toUpperCase() === 'HEAD') {
      return new Response(null, {
        headers: { 'Content-Type': matter.type, 'Content-Length': String(matter.size ?? 0), ETag: matter.id },
      })
    }

    const url = await s3.presignDownload(storage, matter.object, matter.name)
    return c.redirect(url, 302)
  } catch (e) {
    return davError(c, e)
  }
}

async function putFile(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const target = await resolveWebDavPath(db, auth.orgId, davPath(c))
    if (!target.name) return c.text('Cannot PUT a collection root', 405)
    if (target.matter && target.matter.dirtype !== DirType.FILE)
      return c.text('Cannot replace collection with file', 409)
    await ensureParentCollection(db, auth.orgId, target.workspace.slug, target.parent)

    const bytes = new Uint8Array(await c.req.arrayBuffer())
    const storage = target.matter
      ? ((await getStorage(db, target.matter.storageId)) as unknown as S3Storage | null)
      : ((await selectStorage(db, 'private')) as unknown as S3Storage)
    if (!storage) return c.text('Storage not found', 404)
    const objectKey = target.matter?.object
      ? target.matter.object
      : buildObjectKey({ uid: auth.userId ?? 'webdav', orgId: auth.orgId, rawExt: fileExt(target.name) })
    const contentType = c.req.header('Content-Type') ?? 'application/octet-stream'

    const sizeDelta = target.matter ? bytes.byteLength - (target.matter.size ?? 0) : bytes.byteLength
    if (sizeDelta > 0) {
      const allowed = await incrementUsageIfAllowed(db, auth.orgId, storage.id, sizeDelta)
      if (!allowed) return c.text('Quota exceeded', 422)
    }

    try {
      await s3.putObject(storage, objectKey, bytes, contentType)
    } catch (e) {
      if (sizeDelta > 0) await decrementUsage(db, auth.orgId, new Map([[storage.id, sizeDelta]]), sizeDelta)
      throw e
    }

    if (sizeDelta < 0) {
      await decrementUsage(db, auth.orgId, new Map([[storage.id, Math.abs(sizeDelta)]]), Math.abs(sizeDelta))
    }

    if (target.matter) {
      const now = new Date()
      await db
        .update(matters)
        .set({ type: contentType, size: bytes.byteLength, updatedAt: now })
        .where(and(eq(matters.id, target.matter.id), eq(matters.orgId, auth.orgId)))
      return new Response(null, { status: 204 })
    }

    await createMatter(db, {
      orgId: auth.orgId,
      userId: auth.userId,
      name: target.name,
      type: contentType,
      size: bytes.byteLength,
      dirtype: DirType.FILE,
      parent: target.parent,
      object: objectKey,
      storageId: storage.id,
      status: ObjectStatus.ACTIVE,
    })
    return new Response(null, { status: 201 })
  } catch (e) {
    return davError(c, e)
  }
}

async function makeCollection(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const target = await resolveWebDavPath(db, auth.orgId, davPath(c))
    if (!target.name) return c.text('Cannot create collection root', 405)
    if (target.matter) return c.text('Already exists', 405)
    await ensureParentCollection(db, auth.orgId, target.workspace.slug, target.parent)
    const storage = (await selectStorage(db, 'private')) as unknown as S3Storage
    await createMatter(db, {
      orgId: auth.orgId,
      userId: auth.userId,
      name: target.name,
      type: 'folder',
      size: 0,
      dirtype: DirType.USER_FOLDER,
      parent: target.parent,
      object: '',
      storageId: storage.id,
      status: ObjectStatus.ACTIVE,
    })
    return new Response(null, { status: 201 })
  } catch (e) {
    return davError(c, e)
  }
}

async function deleteMatter(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const { matter } = await resolveExistingWebDavPath(db, auth.orgId, davPath(c))
    if (!matter) throw new WebDavPathError('Not found', 404)
    await trashMatter(db, auth.orgId, matter.id, auth.userId)
    return new Response(null, { status: 204 })
  } catch (e) {
    return davError(c, e)
  }
}

async function moveMatter(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const source = await resolveExistingWebDavPath(db, auth.orgId, davPath(c))
    if (!source.matter) throw new WebDavPathError('Not found', 404)
    const destination = destinationPath(c)
    if (destination instanceof Response) return destination
    const target = await resolveWebDavPath(db, auth.orgId, destination)
    if (!target.name) return c.text('Cannot move to collection root', 405)
    if (target.matter) return c.text('Already exists', 412)
    await ensureParentCollection(db, auth.orgId, target.workspace.slug, target.parent)
    await updateMatter(db, source.matter.id, auth.orgId, { name: target.name, parent: target.parent }, auth.userId)
    return new Response(null, { status: 201 })
  } catch (e) {
    return davError(c, e)
  }
}

async function copyMatterRoute(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const source = await resolveExistingWebDavPath(db, auth.orgId, davPath(c))
    if (!source.matter) throw new WebDavPathError('Not found', 404)
    const destination = destinationPath(c)
    if (destination instanceof Response) return destination
    const target = await resolveWebDavPath(db, auth.orgId, destination)
    if (!target.name) return c.text('Cannot copy to collection root', 405)
    if (target.matter) return c.text('Already exists', 412)
    await ensureParentCollection(db, auth.orgId, target.workspace.slug, target.parent)

    let newObject = ''
    if (source.matter.object) {
      const storage = (await getStorage(db, source.matter.storageId)) as unknown as S3Storage | null
      if (!storage) return c.text('Storage not found', 404)
      const allowed = await incrementUsageIfAllowed(db, auth.orgId, storage.id, source.matter.size ?? 0)
      if (!allowed) return c.text('Quota exceeded', 422)
      newObject = buildObjectKey({ uid: auth.userId ?? 'webdav', orgId: auth.orgId, rawExt: fileExt(target.name) })
      await s3.copyObject(storage, source.matter.object, storage, newObject)
    }

    const copy = await copyMatter(db, { ...source.matter, name: target.name }, target.parent, newObject, {
      onConflict: 'fail',
      userId: auth.userId,
    })
    c.header('Location', matterLocation(c.req.url, target.workspace.slug, joinMatterPath(copy.parent, copy.name)))
    return c.body(null, 201)
  } catch (e) {
    return davError(c, e)
  }
}

function matterLocation(requestUrl: string, slug: string, path: string): string {
  const url = new URL(requestUrl)
  url.pathname = `/dav/${encodeURIComponent(slug)}/${path.split('/').map(encodeURIComponent).join('/')}`
  url.search = ''
  return url.toString()
}

export default app
