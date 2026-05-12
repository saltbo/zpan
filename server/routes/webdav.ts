import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { DirType, ObjectStatus } from '../../shared/constants'
import type { Storage as S3Storage } from '../../shared/types'
import { user } from '../db/auth-schema'
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
  listUserWorkspaces,
  resolveExistingWebDavPath,
  resolveWebDavPath,
  WebDavPathError,
  type WebDavTarget,
} from '../services/webdav-path'
import { davEtag, matterEntry, mountRootEntry, multistatus, workspaceEntry } from '../services/webdav-xml'

const s3 = new S3Service()
const READ_METHODS = new Set(['OPTIONS', 'PROPFIND', 'GET', 'HEAD'])
const WRITE_METHODS = new Set(['PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY'])
const WEBDAV_RESOURCE = 'webdav'
const WEBDAV_CONFIG_ID = 'webdav'
const WEBDAV_REALM = 'Basic realm="ZPan WebDAV"'

type DavContext = Context<Env>
type DavAuth = { userId: string }

async function requireWebDavApiKey(c: DavContext): Promise<DavAuth | Response> {
  const method = c.req.method.toUpperCase()
  const action = READ_METHODS.has(method) ? 'read' : WRITE_METHODS.has(method) ? 'write' : null
  if (!action) return c.text('Method Not Allowed', 405)

  const credentials = parseBasicAuth(c.req.raw.headers.get('Authorization'))
  if (!credentials) return unauthorized()

  try {
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const result = (await (c.get('auth').api as any).verifyApiKey({
      body: { configId: WEBDAV_CONFIG_ID, key: credentials.password, permissions: { [WEBDAV_RESOURCE]: [action] } },
    })) as {
      valid: boolean
      key: { referenceId: string } | null
      error: { message?: string } | null
    }
    if (!result?.valid || !result.key?.referenceId) return unauthorized()
    if (!(await usernameMatches(c.get('platform').db, result.key.referenceId, credentials.username)))
      return unauthorized()
    return { userId: result.key.referenceId }
  } catch {
    return unauthorized()
  }
}

function unauthorized(): Response {
  return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': WEBDAV_REALM } })
}

function parseBasicAuth(header: string | null): { username: string; password: string } | null {
  if (!header) return null
  const match = /^Basic\s+(.+)$/i.exec(header)
  if (!match) return null

  let decoded: string
  try {
    const bytes = Uint8Array.from(atob(match[1]), (ch) => ch.charCodeAt(0))
    decoded = new TextDecoder().decode(bytes)
  } catch {
    return null
  }

  const separator = decoded.indexOf(':')
  if (separator <= 0) return null
  const username = decoded.slice(0, separator)
  const password = decoded.slice(separator + 1)
  if (!password) return null
  return { username, password }
}

async function usernameMatches(
  db: Env['Variables']['platform']['db'],
  userId: string,
  username: string,
): Promise<boolean> {
  const rows = await db
    .select({ email: user.email, username: user.username })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const account = rows[0]
  if (!account) return false
  return account.email.toLowerCase() === username.toLowerCase() || account.username === username
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
  userId: string,
  workspaceSlug: string,
  parent: string,
): Promise<void> {
  if (!parent) return
  const target = await resolveWebDavPath(db, userId, `/dav/${workspaceSlug}/${parent}`)
  ensureFolder(target)
}

function requireWorkspace(target: WebDavTarget) {
  if (!target.workspace) throw new WebDavPathError('Workspace not found', 404)
  return target.workspace
}

function matterEtag(matter: NonNullable<WebDavTarget['matter']>): string {
  return davEtag(matter.id, matter.size ?? 0, matter.updatedAt)
}

function fileHeaders(matter: NonNullable<WebDavTarget['matter']>): Headers {
  return new Headers({
    'Content-Type': matter.type,
    'Content-Length': String(matter.size ?? 0),
    ETag: matterEtag(matter),
    'Last-Modified': matter.updatedAt.toUTCString(),
    'Accept-Ranges': 'bytes',
  })
}

function validatorHeaders(matter: NonNullable<WebDavTarget['matter']>): Headers {
  return new Headers({ ETag: matterEtag(matter), 'Last-Modified': matter.updatedAt.toUTCString() })
}

function etagMatches(header: string, etag: string): boolean {
  return header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || value === etag)
}

function preconditionResponse(c: DavContext, matter: NonNullable<WebDavTarget['matter']>): Response | null {
  const etag = matterEtag(matter)
  const ifMatch = c.req.header('If-Match')
  if (ifMatch && !etagMatches(ifMatch, etag)) return new Response(null, { status: 412 })

  const ifNoneMatch = c.req.header('If-None-Match')
  if (!ifNoneMatch || !etagMatches(ifNoneMatch, etag)) return null

  if (c.req.method.toUpperCase() === 'GET' || c.req.method.toUpperCase() === 'HEAD') {
    return new Response(null, { status: 304, headers: validatorHeaders(matter) })
  }
  return new Response(null, { status: 412 })
}

function missingPreconditionResponse(c: DavContext): Response | null {
  if (c.req.header('If-Match')) return new Response(null, { status: 412 })
  return null
}

interface ByteRange {
  start: number
  end: number
}

function parseByteRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return { start: 0, end: size - 1 }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || size <= 0) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null

  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(size - suffix, 0), end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

function rangeNotSatisfiable(size: number): Response {
  return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
}

function overwriteAllowed(c: DavContext): boolean {
  return (c.req.header('Overwrite') ?? 'T').toUpperCase() !== 'F'
}

function bytesBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
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
    const target = await resolveWebDavPath(db, auth.userId, davPath(c))
    const depth = c.req.header('Depth') ?? '1'
    const entries = []

    if (target.mountRoot) {
      entries.push(mountRootEntry())
      if (depth !== '0') entries.push(...(await listUserWorkspaces(db, auth.userId)).map(workspaceEntry))
    } else if (!target.matter) {
      const workspace = requireWorkspace(target)
      entries.push(workspaceEntry(workspace))
      if (depth !== '0')
        entries.push(...(await listChildren(db, workspace.id, '')).map((m) => matterEntry(workspace, m)))
    } else {
      const workspace = requireWorkspace(target)
      entries.push(matterEntry(workspace, target.matter))
      if (depth !== '0' && target.matter.dirtype !== DirType.FILE) {
        const parent = joinMatterPath(target.matter.parent, target.matter.name)
        entries.push(...(await listChildren(db, workspace.id, parent)).map((m) => matterEntry(workspace, m)))
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
    const { matter } = await resolveExistingWebDavPath(db, auth.userId, davPath(c))
    if (!matter) throw new WebDavPathError('Not found', 404)
    if (matter.dirtype !== DirType.FILE) return c.text('Cannot read collection as file', 405)
    const precondition = preconditionResponse(c, matter)
    if (precondition) return precondition

    const storage = (await getStorage(db, matter.storageId)) as unknown as S3Storage | null
    if (!storage) return c.text('Storage not found', 404)
    const headers = fileHeaders(matter)

    if (c.req.method.toUpperCase() === 'HEAD') {
      return new Response(null, { headers })
    }

    const size = matter.size ?? 0
    const rangeHeader = c.req.header('Range')
    if (!rangeHeader) {
      const bytes = await s3.getObjectBytes(storage, matter.object)
      return new Response(bytesBody(bytes), { headers })
    }

    const range = parseByteRange(rangeHeader, size)
    if (!range) return rangeNotSatisfiable(size)
    const bytes = await s3.getObjectBytes(storage, matter.object, `bytes=${range.start}-${range.end}`)
    headers.set('Content-Length', String(range.end - range.start + 1))
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    return new Response(bytesBody(bytes), { status: 206, headers })
  } catch (e) {
    return davError(c, e)
  }
}

async function putFile(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const target = await resolveWebDavPath(db, auth.userId, davPath(c))
    const workspace = requireWorkspace(target)
    if (!target.name) return c.text('Cannot PUT a collection root', 405)
    if (target.matter && target.matter.dirtype !== DirType.FILE)
      return c.text('Cannot replace collection with file', 409)
    const precondition = target.matter ? preconditionResponse(c, target.matter) : missingPreconditionResponse(c)
    if (precondition) return precondition
    await ensureParentCollection(db, auth.userId, workspace.slug, target.parent)

    const bytes = new Uint8Array(await c.req.arrayBuffer())
    const storage = target.matter
      ? ((await getStorage(db, target.matter.storageId)) as unknown as S3Storage | null)
      : ((await selectStorage(db, 'private')) as unknown as S3Storage)
    if (!storage) return c.text('Storage not found', 404)
    const objectKey = target.matter?.object
      ? target.matter.object
      : buildObjectKey({ uid: auth.userId, orgId: workspace.id, rawExt: fileExt(target.name) })
    const contentType = c.req.header('Content-Type') ?? 'application/octet-stream'

    const sizeDelta = target.matter ? bytes.byteLength - (target.matter.size ?? 0) : bytes.byteLength
    if (sizeDelta > 0) {
      const allowed = await incrementUsageIfAllowed(db, workspace.id, storage.id, sizeDelta)
      if (!allowed) return c.text('Quota exceeded', 422)
    }

    try {
      await s3.putObject(storage, objectKey, bytes, contentType)
    } catch (e) {
      if (sizeDelta > 0) await decrementUsage(db, workspace.id, new Map([[storage.id, sizeDelta]]), sizeDelta)
      throw e
    }

    if (sizeDelta < 0) {
      await decrementUsage(db, workspace.id, new Map([[storage.id, Math.abs(sizeDelta)]]), Math.abs(sizeDelta))
    }

    if (target.matter) {
      const now = new Date()
      await db
        .update(matters)
        .set({ type: contentType, size: bytes.byteLength, updatedAt: now })
        .where(and(eq(matters.id, target.matter.id), eq(matters.orgId, workspace.id)))
      return new Response(null, { status: 204 })
    }

    await createMatter(db, {
      orgId: workspace.id,
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
    const target = await resolveWebDavPath(db, auth.userId, davPath(c))
    const workspace = requireWorkspace(target)
    if (!target.name) return c.text('Cannot create collection root', 405)
    if (target.matter) return c.text('Already exists', 405)
    await ensureParentCollection(db, auth.userId, workspace.slug, target.parent)
    const storage = (await selectStorage(db, 'private')) as unknown as S3Storage
    await createMatter(db, {
      orgId: workspace.id,
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
    const target = await resolveExistingWebDavPath(db, auth.userId, davPath(c))
    const workspace = requireWorkspace(target)
    const matter = target.matter
    if (!matter) throw new WebDavPathError('Not found', 404)
    await trashMatter(db, workspace.id, matter.id, auth.userId)
    return new Response(null, { status: 204 })
  } catch (e) {
    return davError(c, e)
  }
}

async function moveMatter(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const source = await resolveExistingWebDavPath(db, auth.userId, davPath(c))
    const sourceWorkspace = requireWorkspace(source)
    if (!source.matter) throw new WebDavPathError('Not found', 404)
    const precondition = preconditionResponse(c, source.matter)
    if (precondition) return precondition
    const destination = destinationPath(c)
    if (destination instanceof Response) return destination
    const target = await resolveWebDavPath(db, auth.userId, destination)
    const targetWorkspace = requireWorkspace(target)
    if (sourceWorkspace.id !== targetWorkspace.id) return c.text('Cross-workspace MOVE is not supported', 403)
    if (!target.name) return c.text('Cannot move to collection root', 405)
    if (target.matter) {
      if (target.matter.id === source.matter.id) return new Response(null, { status: 204 })
      if (!overwriteAllowed(c)) return c.text('Already exists', 412)
    }
    await ensureParentCollection(db, auth.userId, targetWorkspace.slug, target.parent)
    if (target.matter) await trashMatter(db, targetWorkspace.id, target.matter.id, auth.userId)
    await updateMatter(
      db,
      source.matter.id,
      sourceWorkspace.id,
      { name: target.name, parent: target.parent },
      auth.userId,
    )
    return new Response(null, { status: 201 })
  } catch (e) {
    return davError(c, e)
  }
}

async function copyMatterRoute(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const source = await resolveExistingWebDavPath(db, auth.userId, davPath(c))
    const sourceWorkspace = requireWorkspace(source)
    if (!source.matter) throw new WebDavPathError('Not found', 404)
    const precondition = preconditionResponse(c, source.matter)
    if (precondition) return precondition
    if (source.matter.dirtype !== DirType.FILE) return c.text('Collection COPY is not supported', 403)
    const destination = destinationPath(c)
    if (destination instanceof Response) return destination
    const target = await resolveWebDavPath(db, auth.userId, destination)
    const targetWorkspace = requireWorkspace(target)
    if (sourceWorkspace.id !== targetWorkspace.id) return c.text('Cross-workspace COPY is not supported', 403)
    if (!target.name) return c.text('Cannot copy to collection root', 405)
    if (target.matter && !overwriteAllowed(c)) return c.text('Already exists', 412)
    await ensureParentCollection(db, auth.userId, targetWorkspace.slug, target.parent)

    let newObject = ''
    let reservedUsage: { storageId: string; bytes: number } | null = null
    try {
      if (source.matter.object) {
        const storage = (await getStorage(db, source.matter.storageId)) as unknown as S3Storage | null
        if (!storage) return c.text('Storage not found', 404)
        const bytes = source.matter.size ?? 0
        if (bytes > 0) {
          const allowed = await incrementUsageIfAllowed(db, sourceWorkspace.id, storage.id, bytes)
          if (!allowed) return c.text('Quota exceeded', 422)
          reservedUsage = { storageId: storage.id, bytes }
        }
        newObject = buildObjectKey({ uid: auth.userId, orgId: sourceWorkspace.id, rawExt: fileExt(target.name) })
        await s3.copyObject(storage, source.matter.object, storage, newObject)
      }

      if (target.matter) await trashMatter(db, targetWorkspace.id, target.matter.id, auth.userId)
      const copy = await copyMatter(db, { ...source.matter, name: target.name }, target.parent, newObject, {
        onConflict: 'fail',
        userId: auth.userId,
      })
      c.header('Location', matterLocation(c.req.url, targetWorkspace.slug, joinMatterPath(copy.parent, copy.name)))
      return c.body(null, 201)
    } catch (e) {
      if (reservedUsage) {
        await decrementUsage(
          db,
          sourceWorkspace.id,
          new Map([[reservedUsage.storageId, reservedUsage.bytes]]),
          reservedUsage.bytes,
        )
      }
      throw e
    }
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
