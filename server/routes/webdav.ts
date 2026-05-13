import { defaultKeyHasher } from '@better-auth/api-key'
import { and, eq, like, or } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { DirType, ObjectStatus } from '../../shared/constants'
import type { Storage as S3Storage } from '../../shared/types'
import { apikey, user } from '../db/auth-schema'
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
import {
  activeLocks,
  applyDeadPropertyUpdate,
  conflictingLocks,
  copyDeadProperties,
  createLock,
  deleteWebDavState,
  listDeadProperties,
  moveWebDavState,
  refreshLock,
  removeLock,
} from '../services/webdav-state'
import {
  type DavEntry,
  davEtag,
  errorXml,
  lockDiscoveryXml,
  matterEntry,
  mountRootEntry,
  multistatus,
  parseLockInfoXml,
  parsePropfindXml,
  parseProppatchXml,
  proppatchMultistatus,
  workspaceEntry,
  xmlResponse,
} from '../services/webdav-xml'

const s3 = new S3Service()
const READ_METHODS = new Set(['OPTIONS', 'PROPFIND', 'GET', 'HEAD'])
const WRITE_METHODS = new Set(['PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY', 'PROPPATCH', 'LOCK', 'UNLOCK'])
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
    const db = c.get('platform').db
    const hashedKey = await defaultKeyHasher(credentials.password)
    const rows = await db
      .select({
        id: apikey.id,
        referenceId: apikey.referenceId,
        permissions: apikey.permissions,
        enabled: apikey.enabled,
        expiresAt: apikey.expiresAt,
      })
      .from(apikey)
      .where(and(eq(apikey.configId, WEBDAV_CONFIG_ID), eq(apikey.key, hashedKey)))
      .limit(1)
    const key = rows[0]
    if (
      !key?.enabled ||
      (key.expiresAt && key.expiresAt.getTime() <= Date.now()) ||
      !hasWebDavPermission(key.permissions, action)
    )
      return unauthorized()
    if (!(await usernameMatches(db, key.referenceId, credentials.username))) return unauthorized()
    c.set('userId', key.referenceId)
    return { userId: key.referenceId }
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

function hasWebDavPermission(permissions: string | null, action: 'read' | 'write'): boolean {
  if (!permissions) return false
  const parsed = JSON.parse(permissions) as Partial<Record<string, string[]>>
  return parsed[WEBDAV_RESOURCE]?.includes(action) ?? false
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

function isMountedWebDavRead(c: DavContext): boolean {
  const method = c.req.method.toUpperCase()
  return (method === 'GET' || method === 'HEAD') && Boolean(c.req.header('User-Agent')?.startsWith('WebDAVFS/'))
}

function etagMatches(header: string, etag: string): boolean {
  return header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || value === etag)
}

function preconditionResponse(c: DavContext, matter: NonNullable<WebDavTarget['matter']>): Response | null {
  const etag = matterEtag(matter)
  const method = c.req.method.toUpperCase()
  const isWebDavFsRead = isMountedWebDavRead(c)
  const ifMatch = c.req.header('If-Match')
  if (ifMatch && !etagMatches(ifMatch, etag)) return new Response(null, { status: 412 })

  const ifUnmodifiedSince = ifMatch ? null : parseHttpDate(c.req.header('If-Unmodified-Since'))
  if (ifUnmodifiedSince && matter.updatedAt.getTime() > ifUnmodifiedSince.getTime()) {
    return new Response(null, { status: 412 })
  }

  const ifNoneMatch = c.req.header('If-None-Match')
  if (ifNoneMatch) {
    if (!etagMatches(ifNoneMatch, etag)) return null
    if (isWebDavFsRead) return null
    if (method === 'GET' || method === 'HEAD') {
      return new Response(null, { status: 304, headers: validatorHeaders(matter) })
    }
    return new Response(null, { status: 412 })
  }

  const ifModifiedSince =
    method === 'GET' || method === 'HEAD' ? parseHttpDate(c.req.header('If-Modified-Since')) : null
  if (ifModifiedSince && matter.updatedAt.getTime() <= ifModifiedSince.getTime()) {
    if (isWebDavFsRead) return null
    return new Response(null, { status: 304, headers: validatorHeaders(matter) })
  }

  return null
}

function parseHttpDate(header: string | undefined): Date | null {
  if (!header) return null
  const timestamp = Date.parse(header)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp)
}

function missingPreconditionResponse(c: DavContext): Response | null {
  if (c.req.header('If-Match') || c.req.header('If-Unmodified-Since')) return new Response(null, { status: 412 })
  return null
}

interface ByteRange {
  start: number
  end: number
}

type RangeRequest = { action: 'none' | 'ignore' } | { action: 'serve'; range: ByteRange } | { action: 'reject' }

function parseRangeRequest(header: string | undefined, size: number): RangeRequest {
  if (!header) return { action: 'none' }
  const separator = header.indexOf('=')
  if (separator <= 0) return { action: 'ignore' }

  const unit = header.slice(0, separator).trim().toLowerCase()
  const spec = header.slice(separator + 1).trim()
  if (unit !== 'bytes') return { action: 'ignore' }
  if (spec.includes(',')) return { action: 'ignore' }
  if (size <= 0) return { action: 'reject' }

  const match = /^(\d*)-(\d*)$/.exec(spec)
  if (!match) return { action: 'reject' }

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return { action: 'reject' }

  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { action: 'reject' }
    return { action: 'serve', range: { start: Math.max(size - suffix, 0), end: size - 1 } }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return { action: 'reject' }
  }
  return { action: 'serve', range: { start, end: Math.min(end, size - 1) } }
}

function rangeNotSatisfiable(size: number): Response {
  return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
}

function ifRangeMatches(header: string | undefined, matter: NonNullable<WebDavTarget['matter']>): boolean {
  if (!header) return true
  const value = header.trim()
  if (value.startsWith('W/')) return false
  if (value.startsWith('"')) return value === matterEtag(matter)
  return value === matter.updatedAt.toUTCString()
}

function parseContentLength(header: string | undefined): number | null | Response {
  if (!header) return null
  const size = Number(header)
  if (!Number.isSafeInteger(size) || size < 0) return new Response('Invalid Content-Length', { status: 400 })
  return size
}

function fixedLengthResponseBody(body: BodyInit, contentLength: number): BodyInit {
  const ctor = (
    globalThis as typeof globalThis & {
      FixedLengthStream?: new (
        expectedLength: number,
      ) => {
        readable: ReadableStream<Uint8Array>
        writable: WritableStream<ArrayBuffer | ArrayBufferView>
      }
    }
  ).FixedLengthStream
  if (!ctor || !isPipeableStream(body)) return body

  const { readable, writable } = new ctor(contentLength)
  void body.pipeTo(writable)
  return readable
}

function isPipeableStream(body: BodyInit): body is ReadableStream<Uint8Array> {
  return typeof (body as ReadableStream<Uint8Array>).pipeTo === 'function'
}

function overwriteAllowed(c: DavContext): boolean {
  return (c.req.header('Overwrite') ?? 'T').toUpperCase() !== 'F'
}

function resourcePath(target: WebDavTarget): string {
  if (!target.workspace) return ''
  return target.matter
    ? joinMatterPath(target.matter.parent, target.matter.name)
    : joinMatterPath(target.parent, target.name)
}

function targetHref(target: WebDavTarget): string {
  if (target.mountRoot) return '/dav/'
  const workspace = requireWorkspace(target)
  if (!target.matter) return `/dav/${encodeURIComponent(workspace.slug)}/`
  const path = joinMatterPath(target.matter.parent, target.matter.name)
  const href = `/dav/${encodeURIComponent(workspace.slug)}/${path.split('/').map(encodeURIComponent).join('/')}`
  return target.matter.dirtype === DirType.FILE ? href : `${href}/`
}

function parseTimeout(header: string | undefined): number {
  if (!header) return 3600
  const second = header
    .split(',')
    .map((value) => value.trim())
    .find((value) => /^Second-\d+$/i.test(value))
  if (!second) return 3600
  return Math.min(Number(second.slice('Second-'.length)), 604800)
}

function lockTokenHeader(c: DavContext): string | null {
  const header = c.req.header('Lock-Token')
  return header?.replace(/^<|>$/g, '') ?? null
}

function submittedLockTokens(c: DavContext): Set<string> {
  const tokens = new Set<string>()
  const direct = lockTokenHeader(c)
  if (direct) tokens.add(direct)
  const ifHeader = c.req.header('If')
  if (!ifHeader) return tokens
  for (const match of ifHeader.matchAll(/<([^>]+)>/g)) {
    if (match[1].startsWith('opaquelocktoken:')) tokens.add(match[1])
  }
  return tokens
}

function lockRefreshToken(c: DavContext): string | Response | null {
  const ifHeader = c.req.header('If')
  if (!ifHeader) return null
  const tokens = [...ifHeader.matchAll(/<([^>]+)>/g)]
    .map((match) => match[1])
    .filter((token) => token.startsWith('opaquelocktoken:'))
  if (tokens.length === 0) return null
  if (tokens.length !== 1) return xmlResponse(errorXml('lock-token-submitted'), 400)
  return tokens[0]
}

async function lockPrecondition(c: DavContext, target: WebDavTarget): Promise<Response | null> {
  const workspace = requireWorkspace(target)
  const locks = await activeLocks(c.get('platform').db, workspace.id, resourcePath(target))
  if (locks.length === 0) return null
  const tokens = submittedLockTokens(c)
  if (locks.every((lock) => tokens.has(lock.token))) return null
  return xmlResponse(errorXml('lock-token-submitted', 'A matching lock token is required.'), 423)
}

async function ifHeaderPrecondition(c: DavContext, auth: DavAuth, target: WebDavTarget): Promise<Response | null> {
  const header = c.req.header('If')
  if (!header) return null
  if (await evaluateIfHeader(c, auth, header, target)) return null
  return xmlResponse(errorXml('condition-failed', 'If header conditions did not match.'), 412)
}

async function evaluateIfHeader(
  c: DavContext,
  auth: DavAuth,
  header: string,
  fallback: WebDavTarget,
): Promise<boolean> {
  const clauses = [...header.matchAll(/(?:<([^>]+)>\s*)?(\([^)]*\))/g)]
  if (clauses.length === 0) return false
  for (const clause of clauses) {
    const target = clause[1] ? await ifTaggedTarget(c, auth, clause[1]) : fallback
    if (!target) continue
    const workspace = target.workspace
    const etag = target.matter ? matterEtag(target.matter) : null
    const locks = workspace ? await activeLocks(c.get('platform').db, workspace.id, resourcePath(target)) : []
    const lockTokens = new Set(locks.map((lock) => lock.token))
    const list = clause[2]
    const conditions = [...list.matchAll(/(Not\s+)?(?:\[([^\]]+)\]|<([^>]+)>)/gi)]
    if (conditions.length === 0) continue
    if (
      conditions.every((condition) => {
        const negated = Boolean(condition[1])
        const value = condition[2] ?? condition[3]
        const matched = value.startsWith('opaquelocktoken:') ? lockTokens.has(value) : etag === value
        return negated ? !matched : matched
      })
    ) {
      return true
    }
  }
  return false
}

async function ifTaggedTarget(c: DavContext, auth: DavAuth, tag: string): Promise<WebDavTarget | null> {
  if (tag.startsWith('opaquelocktoken:')) return null
  try {
    const url = new URL(tag, c.req.url)
    if (url.origin !== new URL(c.req.url).origin) return null
    return await resolveWebDavPath(c.get('platform').db, auth.userId, url.pathname)
  } catch {
    return null
  }
}

async function davEntry(c: DavContext, target: WebDavTarget): Promise<DavEntry> {
  const db = c.get('platform').db
  if (target.mountRoot) return mountRootEntry()
  const workspace = requireWorkspace(target)
  const path = resourcePath(target)
  const [deadProperties, locks] = await Promise.all([
    listDeadProperties(db, workspace.id, path),
    activeLocks(db, workspace.id, path),
  ])
  return target.matter
    ? matterEntry(workspace, target.matter, deadProperties, locks)
    : workspaceEntry(workspace, deadProperties, locks)
}

async function listDescendants(db: Env['Variables']['platform']['db'], orgId: string, rootPath: string) {
  return db
    .select()
    .from(matters)
    .where(
      and(eq(matters.orgId, orgId), eq(matters.status, ObjectStatus.ACTIVE), like(matters.parent, `${rootPath}/%`)),
    )
}

async function restoreActiveMatterRows(
  db: Env['Variables']['platform']['db'],
  rows: NonNullable<WebDavTarget['matter']>[],
): Promise<void> {
  const now = new Date()
  for (const row of rows) {
    await db
      .update(matters)
      .set({ status: ObjectStatus.ACTIVE, trashedAt: null, updatedAt: now })
      .where(and(eq(matters.id, row.id), eq(matters.orgId, row.orgId)))
  }
}

const app = new Hono<Env>().on(
  ['OPTIONS', 'PROPFIND', 'PROPPATCH', 'GET', 'HEAD', 'PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY', 'LOCK', 'UNLOCK'],
  '/*',
  async (c) => {
    const auth = await requireWebDavApiKey(c)
    if (auth instanceof Response) return auth

    switch (c.req.method.toUpperCase()) {
      case 'OPTIONS':
        return new Response(null, {
          status: 204,
          headers: {
            Allow: 'OPTIONS, PROPFIND, PROPPATCH, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, LOCK, UNLOCK',
            DAV: '1, 2',
          },
        })
      case 'PROPFIND':
        return propfind(c, auth)
      case 'PROPPATCH':
        return proppatch(c, auth)
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
      case 'LOCK':
        return lockMatter(c, auth)
      case 'UNLOCK':
        return unlockMatter(c, auth)
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
    if (depth !== '0' && depth !== '1') {
      return xmlResponse(errorXml('propfind-finite-depth', 'Depth infinity is not supported for PROPFIND.'), 403)
    }
    const request = parsePropfindXml(await c.req.text())
    const entries: DavEntry[] = []

    if (target.mountRoot) {
      entries.push(mountRootEntry())
      if (depth !== '0') {
        for (const workspace of await listUserWorkspaces(db, auth.userId)) {
          const workspaceTarget = { workspace, mountRoot: false, parent: '', name: '', matter: null }
          entries.push(await davEntry(c, workspaceTarget))
        }
      }
    } else if (!target.matter) {
      if (target.name) throw new WebDavPathError('Not found', 404)
      const workspace = requireWorkspace(target)
      entries.push(await davEntry(c, target))
      if (depth !== '0') {
        for (const matter of await listChildren(db, workspace.id, '')) {
          entries.push(
            await davEntry(c, { workspace, mountRoot: false, parent: matter.parent, name: matter.name, matter }),
          )
        }
      }
    } else {
      const workspace = requireWorkspace(target)
      entries.push(await davEntry(c, target))
      if (depth !== '0' && target.matter.dirtype !== DirType.FILE) {
        const parent = joinMatterPath(target.matter.parent, target.matter.name)
        for (const matter of await listChildren(db, workspace.id, parent)) {
          entries.push(
            await davEntry(c, { workspace, mountRoot: false, parent: matter.parent, name: matter.name, matter }),
          )
        }
      }
    }

    return xmlResponse(multistatus(entries, request), 207)
  } catch (e) {
    if (e instanceof Error && (e.message.includes('XML') || e.message.includes('PROPFIND'))) {
      return xmlResponse(errorXml('valid-xml', e.message), 400)
    }
    return davError(c, e)
  }
}

async function proppatch(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const target = await resolveWebDavPath(db, auth.userId, davPath(c))
    if (target.name && !target.matter) throw new WebDavPathError('Not found', 404)
    const workspace = requireWorkspace(target)
    const locked = await lockPrecondition(c, target)
    if (locked) return locked
    const ifFailed = await ifHeaderPrecondition(c, auth, target)
    if (ifFailed) return ifFailed
    const operations = parseProppatchXml(await c.req.text())
    await applyDeadPropertyUpdate(db, workspace.id, resourcePath(target), operations)
    if (target.matter) {
      await db
        .update(matters)
        .set({ updatedAt: new Date() })
        .where(and(eq(matters.id, target.matter.id), eq(matters.orgId, workspace.id)))
    }
    const properties = operations.map((operation) => operation.property)
    return xmlResponse(proppatchMultistatus(targetHref(target), properties), 207)
  } catch (e) {
    if (
      e instanceof Error &&
      (e.message.includes('XML') || e.message.includes('PROPPATCH') || e.message.includes('Protected'))
    ) {
      return xmlResponse(errorXml('cannot-modify-protected-property', e.message), 403)
    }
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
    if (isMountedWebDavRead(c)) {
      headers.delete('ETag')
      headers.delete('Last-Modified')
      headers.set('Cache-Control', 'no-store')
    }

    if (c.req.method.toUpperCase() === 'HEAD') {
      return new Response(null, { headers })
    }

    const size = matter.size ?? 0
    const rangeHeader = c.req.header('Range')
    const rangeRequest: RangeRequest = ifRangeMatches(c.req.header('If-Range'), matter)
      ? parseRangeRequest(rangeHeader, size)
      : { action: 'ignore' }

    if (rangeRequest.action === 'none' || rangeRequest.action === 'ignore') {
      const body = await s3.getObjectBody(storage, matter.object)
      return new Response(fixedLengthResponseBody(body, size), { headers })
    }

    if (rangeRequest.action === 'reject') return rangeNotSatisfiable(size)
    if (rangeRequest.action !== 'serve') throw new Error('Unexpected range request action')
    const range = rangeRequest.range
    const contentLength = range.end - range.start + 1
    const body = await s3.getObjectBody(storage, matter.object, `bytes=${range.start}-${range.end}`)
    headers.set('Content-Length', String(contentLength))
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    return new Response(fixedLengthResponseBody(body, contentLength), { status: 206, headers })
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
    const locked = await lockPrecondition(c, target)
    if (locked) return locked
    const ifFailed = await ifHeaderPrecondition(c, auth, target)
    if (ifFailed) return ifFailed
    const precondition = target.matter ? preconditionResponse(c, target.matter) : missingPreconditionResponse(c)
    if (precondition) return precondition
    await ensureParentCollection(db, auth.userId, workspace.slug, target.parent)

    const contentLength = parseContentLength(c.req.header('Content-Length'))
    if (contentLength instanceof Response) return contentLength
    const body = contentLength === 0 ? new Uint8Array() : c.req.raw.body
    if (!body) return c.text('Request body required', 400)
    const storage = target.matter
      ? ((await getStorage(db, target.matter.storageId)) as unknown as S3Storage | null)
      : ((await selectStorage(db, 'private')) as unknown as S3Storage)
    if (!storage) return c.text('Storage not found', 404)
    const objectKey =
      target.matter?.object && contentLength !== null
        ? target.matter.object
        : buildObjectKey({ uid: auth.userId, orgId: workspace.id, rawExt: fileExt(target.name) })
    const contentType = c.req.header('Content-Type') ?? 'application/octet-stream'

    const knownSizeDelta =
      contentLength === null ? 0 : target.matter ? contentLength - (target.matter.size ?? 0) : contentLength
    if (knownSizeDelta > 0) {
      const allowed = await incrementUsageIfAllowed(db, workspace.id, storage.id, knownSizeDelta)
      if (!allowed) return c.text('Quota exceeded', 422)
    }

    let uploadedSize = 0
    try {
      uploadedSize = await s3.putObject(storage, objectKey, body, contentType, contentLength ?? undefined)
    } catch (e) {
      if (knownSizeDelta > 0)
        await decrementUsage(db, workspace.id, new Map([[storage.id, knownSizeDelta]]), knownSizeDelta)
      throw e
    }

    const sizeDelta = target.matter ? uploadedSize - (target.matter.size ?? 0) : uploadedSize
    if (contentLength === null && sizeDelta > 0) {
      const allowed = await incrementUsageIfAllowed(db, workspace.id, storage.id, sizeDelta)
      if (!allowed) {
        await s3.deleteObject(storage, objectKey)
        return c.text('Quota exceeded', 422)
      }
    }

    if (sizeDelta < 0) {
      await decrementUsage(db, workspace.id, new Map([[storage.id, Math.abs(sizeDelta)]]), Math.abs(sizeDelta))
    }

    if (target.matter) {
      const now = new Date()
      await db
        .update(matters)
        .set({ type: contentType, size: uploadedSize, object: objectKey, updatedAt: now })
        .where(and(eq(matters.id, target.matter.id), eq(matters.orgId, workspace.id)))
      if (objectKey !== target.matter.object) await s3.deleteObject(storage, target.matter.object)
      return new Response(null, { status: 204 })
    }

    await createMatter(db, {
      orgId: workspace.id,
      userId: auth.userId,
      name: target.name,
      type: contentType,
      size: uploadedSize,
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
    const body = await c.req.text()
    if (body.length > 0) {
      return xmlResponse(errorXml('unsupported-media-type', 'MKCOL request bodies are not supported.'), 415)
    }
    const locked = await lockPrecondition(c, target)
    if (locked) return locked
    const ifFailed = await ifHeaderPrecondition(c, auth, target)
    if (ifFailed) return ifFailed
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
    const locked = await lockPrecondition(c, target)
    if (locked) return locked
    const ifFailed = await ifHeaderPrecondition(c, auth, target)
    if (ifFailed) return ifFailed
    await deleteWebDavState(db, workspace.id, resourcePath(target))
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
    const locked = await lockPrecondition(c, source)
    if (locked) return locked
    const ifFailed = await ifHeaderPrecondition(c, auth, source)
    if (ifFailed) return ifFailed
    const precondition = preconditionResponse(c, source.matter)
    if (precondition) return precondition
    const destination = destinationPath(c)
    if (destination instanceof Response) return destination
    const target = await resolveWebDavPath(db, auth.userId, destination)
    const targetWorkspace = requireWorkspace(target)
    if (sourceWorkspace.id !== targetWorkspace.id) return c.text('Cross-workspace MOVE is not supported', 403)
    if (!target.name) return c.text('Cannot move to collection root', 405)
    if (source.matter.dirtype !== DirType.FILE) {
      const oldPath = joinMatterPath(source.matter.parent, source.matter.name)
      const newPath = joinMatterPath(target.parent, target.name)
      if (newPath === oldPath || newPath.startsWith(`${oldPath}/`)) {
        return xmlResponse(errorXml('forbidden', 'Cannot move a collection into itself or its descendant.'), 403)
      }
    }
    const targetLocked = await lockPrecondition(c, target)
    if (targetLocked) return targetLocked
    const replacingTarget = Boolean(target.matter)
    if (target.matter) {
      if (target.matter.id === source.matter.id) return new Response(null, { status: 204 })
      if (!overwriteAllowed(c)) return c.text('Already exists', 412)
    }
    await ensureParentCollection(db, auth.userId, targetWorkspace.slug, target.parent)
    const oldPath = resourcePath(source)
    const newPath = joinMatterPath(target.parent, target.name)
    if (target.matter) {
      await deleteWebDavState(db, targetWorkspace.id, resourcePath(target))
      await trashMatter(db, targetWorkspace.id, target.matter.id, auth.userId)
    }
    await updateMatter(
      db,
      source.matter.id,
      sourceWorkspace.id,
      { name: target.name, parent: target.parent },
      auth.userId,
    )
    await moveWebDavState(db, sourceWorkspace.id, oldPath, newPath)
    return new Response(null, { status: replacingTarget ? 204 : 201 })
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
    const ifFailed = await ifHeaderPrecondition(c, auth, source)
    if (ifFailed) return ifFailed
    const precondition = preconditionResponse(c, source.matter)
    if (precondition) return precondition
    const destination = destinationPath(c)
    if (destination instanceof Response) return destination
    const target = await resolveWebDavPath(db, auth.userId, destination)
    const targetWorkspace = requireWorkspace(target)
    if (sourceWorkspace.id !== targetWorkspace.id) return c.text('Cross-workspace COPY is not supported', 403)
    if (!target.name) return c.text('Cannot copy to collection root', 405)
    const oldPath = joinMatterPath(source.matter.parent, source.matter.name)
    const newPath = joinMatterPath(target.parent, target.name)
    if (source.matter.dirtype !== DirType.FILE && (newPath === oldPath || newPath.startsWith(`${oldPath}/`))) {
      return xmlResponse(errorXml('forbidden', 'Cannot copy a collection into itself or its descendant.'), 403)
    }
    const targetLocked = await lockPrecondition(c, target)
    if (targetLocked) return targetLocked
    if (target.matter && !overwriteAllowed(c)) return c.text('Already exists', 412)
    const replacingTarget = Boolean(target.matter)
    await ensureParentCollection(db, auth.userId, targetWorkspace.slug, target.parent)

    if (source.matter.dirtype !== DirType.FILE) {
      return copyCollection(c, auth, source, target, replacingTarget)
    }

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

      if (target.matter) {
        await deleteWebDavState(db, targetWorkspace.id, resourcePath(target))
        await trashMatter(db, targetWorkspace.id, target.matter.id, auth.userId)
      }
      const copy = await copyMatter(db, { ...source.matter, name: target.name }, target.parent, newObject, {
        onConflict: 'fail',
        userId: auth.userId,
      })
      await copyDeadProperties(db, sourceWorkspace.id, resourcePath(source), joinMatterPath(copy.parent, copy.name))
      c.header('Location', matterLocation(c.req.url, targetWorkspace.slug, joinMatterPath(copy.parent, copy.name)))
      return c.body(null, replacingTarget ? 204 : 201)
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

async function copyCollection(
  c: DavContext,
  auth: DavAuth,
  source: WebDavTarget,
  target: WebDavTarget,
  replacingTarget: boolean,
): Promise<Response> {
  const db = c.get('platform').db
  const sourceWorkspace = requireWorkspace(source)
  const targetWorkspace = requireWorkspace(target)
  if (!source.matter) throw new WebDavPathError('Not found', 404)

  const depth = c.req.header('Depth') ?? 'infinity'
  if (depth !== '0' && depth !== 'infinity') return xmlResponse(errorXml('bad-depth'), 400)

  const sourceRoot = joinMatterPath(source.matter.parent, source.matter.name)
  const targetRoot = joinMatterPath(target.parent, target.name)
  const children = await listChildren(db, sourceWorkspace.id, sourceRoot)
  const descendants = await listDescendants(db, sourceWorkspace.id, sourceRoot)
  const ordered =
    depth === 'infinity' ? [...children, ...descendants].sort((a, b) => a.parent.length - b.parent.length) : []
  const reservedUsage: Array<{ storageId: string; bytes: number }> = []
  const copiedObjects: Array<{ storage: S3Storage; key: string }> = []
  const preparedCopies: Array<{ item: (typeof ordered)[number]; targetParent: string; objectKey: string }> = []
  const createdIds: string[] = []
  const targetRows =
    target.matter && target.matter.dirtype !== DirType.FILE
      ? [
          target.matter,
          ...(await listChildren(db, targetWorkspace.id, resourcePath(target))),
          ...(await listDescendants(db, targetWorkspace.id, resourcePath(target))),
        ]
      : target.matter
        ? [target.matter]
        : []

  try {
    for (const item of ordered) {
      const targetParent =
        item.parent === sourceRoot ? targetRoot : `${targetRoot}${item.parent.slice(sourceRoot.length)}`
      let objectKey = ''
      if (item.dirtype === DirType.FILE && item.object) {
        const storage = (await getStorage(db, item.storageId)) as unknown as S3Storage | null
        if (!storage) return c.text('Storage not found', 404)
        const bytes = item.size ?? 0
        if (bytes > 0) {
          const allowed = await incrementUsageIfAllowed(db, targetWorkspace.id, storage.id, bytes)
          if (!allowed) return c.text('Quota exceeded', 422)
          reservedUsage.push({ storageId: storage.id, bytes })
        }
        objectKey = buildObjectKey({ uid: auth.userId, orgId: targetWorkspace.id, rawExt: fileExt(item.name) })
        await s3.copyObject(storage, item.object, storage, objectKey)
        copiedObjects.push({ storage, key: objectKey })
      }
      preparedCopies.push({ item, targetParent, objectKey })
    }

    if (target.matter) {
      await deleteWebDavState(db, targetWorkspace.id, resourcePath(target))
      await trashMatter(db, targetWorkspace.id, target.matter.id, auth.userId)
    }

    const rootCopy = await copyMatter(db, { ...source.matter, name: target.name }, target.parent, '', {
      onConflict: 'fail',
      userId: auth.userId,
    })
    createdIds.push(rootCopy.id)
    await copyDeadProperties(db, sourceWorkspace.id, sourceRoot, joinMatterPath(rootCopy.parent, rootCopy.name))

    for (const prepared of preparedCopies) {
      const copy = await copyMatter(db, prepared.item, prepared.targetParent, prepared.objectKey, {
        onConflict: 'fail',
        userId: auth.userId,
      })
      createdIds.push(copy.id)
      await copyDeadProperties(
        db,
        sourceWorkspace.id,
        joinMatterPath(prepared.item.parent, prepared.item.name),
        joinMatterPath(copy.parent, copy.name),
      )
    }

    c.header(
      'Location',
      matterLocation(c.req.url, targetWorkspace.slug, joinMatterPath(rootCopy.parent, rootCopy.name)),
    )
    return c.body(null, replacingTarget ? 204 : 201)
  } catch (e) {
    if (createdIds.length > 0) {
      await db
        .update(matters)
        .set({ status: ObjectStatus.TRASHED, trashedAt: Date.now(), updatedAt: new Date() })
        .where(and(eq(matters.orgId, targetWorkspace.id), or(...createdIds.map((id) => eq(matters.id, id)))))
      await deleteWebDavState(db, targetWorkspace.id, targetRoot)
    }
    if (targetRows.length > 0) await restoreActiveMatterRows(db, targetRows)
    await Promise.all(copiedObjects.map((object) => s3.deleteObject(object.storage, object.key)))
    const byStorage = new Map<string, number>()
    let total = 0
    for (const item of reservedUsage) {
      byStorage.set(item.storageId, (byStorage.get(item.storageId) ?? 0) + item.bytes)
      total += item.bytes
    }
    if (total > 0) await decrementUsage(db, targetWorkspace.id, byStorage, total)
    throw e
  }
}

async function lockMatter(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const target = await resolveWebDavPath(db, auth.userId, davPath(c))
    const workspace = requireWorkspace(target)
    const body = await c.req.text()
    const existingToken = lockRefreshToken(c)
    if (existingToken instanceof Response) return existingToken
    if (existingToken) {
      if (body.length > 0) return xmlResponse(errorXml('lock-token-submitted'), 400)
      const refreshed = await refreshLock(
        db,
        workspace.id,
        resourcePath(target),
        existingToken,
        parseTimeout(c.req.header('Timeout')),
      )
      if (!refreshed) return xmlResponse(errorXml('lock-token-submitted'), 412)
      return xmlResponse(lockDiscoveryXml(refreshed), 200)
    }

    const depth = c.req.header('Depth') ?? 'infinity'
    if (depth !== '0' && depth !== 'infinity') return xmlResponse(errorXml('bad-depth'), 400)
    const path = resourcePath(target)
    const conflicts = await conflictingLocks(db, workspace.id, path)
    if (conflicts.length > 0) return xmlResponse(errorXml('no-conflicting-lock'), 423)
    let lockInfo: { owner: string }
    try {
      lockInfo = parseLockInfoXml(body)
    } catch (e) {
      return xmlResponse(errorXml('supported-lock', e instanceof Error ? e.message : 'Unsupported lock request.'), 422)
    }
    const created = !target.matter && Boolean(target.name)
    if (created) {
      await ensureParentCollection(db, auth.userId, workspace.slug, target.parent)
      const storage = (await selectStorage(db, 'private')) as unknown as S3Storage
      const objectKey = buildObjectKey({ uid: auth.userId, orgId: workspace.id, rawExt: fileExt(target.name) })
      await s3.putObject(storage, objectKey, new Uint8Array(), 'application/octet-stream')
      target.matter = await createMatter(db, {
        orgId: workspace.id,
        userId: auth.userId,
        name: target.name,
        type: 'application/octet-stream',
        size: 0,
        dirtype: DirType.FILE,
        parent: target.parent,
        object: objectKey,
        storageId: storage.id,
        status: ObjectStatus.ACTIVE,
      })
    }
    const lock = await createLock(db, {
      orgId: workspace.id,
      resourcePath: path,
      owner: lockInfo.owner,
      depth,
      timeoutSeconds: parseTimeout(c.req.header('Timeout')),
    })
    return xmlResponse(lockDiscoveryXml(lock), created ? 201 : 200, { 'Lock-Token': `<${lock.token}>` })
  } catch (e) {
    return davError(c, e)
  }
}

async function unlockMatter(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const target = await resolveExistingWebDavPath(db, auth.userId, davPath(c))
    const workspace = requireWorkspace(target)
    const token = lockTokenHeader(c)
    if (!token) return xmlResponse(errorXml('lock-token-submitted'), 400)
    const removed = await removeLock(db, workspace.id, resourcePath(target), token)
    if (!removed) return xmlResponse(errorXml('lock-token-matches-request-uri'), 409)
    return new Response(null, { status: 204 })
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
