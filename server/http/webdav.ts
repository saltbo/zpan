import { and, eq, like, or } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { ApiKeyTemplate } from '../../shared/api-key-templates'
import { DirType, ObjectStatus } from '../../shared/constants'
import { user } from '../db/auth-schema'
import { matters } from '../db/schema'
import { joinMatterPath } from '../domain/webdav'
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
} from '../domain/webdav-xml'
import { mapDomainError } from '../lib/http-errors'
import { buildObjectKey, fileExt } from '../lib/path-template'
import type { Env } from '../middleware/platform'
import {
  ApiKeyRateLimitError,
  type MatterRepo,
  type S3Gateway,
  type StorageRecord as S3Storage,
  WebDavPathError,
  type WebDavTarget,
} from '../usecases/ports'
import { withStorageUsageReservation } from '../usecases/storage-usage'
import { consumeAndReportDownloadTraffic } from './traffic-metering-utils'

const READ_METHODS = new Set(['OPTIONS', 'PROPFIND', 'GET', 'HEAD'])
const WRITE_METHODS = new Set(['PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY', 'PROPPATCH', 'LOCK', 'UNLOCK'])
const WEBDAV_RESOURCE = 'webdav'
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
    const key = await c
      .get('deps')
      .apiKeys.verifyApiKeyForPermission(
        c.get('auth'),
        db,
        credentials.password,
        WEBDAV_RESOURCE,
        action,
        ApiKeyTemplate.WEBDAV,
      )
    if (!key) return unauthorized()
    if (!(await usernameMatches(db, key.referenceId, credentials.username))) return unauthorized()
    c.set('userId', key.referenceId)
    return { userId: key.referenceId }
  } catch (error) {
    if (error instanceof ApiKeyRateLimitError) return rateLimited(error)
    return unauthorized()
  }
}

function unauthorized(): Response {
  return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': WEBDAV_REALM } })
}

function rateLimited(error: ApiKeyRateLimitError): Response {
  const headers = new Headers()
  if (error.retryAfterMs !== undefined) headers.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)))
  return new Response(error.message, { status: 429, headers })
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
  return normalizeDavMountPath(new URL(c.req.url).pathname)
}

function normalizeDavMountPath(pathname: string): string {
  return pathname.replace(/^\/dav\/+/, '/dav/')
}

function davError(c: DavContext, error: unknown): Response {
  const mapped = mapDomainError(error)
  if (mapped) return c.text(mapped.message, mapped.status)
  throw error
}

function destinationPath(c: DavContext): string | Response {
  const header = c.req.header('Destination')
  if (!header) return c.text('Destination header required', 400)
  const url = new URL(header, c.req.url)
  if (url.origin !== new URL(c.req.url).origin) return c.text('Cross-origin DAV destination rejected', 400)
  return normalizeDavMountPath(url.pathname)
}

async function ensureParentCollection(
  c: DavContext,
  userId: string,
  workspaceSlug: string,
  parent: string,
): Promise<void> {
  if (!parent) return
  const target = await c.get('deps').webdavPath.resolveWebDavPath(userId, `/dav/${workspaceSlug}/${parent}`)
  if (!target.matter) throw new WebDavPathError('Parent collection not found', 409)
  if (target.matter.dirtype === DirType.FILE) throw new WebDavPathError('Not a collection', 405)
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

type RangeRequest = { action: 'none' | 'ignore' } | { action: 'serve'; ranges: ByteRange[] } | { action: 'reject' }

function parseRangeRequest(header: string | undefined, size: number): RangeRequest {
  if (!header) return { action: 'none' }
  const separator = header.indexOf('=')
  if (separator <= 0) return { action: 'ignore' }

  const unit = header.slice(0, separator).trim().toLowerCase()
  const specs = header
    .slice(separator + 1)
    .split(',')
    .map((spec) => spec.trim())
  if (unit !== 'bytes') return { action: 'ignore' }
  if (size <= 0) return { action: 'reject' }

  const ranges: ByteRange[] = []
  for (const spec of specs) {
    const range = parseByteRangeSpec(spec, size)
    if (range === 'invalid') return { action: 'reject' }
    if (range) ranges.push(range)
  }
  if (ranges.length === 0) return { action: 'reject' }
  return { action: 'serve', ranges }
}

function parseByteRangeSpec(spec: string, size: number): ByteRange | null | 'invalid' {
  const match = /^(\d*)-(\d*)$/.exec(spec)
  if (!match) return 'invalid'

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return 'invalid'

  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(size - suffix, 0), end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return 'invalid'
  if (start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

function rangeNotSatisfiable(size: number): Response {
  return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
}

function multipartRangeContentLength(boundary: string, contentType: string, ranges: ByteRange[], size: number): number {
  let contentLength = finalMultipartBoundary(boundary).byteLength
  for (const range of ranges) {
    contentLength += multipartRangeHeader(boundary, contentType, range, size).byteLength
    contentLength += range.end - range.start + 1
    contentLength += 2
  }
  return contentLength
}

function rangeContentBytes(ranges: ByteRange[]): number {
  return ranges.reduce((total, range) => total + range.end - range.start + 1, 0)
}

function multipartRangeHeader(boundary: string, contentType: string, range: ByteRange, size: number): Uint8Array {
  return new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: ${contentType}\r\nContent-Range: bytes ${range.start}-${range.end}/${size}\r\n\r\n`,
  )
}

function finalMultipartBoundary(boundary: string): Uint8Array {
  return new TextEncoder().encode(`--${boundary}--\r\n`)
}

function multipartRangeBody(
  s3: S3Gateway,
  storage: S3Storage,
  matter: NonNullable<WebDavTarget['matter']>,
  boundary: string,
  ranges: ByteRange[],
  size: number,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        for (const range of ranges) {
          controller.enqueue(multipartRangeHeader(boundary, matter.type, range, size))
          await enqueueObjectRange(s3, controller, storage, matter.object, range)
          controller.enqueue(new Uint8Array([13, 10]))
        }
        controller.enqueue(finalMultipartBoundary(boundary))
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

async function enqueueObjectRange(
  s3: S3Gateway,
  controller: ReadableStreamDefaultController<Uint8Array>,
  storage: S3Storage,
  object: string,
  range: ByteRange,
): Promise<void> {
  const body = await s3.getObjectBody(storage, object, `bytes=${range.start}-${range.end}`)
  if (!isReadableBodyStream(body)) throw new Error('Unsupported range body stream')
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      controller.enqueue(value)
    }
  } finally {
    releaseStreamLock(reader)
  }
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
  if (!ctor || !isReadableBodyStream(body)) return body

  const { readable, writable } = new ctor(contentLength)
  void bridgeFixedLengthStream(body, writable)
  return readable
}

function isReadableBodyStream(body: BodyInit): body is ReadableStream<Uint8Array> {
  return typeof (body as ReadableStream<Uint8Array>).getReader === 'function'
}

async function bridgeFixedLengthStream(
  body: ReadableStream<Uint8Array>,
  writable: WritableStream<ArrayBuffer | ArrayBufferView>,
): Promise<void> {
  const reader = body.getReader()
  const writer = writable.getWriter()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await writer.write(value)
    }
    await writer.close()
  } catch (error) {
    await Promise.allSettled([cancelStreamReader(reader, error), writer.abort(error)])
  } finally {
    releaseStreamLock(reader)
    releaseStreamLock(writer)
  }
}

async function cancelStreamReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason: unknown): Promise<void> {
  try {
    await reader.cancel(reason)
  } catch {
    return
  }
}

function releaseStreamLock(stream: { releaseLock: () => void }): void {
  try {
    stream.releaseLock()
  } catch {
    return
  }
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
  const locks = await c.get('deps').webdavState.activeLocks(workspace.id, resourcePath(target))
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
    const locks = workspace ? await c.get('deps').webdavState.activeLocks(workspace.id, resourcePath(target)) : []
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
    return await c.get('deps').webdavPath.resolveWebDavPath(auth.userId, normalizeDavMountPath(url.pathname))
  } catch {
    return null
  }
}

async function davEntries(c: DavContext, targets: WebDavTarget[]): Promise<DavEntry[]> {
  const entries: DavEntry[] = []
  const byWorkspace = new Map<string, { workspace: NonNullable<WebDavTarget['workspace']>; targets: WebDavTarget[] }>()

  for (const target of targets) {
    if (target.mountRoot) {
      entries.push(mountRootEntry())
      continue
    }
    const workspace = requireWorkspace(target)
    const group = byWorkspace.get(workspace.id)
    if (group) {
      group.targets.push(target)
    } else {
      byWorkspace.set(workspace.id, { workspace, targets: [target] })
    }
  }

  const webdavState = c.get('deps').webdavState
  for (const { workspace, targets: workspaceTargets } of byWorkspace.values()) {
    const paths = workspaceTargets.map(resourcePath)
    const [deadPropertiesByPath, locksByPath] = await Promise.all([
      webdavState.listDeadPropertiesForResources(workspace.id, paths),
      webdavState.activeLocksForResources(workspace.id, paths),
    ])
    for (const target of workspaceTargets) {
      const path = resourcePath(target)
      const deadProperties = deadPropertiesByPath.get(path) ?? []
      const locks = locksByPath.get(path) ?? []
      entries.push(
        target.matter
          ? matterEntry(workspace, target.matter, deadProperties, locks)
          : workspaceEntry(workspace, deadProperties, locks),
      )
    }
  }

  return entries
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
  ['/', '/*'],
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
  const webdavPath = c.get('deps').webdavPath
  try {
    const target = await webdavPath.resolveWebDavPath(auth.userId, davPath(c))
    const depth = c.req.header('Depth') ?? '1'
    if (depth !== '0' && depth !== '1') {
      return xmlResponse(errorXml('propfind-finite-depth', 'Depth infinity is not supported for PROPFIND.'), 403)
    }
    const request = parsePropfindXml(await c.req.text())
    const targets: WebDavTarget[] = []

    if (target.mountRoot) {
      targets.push(target)
      if (depth !== '0') {
        for (const workspace of await webdavPath.listUserWorkspaces(auth.userId)) {
          const workspaceTarget = { workspace, mountRoot: false, parent: '', name: '', matter: null }
          targets.push(workspaceTarget)
        }
      }
    } else if (!target.matter) {
      if (target.name) throw new WebDavPathError('Not found', 404)
      const workspace = requireWorkspace(target)
      targets.push(target)
      if (depth !== '0') {
        for (const matter of await webdavPath.listChildren(workspace.id, '')) {
          targets.push({ workspace, mountRoot: false, parent: matter.parent, name: matter.name, matter })
        }
      }
    } else {
      const workspace = requireWorkspace(target)
      targets.push(target)
      if (depth !== '0' && target.matter.dirtype !== DirType.FILE) {
        const parent = joinMatterPath(target.matter.parent, target.matter.name)
        for (const matter of await webdavPath.listChildren(workspace.id, parent)) {
          targets.push({ workspace, mountRoot: false, parent: matter.parent, name: matter.name, matter })
        }
      }
    }

    const entries = await davEntries(c, targets)
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
    const target = await c.get('deps').webdavPath.resolveWebDavPath(auth.userId, davPath(c))
    if (target.name && !target.matter) throw new WebDavPathError('Not found', 404)
    const workspace = requireWorkspace(target)
    const locked = await lockPrecondition(c, target)
    if (locked) return locked
    const ifFailed = await ifHeaderPrecondition(c, auth, target)
    if (ifFailed) return ifFailed
    const operations = parseProppatchXml(await c.req.text())
    await c.get('deps').webdavState.applyDeadPropertyUpdate(workspace.id, resourcePath(target), operations)
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
  try {
    const { matter, workspace } = await c.get('deps').webdavPath.resolveExistingWebDavPath(auth.userId, davPath(c))
    if (!matter) throw new WebDavPathError('Not found', 404)
    if (!workspace) throw new WebDavPathError('Workspace not found', 404)
    if (matter.dirtype !== DirType.FILE) return c.text('Cannot read collection as file', 405)
    const precondition = preconditionResponse(c, matter)
    if (precondition) return precondition

    const storage = await c.get('deps').storages.get(matter.storageId)
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
      const trafficError = await reserveWebDavTraffic(c, workspace.id, matter.id, storage, size)
      if (trafficError) return trafficError
      try {
        const body = await c.get('deps').s3.getObjectBody(storage, matter.object)
        return new Response(fixedLengthResponseBody(body, size), { headers })
      } catch (e) {
        await c.get('deps').quota.refundTraffic(workspace.id, size)
        throw e
      }
    }

    if (rangeRequest.action === 'reject') return rangeNotSatisfiable(size)
    if (rangeRequest.action !== 'serve') throw new Error('Unexpected range request action')
    const trafficBytes = rangeContentBytes(rangeRequest.ranges)
    const trafficError = await reserveWebDavTraffic(c, workspace.id, matter.id, storage, trafficBytes)
    if (trafficError) return trafficError
    if (rangeRequest.ranges.length > 1) {
      const boundary = `zpan-webdav-${matter.id}`
      const contentLength = multipartRangeContentLength(boundary, matter.type, rangeRequest.ranges, size)
      const body = multipartRangeBody(c.get('deps').s3, storage, matter, boundary, rangeRequest.ranges, size)
      headers.set('Content-Type', `multipart/byteranges; boundary=${boundary}`)
      headers.set('Content-Length', String(contentLength))
      headers.delete('Content-Range')
      return new Response(fixedLengthResponseBody(body, contentLength), { status: 206, headers })
    }

    const [range] = rangeRequest.ranges
    const contentLength = range.end - range.start + 1
    let body: BodyInit
    try {
      body = await c.get('deps').s3.getObjectBody(storage, matter.object, `bytes=${range.start}-${range.end}`)
    } catch (e) {
      await c.get('deps').quota.refundTraffic(workspace.id, contentLength)
      throw e
    }
    headers.set('Content-Length', String(contentLength))
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    return new Response(fixedLengthResponseBody(body, contentLength), { status: 206, headers })
  } catch (e) {
    return davError(c, e)
  }
}

async function reserveWebDavTraffic(
  c: DavContext,
  orgId: string,
  matterId: string,
  storage: S3Storage,
  bytes: number,
): Promise<Response | null> {
  if (bytes <= 0) return null
  return consumeAndReportDownloadTraffic(c, {
    orgId,
    bytes,
    storage,
    source: 'webdav_download',
    sourceId: matterId,
    quotaExceeded: () => c.text('Traffic quota exceeded', 422),
  })
}

async function putFile(c: DavContext, auth: DavAuth): Promise<Response> {
  const db = c.get('platform').db
  try {
    const target = await c.get('deps').webdavPath.resolveWebDavPath(auth.userId, davPath(c))
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
    await ensureParentCollection(c, auth.userId, workspace.slug, target.parent)

    const contentLength = parseContentLength(c.req.header('Content-Length'))
    if (contentLength instanceof Response) return contentLength
    const body = contentLength === 0 ? new Uint8Array() : c.req.raw.body
    if (!body) return c.text('Request body required', 400)
    const storage = target.matter
      ? await c.get('deps').storages.get(target.matter.storageId)
      : await c.get('deps').storages.select('private')
    if (!storage) return c.text('Storage not found', 404)
    const objectKey =
      target.matter?.object && contentLength !== null
        ? target.matter.object
        : buildObjectKey({ uid: auth.userId, orgId: workspace.id, rawExt: fileExt(target.name) })
    const contentType = c.req.header('Content-Type') ?? 'application/octet-stream'

    const knownSizeDelta =
      contentLength === null ? 0 : target.matter ? contentLength - (target.matter.size ?? 0) : contentLength

    try {
      return await withStorageUsageReservation(
        c.get('deps'),
        { orgId: workspace.id, storageId: storage.id, bytes: Math.max(0, knownSizeDelta) },
        async (ctx) => {
          const s3 = c.get('deps').s3
          const uploadedSize = await s3.putObject(storage, objectKey, body, contentType, contentLength ?? undefined)
          const sizeDelta = target.matter ? uploadedSize - (target.matter.size ?? 0) : uploadedSize

          if (!target.matter || objectKey !== target.matter.object) {
            ctx.onRollback(() => s3.deleteObject(storage, objectKey))
          }

          if (contentLength === null && sizeDelta > 0) {
            return withStorageUsageReservation(
              c.get('deps'),
              { orgId: workspace.id, storageId: storage.id, bytes: sizeDelta },
              async () => {
                return persistWebDavUpload(
                  s3,
                  db,
                  c.get('deps').matter,
                  workspace.id,
                  auth.userId,
                  target,
                  storage,
                  objectKey,
                  contentType,
                  uploadedSize,
                )
              },
            )
          }

          const response = await persistWebDavUpload(
            s3,
            db,
            c.get('deps').matter,
            workspace.id,
            auth.userId,
            target,
            storage,
            objectKey,
            contentType,
            uploadedSize,
          )
          if (sizeDelta < 0) await c.get('deps').storageUsage.reconcile(workspace.id, [storage.id])
          return response
        },
      )
    } catch (e) {
      const mapped = mapDomainError(e)
      if (mapped) return c.text(mapped.message, mapped.status)
      throw e
    }
  } catch (e) {
    return davError(c, e)
  }
}

async function persistWebDavUpload(
  s3: S3Gateway,
  db: Env['Variables']['platform']['db'],
  matterRepo: MatterRepo,
  orgId: string,
  userId: string,
  target: WebDavTarget,
  storage: S3Storage,
  objectKey: string,
  contentType: string,
  uploadedSize: number,
): Promise<Response> {
  if (target.matter) {
    const now = new Date()
    await db
      .update(matters)
      .set({ type: contentType, size: uploadedSize, object: objectKey, updatedAt: now })
      .where(and(eq(matters.id, target.matter.id), eq(matters.orgId, orgId)))
    if (objectKey !== target.matter.object) await s3.deleteObject(storage, target.matter.object)
    return new Response(null, { status: 204 })
  }

  await matterRepo.create({
    orgId,
    userId,
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
}

async function makeCollection(c: DavContext, auth: DavAuth): Promise<Response> {
  try {
    const target = await c.get('deps').webdavPath.resolveWebDavPath(auth.userId, davPath(c))
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
    await ensureParentCollection(c, auth.userId, workspace.slug, target.parent)
    const storage = await c.get('deps').storages.select('private')
    await c.get('deps').matter.create({
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
  try {
    const target = await c.get('deps').webdavPath.resolveExistingWebDavPath(auth.userId, davPath(c))
    const workspace = requireWorkspace(target)
    const matter = target.matter
    if (!matter) throw new WebDavPathError('Not found', 404)
    const locked = await lockPrecondition(c, target)
    if (locked) return locked
    const ifFailed = await ifHeaderPrecondition(c, auth, target)
    if (ifFailed) return ifFailed
    await c.get('deps').webdavState.deleteWebDavState(workspace.id, resourcePath(target))
    await c.get('deps').matter.trash(workspace.id, matter.id, auth.userId)
    return new Response(null, { status: 204 })
  } catch (e) {
    return davError(c, e)
  }
}

async function moveMatter(c: DavContext, auth: DavAuth): Promise<Response> {
  try {
    const source = await c.get('deps').webdavPath.resolveExistingWebDavPath(auth.userId, davPath(c))
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
    const target = await c.get('deps').webdavPath.resolveWebDavPath(auth.userId, destination)
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
    await ensureParentCollection(c, auth.userId, targetWorkspace.slug, target.parent)
    const oldPath = resourcePath(source)
    const newPath = joinMatterPath(target.parent, target.name)
    if (target.matter) {
      await c.get('deps').webdavState.deleteWebDavState(targetWorkspace.id, resourcePath(target))
      await c.get('deps').matter.trash(targetWorkspace.id, target.matter.id, auth.userId)
    }
    await c
      .get('deps')
      .matter.update(source.matter.id, sourceWorkspace.id, { name: target.name, parent: target.parent }, auth.userId)
    await c.get('deps').webdavState.moveWebDavState(sourceWorkspace.id, oldPath, newPath)
    return new Response(null, { status: replacingTarget ? 204 : 201 })
  } catch (e) {
    return davError(c, e)
  }
}

async function copyMatterRoute(c: DavContext, auth: DavAuth): Promise<Response> {
  try {
    const source = await c.get('deps').webdavPath.resolveExistingWebDavPath(auth.userId, davPath(c))
    const sourceWorkspace = requireWorkspace(source)
    if (!source.matter) throw new WebDavPathError('Not found', 404)
    const sourceMatter = source.matter
    const ifFailed = await ifHeaderPrecondition(c, auth, source)
    if (ifFailed) return ifFailed
    const precondition = preconditionResponse(c, sourceMatter)
    if (precondition) return precondition
    const destination = destinationPath(c)
    if (destination instanceof Response) return destination
    const target = await c.get('deps').webdavPath.resolveWebDavPath(auth.userId, destination)
    const targetWorkspace = requireWorkspace(target)
    if (sourceWorkspace.id !== targetWorkspace.id) return c.text('Cross-workspace COPY is not supported', 403)
    if (!target.name) return c.text('Cannot copy to collection root', 405)
    const oldPath = joinMatterPath(sourceMatter.parent, sourceMatter.name)
    const newPath = joinMatterPath(target.parent, target.name)
    if (sourceMatter.dirtype !== DirType.FILE && (newPath === oldPath || newPath.startsWith(`${oldPath}/`))) {
      return xmlResponse(errorXml('forbidden', 'Cannot copy a collection into itself or its descendant.'), 403)
    }
    const targetLocked = await lockPrecondition(c, target)
    if (targetLocked) return targetLocked
    if (target.matter && !overwriteAllowed(c)) return c.text('Already exists', 412)
    const replacingTarget = Boolean(target.matter)
    await ensureParentCollection(c, auth.userId, targetWorkspace.slug, target.parent)

    if (sourceMatter.dirtype !== DirType.FILE) {
      return copyCollection(c, auth, source, target, replacingTarget)
    }

    let newObject = ''
    try {
      const storage = sourceMatter.object ? await c.get('deps').storages.get(sourceMatter.storageId) : null
      if (sourceMatter.object && !storage) return c.text('Storage not found', 404)
      const bytes = sourceMatter.size ?? 0

      return await withStorageUsageReservation(
        c.get('deps'),
        { orgId: sourceWorkspace.id, storageId: sourceMatter.storageId, bytes },
        async (ctx) => {
          if (sourceMatter.object && storage) {
            const s3 = c.get('deps').s3
            newObject = buildObjectKey({ uid: auth.userId, orgId: sourceWorkspace.id, rawExt: fileExt(target.name) })
            await s3.copyObject(storage, sourceMatter.object, storage, newObject)
            ctx.onRollback(() => s3.deleteObject(storage, newObject))
          }

          if (target.matter) {
            await c.get('deps').webdavState.deleteWebDavState(targetWorkspace.id, resourcePath(target))
            await c.get('deps').matter.trash(targetWorkspace.id, target.matter.id, auth.userId)
          }
          const copy = await c
            .get('deps')
            .matter.copy({ ...sourceMatter, name: target.name }, target.parent, newObject, {
              onConflict: 'fail',
              userId: auth.userId,
            })
          await c
            .get('deps')
            .webdavState.copyDeadProperties(
              sourceWorkspace.id,
              resourcePath(source),
              joinMatterPath(copy.parent, copy.name),
            )
          c.header('Location', matterLocation(c.req.url, targetWorkspace.slug, joinMatterPath(copy.parent, copy.name)))
          return c.body(null, replacingTarget ? 204 : 201)
        },
      )
    } catch (e) {
      const mapped = mapDomainError(e)
      if (mapped) return c.text(mapped.message, mapped.status)
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
  const sourceMatter = source.matter

  const depth = c.req.header('Depth') ?? 'infinity'
  if (depth !== '0' && depth !== 'infinity') return xmlResponse(errorXml('bad-depth'), 400)

  const webdavPath = c.get('deps').webdavPath
  const webdavState = c.get('deps').webdavState
  const sourceRoot = joinMatterPath(sourceMatter.parent, sourceMatter.name)
  const targetRoot = joinMatterPath(target.parent, target.name)
  const children = await webdavPath.listChildren(sourceWorkspace.id, sourceRoot)
  const descendants = await listDescendants(db, sourceWorkspace.id, sourceRoot)
  const ordered =
    depth === 'infinity' ? [...children, ...descendants].sort((a, b) => a.parent.length - b.parent.length) : []
  const preparedCopies: Array<{ item: (typeof ordered)[number]; targetParent: string; objectKey: string }> = []
  const createdIds: string[] = []
  const targetRows =
    target.matter && target.matter.dirtype !== DirType.FILE
      ? [
          target.matter,
          ...(await webdavPath.listChildren(targetWorkspace.id, resourcePath(target))),
          ...(await listDescendants(db, targetWorkspace.id, resourcePath(target))),
        ]
      : target.matter
        ? [target.matter]
        : []
  const reservationInputs = ordered
    .filter((item) => item.dirtype === DirType.FILE && item.object && (item.size ?? 0) > 0)
    .map((item) => ({ orgId: targetWorkspace.id, storageId: item.storageId, bytes: item.size ?? 0 }))

  try {
    return await withStorageUsageReservation(c.get('deps'), reservationInputs, async (ctx) => {
      for (const item of ordered) {
        const targetParent =
          item.parent === sourceRoot ? targetRoot : `${targetRoot}${item.parent.slice(sourceRoot.length)}`
        let objectKey = ''
        if (item.dirtype === DirType.FILE && item.object) {
          const storage = await c.get('deps').storages.get(item.storageId)
          if (!storage) return c.text('Storage not found', 404)
          const s3 = c.get('deps').s3
          objectKey = buildObjectKey({ uid: auth.userId, orgId: targetWorkspace.id, rawExt: fileExt(item.name) })
          await s3.copyObject(storage, item.object, storage, objectKey)
          ctx.onRollback(() => s3.deleteObject(storage, objectKey))
        }
        preparedCopies.push({ item, targetParent, objectKey })
      }

      if (target.matter) {
        await webdavState.deleteWebDavState(targetWorkspace.id, resourcePath(target))
        await c.get('deps').matter.trash(targetWorkspace.id, target.matter.id, auth.userId)
      }

      const rootCopy = await c.get('deps').matter.copy({ ...sourceMatter, name: target.name }, target.parent, '', {
        onConflict: 'fail',
        userId: auth.userId,
      })
      createdIds.push(rootCopy.id)
      await webdavState.copyDeadProperties(
        sourceWorkspace.id,
        sourceRoot,
        joinMatterPath(rootCopy.parent, rootCopy.name),
      )

      for (const prepared of preparedCopies) {
        const copy = await c.get('deps').matter.copy(prepared.item, prepared.targetParent, prepared.objectKey, {
          onConflict: 'fail',
          userId: auth.userId,
        })
        createdIds.push(copy.id)
        await webdavState.copyDeadProperties(
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
    })
  } catch (e) {
    if (createdIds.length > 0) {
      await db
        .update(matters)
        .set({ status: ObjectStatus.TRASHED, trashedAt: Date.now(), updatedAt: new Date() })
        .where(and(eq(matters.orgId, targetWorkspace.id), or(...createdIds.map((id) => eq(matters.id, id)))))
      await webdavState.deleteWebDavState(targetWorkspace.id, targetRoot)
    }
    if (targetRows.length > 0) await restoreActiveMatterRows(db, targetRows)
    const mapped = mapDomainError(e)
    if (mapped) return c.text(mapped.message, mapped.status)
    throw e
  }
}

async function lockMatter(c: DavContext, auth: DavAuth): Promise<Response> {
  const webdavState = c.get('deps').webdavState
  try {
    const target = await c.get('deps').webdavPath.resolveWebDavPath(auth.userId, davPath(c))
    const workspace = requireWorkspace(target)
    const body = await c.req.text()
    const existingToken = lockRefreshToken(c)
    if (existingToken instanceof Response) return existingToken
    if (existingToken) {
      if (body.length > 0) return xmlResponse(errorXml('lock-token-submitted'), 400)
      const refreshed = await webdavState.refreshLock(
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
    const conflicts = await webdavState.conflictingLocks(workspace.id, path)
    if (conflicts.length > 0) return xmlResponse(errorXml('no-conflicting-lock'), 423)
    let lockInfo: { owner: string }
    try {
      lockInfo = parseLockInfoXml(body)
    } catch (e) {
      return xmlResponse(errorXml('supported-lock', e instanceof Error ? e.message : 'Unsupported lock request.'), 422)
    }
    const created = !target.matter && Boolean(target.name)
    if (created) {
      await ensureParentCollection(c, auth.userId, workspace.slug, target.parent)
      const storage = await c.get('deps').storages.select('private')
      const objectKey = buildObjectKey({ uid: auth.userId, orgId: workspace.id, rawExt: fileExt(target.name) })
      await c.get('deps').s3.putObject(storage, objectKey, new Uint8Array(), 'application/octet-stream')
      target.matter = await c.get('deps').matter.create({
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
    const lock = await webdavState.createLock({
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
  try {
    const target = await c.get('deps').webdavPath.resolveExistingWebDavPath(auth.userId, davPath(c))
    const workspace = requireWorkspace(target)
    const token = lockTokenHeader(c)
    if (!token) return xmlResponse(errorXml('lock-token-submitted'), 400)
    const removed = await c.get('deps').webdavState.removeLock(workspace.id, resourcePath(target), token)
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
