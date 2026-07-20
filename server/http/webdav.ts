import type { Context } from 'hono'
import { Hono } from 'hono'
import { ApiKeyTemplate } from '../../shared/api-key-templates'
import { DirType, ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { encodeDavPathSegment, joinMatterPath, workspaceHref } from '../domain/webdav'
import { WEBDAV_AUTH_CHALLENGE, type WebDavMountPath, webDavPublicUrl } from '../domain/webdav-public-url'
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
import type { Env } from '../middleware/platform'
import {
  ApiKeyRateLimitError,
  insufficientCredits,
  type StorageRecord,
  WebDavPathError,
  type WebDavTarget,
} from '../usecases/ports'
import {
  activeLocks,
  activeLocksForResources,
  applyWebDavDeadProperties,
  conflictingLocks,
  copyWebDavCollection,
  copyWebDavFile,
  createWebDavCollection,
  createWebDavLock,
  deleteWebDavMatter,
  ensureParentCollection as ensureParentCollectionUsecase,
  getWebDavObjectBody,
  listDeadPropertiesForResources,
  listUserWebDavWorkspaces,
  listWebDavChildren,
  meterWebDavDownload,
  moveWebDavMatter,
  putWebDavFile,
  recordWebDavDownloadIssued,
  refreshWebDavLock,
  refundWebDavTraffic,
  removeWebDavLock,
  resolveExistingWebDavPath,
  resolveWebDavAuth,
  resolveWebDavDownload,
  resolveWebDavPath,
} from '../usecases/webdav'

const READ_METHODS = new Set(['OPTIONS', 'PROPFIND', 'GET', 'HEAD'])
const WRITE_METHODS = new Set(['PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY', 'PROPPATCH', 'LOCK', 'UNLOCK'])
const WEBDAV_RESOURCE = 'webdav'

type DavContext = Context<Env>
type DavAuth = { userId: string }

const cloudBaseUrl = (c: DavContext): string => c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT

async function requireWebDavApiKey(c: DavContext): Promise<DavAuth | Response> {
  const method = c.req.method.toUpperCase()
  const action = READ_METHODS.has(method) ? 'read' : WRITE_METHODS.has(method) ? 'write' : null
  if (!action) return c.text('Method Not Allowed', 405)

  const credentials = parseBasicAuth(c.req.raw.headers.get('Authorization'))
  if (!credentials) return unauthorized()

  const result = await resolveWebDavAuth(c.get('deps'), {
    auth: c.get('auth'),
    db: c.get('platform').db,
    username: credentials.username,
    password: credentials.password,
    resource: WEBDAV_RESOURCE,
    action,
    configId: ApiKeyTemplate.WEBDAV,
  })
  if (!result.ok) {
    if (result.reason === 'rate_limited')
      return rateLimited(new ApiKeyRateLimitError(result.message, result.retryAfterMs))
    return unauthorized()
  }
  c.set('userId', result.userId)
  return { userId: result.userId }
}

function unauthorized(): Response {
  return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': WEBDAV_AUTH_CHALLENGE } })
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

function davPath(c: DavContext): string {
  return normalizeDavMountPath(new URL(c.req.url).pathname)
}

function publicMountPath(c: DavContext): WebDavMountPath {
  return c.get('webDavMountPath')
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
  if (url.host !== new URL(c.req.url).host) return c.text('Cross-origin DAV destination rejected', 400)
  return normalizeDavMountPath(url.pathname)
}

async function ensureParentCollection(
  c: DavContext,
  userId: string,
  workspaceSlug: string,
  parent: string,
): Promise<void> {
  await ensureParentCollectionUsecase(c.get('deps'), { userId, workspaceSlug, parent })
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
  c: DavContext,
  storage: StorageRecord,
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
          await enqueueObjectRange(c, controller, storage, matter.object, range)
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
  c: DavContext,
  controller: ReadableStreamDefaultController<Uint8Array>,
  storage: StorageRecord,
  object: string,
  range: ByteRange,
): Promise<void> {
  const body = await getWebDavObjectBody(c.get('deps'), { storage, object, range: `bytes=${range.start}-${range.end}` })
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

function targetHref(c: DavContext, target: WebDavTarget): string {
  const mountPath = publicMountPath(c)
  if (target.mountRoot) return `${mountPath}/`
  const workspace = requireWorkspace(target)
  if (!target.matter) return workspaceHref(workspace, mountPath)
  const path = joinMatterPath(target.matter.parent, target.matter.name)
  const href = `${workspaceHref(workspace, mountPath)}${path.split('/').map(encodeDavPathSegment).join('/')}`
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
  const locks = await activeLocks(c.get('deps'), { orgId: workspace.id, resourcePath: resourcePath(target) })
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
    const locks = workspace
      ? await activeLocks(c.get('deps'), { orgId: workspace.id, resourcePath: resourcePath(target) })
      : []
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
    if (url.host !== new URL(c.req.url).host) return null
    return await resolveWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: normalizeDavMountPath(url.pathname) })
  } catch {
    return null
  }
}

async function davEntries(c: DavContext, targets: WebDavTarget[]): Promise<DavEntry[]> {
  const entries: DavEntry[] = []
  const mountPath = publicMountPath(c)
  const byWorkspace = new Map<string, { workspace: NonNullable<WebDavTarget['workspace']>; targets: WebDavTarget[] }>()

  for (const target of targets) {
    if (target.mountRoot) {
      entries.push(mountRootEntry(mountPath))
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

  for (const { workspace, targets: workspaceTargets } of byWorkspace.values()) {
    const paths = workspaceTargets.map(resourcePath)
    const [deadPropertiesByPath, locksByPath] = await Promise.all([
      listDeadPropertiesForResources(c.get('deps'), { orgId: workspace.id, resourcePaths: paths }),
      activeLocksForResources(c.get('deps'), { orgId: workspace.id, resourcePaths: paths }),
    ])
    for (const target of workspaceTargets) {
      const path = resourcePath(target)
      const deadProperties = deadPropertiesByPath.get(path) ?? []
      const locks = locksByPath.get(path) ?? []
      entries.push(
        target.matter
          ? matterEntry(workspace, target.matter, deadProperties, locks, mountPath)
          : workspaceEntry(workspace, deadProperties, locks, mountPath),
      )
    }
  }

  return entries
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
  try {
    const target = await resolveWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: davPath(c) })
    const depth = c.req.header('Depth') ?? '1'
    if (depth !== '0' && depth !== '1') {
      return xmlResponse(errorXml('propfind-finite-depth', 'Depth infinity is not supported for PROPFIND.'), 403)
    }
    const request = parsePropfindXml(await c.req.text())
    const targets: WebDavTarget[] = []

    if (target.mountRoot) {
      targets.push(target)
      if (depth !== '0') {
        for (const workspace of await listUserWebDavWorkspaces(c.get('deps'), auth.userId)) {
          const workspaceTarget = { workspace, mountRoot: false, parent: '', name: '', matter: null }
          targets.push(workspaceTarget)
        }
      }
    } else if (!target.matter) {
      if (target.name) throw new WebDavPathError('Not found', 404)
      const workspace = requireWorkspace(target)
      targets.push(target)
      if (depth !== '0') {
        for (const matter of await listWebDavChildren(c.get('deps'), { orgId: workspace.id, parent: '' })) {
          targets.push({ workspace, mountRoot: false, parent: matter.parent, name: matter.name, matter })
        }
      }
    } else {
      const workspace = requireWorkspace(target)
      targets.push(target)
      if (depth !== '0' && target.matter.dirtype !== DirType.FILE) {
        const parent = joinMatterPath(target.matter.parent, target.matter.name)
        for (const matter of await listWebDavChildren(c.get('deps'), { orgId: workspace.id, parent })) {
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
  try {
    const target = await resolveWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: davPath(c) })
    if (target.name && !target.matter) throw new WebDavPathError('Not found', 404)
    const workspace = requireWorkspace(target)
    const locked = await lockPrecondition(c, target)
    if (locked) return locked
    const ifFailed = await ifHeaderPrecondition(c, auth, target)
    if (ifFailed) return ifFailed
    const operations = parseProppatchXml(await c.req.text())
    await applyWebDavDeadProperties(c.get('deps'), {
      orgId: workspace.id,
      resourcePath: resourcePath(target),
      operations,
      matterId: target.matter?.id ?? null,
    })
    const properties = operations.map((operation) => operation.property)
    return xmlResponse(proppatchMultistatus(targetHref(c, target), properties), 207)
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
    const resolved = await resolveWebDavDownload(c.get('deps'), { userId: auth.userId, rawPath: davPath(c) })
    if (!resolved.ok) {
      switch (resolved.reason) {
        case 'not_found':
          throw new WebDavPathError('Not found', 404)
        case 'workspace_not_found':
          throw new WebDavPathError('Workspace not found', 404)
        case 'not_a_file':
          return c.text('Cannot read collection as file', 405)
        case 'storage_not_found':
          return c.text('Storage not found', 404)
      }
    }
    const { matter, workspace, storage } = resolved
    const precondition = preconditionResponse(c, matter)
    if (precondition) return precondition

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
      const reservation = await reserveWebDavTraffic(c, auth.userId, workspace.id, matter, storage, size)
      if (reservation.error) return reservation.error
      try {
        const body = await getWebDavObjectBody(c.get('deps'), { storage, object: matter.object })
        await recordWebDavDownloadIssued(c.get('deps'), {
          orgId: workspace.id,
          userId: auth.userId,
          matterId: matter.id,
          matterName: matter.name,
          storageId: storage.id,
          bytes: size,
          trafficEventId: reservation.trafficEventId,
        })
        return new Response(fixedLengthResponseBody(body, size), { headers })
      } catch (e) {
        await refundWebDavTraffic(c.get('deps'), { orgId: workspace.id, bytes: size })
        throw e
      }
    }

    if (rangeRequest.action === 'reject') return rangeNotSatisfiable(size)
    if (rangeRequest.action !== 'serve') throw new Error('Unexpected range request action')
    const trafficBytes = rangeContentBytes(rangeRequest.ranges)
    const reservation = await reserveWebDavTraffic(c, auth.userId, workspace.id, matter, storage, trafficBytes)
    if (reservation.error) return reservation.error
    if (rangeRequest.ranges.length > 1) {
      const boundary = `zpan-webdav-${matter.id}`
      const contentLength = multipartRangeContentLength(boundary, matter.type, rangeRequest.ranges, size)
      const body = multipartRangeBody(c, storage, matter, boundary, rangeRequest.ranges, size)
      headers.set('Content-Type', `multipart/byteranges; boundary=${boundary}`)
      headers.set('Content-Length', String(contentLength))
      headers.delete('Content-Range')
      try {
        await recordWebDavDownloadIssued(c.get('deps'), {
          orgId: workspace.id,
          userId: auth.userId,
          matterId: matter.id,
          matterName: matter.name,
          storageId: storage.id,
          bytes: trafficBytes,
          trafficEventId: reservation.trafficEventId,
        })
      } catch (error) {
        await refundWebDavTraffic(c.get('deps'), { orgId: workspace.id, bytes: trafficBytes })
        throw error
      }
      return new Response(fixedLengthResponseBody(body, contentLength), { status: 206, headers })
    }

    const [range] = rangeRequest.ranges
    const contentLength = range.end - range.start + 1
    let body: BodyInit
    try {
      body = await getWebDavObjectBody(c.get('deps'), {
        storage,
        object: matter.object,
        range: `bytes=${range.start}-${range.end}`,
      })
    } catch (e) {
      await refundWebDavTraffic(c.get('deps'), { orgId: workspace.id, bytes: contentLength })
      throw e
    }
    headers.set('Content-Length', String(contentLength))
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    try {
      await recordWebDavDownloadIssued(c.get('deps'), {
        orgId: workspace.id,
        userId: auth.userId,
        matterId: matter.id,
        matterName: matter.name,
        storageId: storage.id,
        bytes: contentLength,
        trafficEventId: reservation.trafficEventId,
      })
    } catch (error) {
      await refundWebDavTraffic(c.get('deps'), { orgId: workspace.id, bytes: contentLength })
      throw error
    }
    return new Response(fixedLengthResponseBody(body, contentLength), { status: 206, headers })
  } catch (e) {
    return davError(c, e)
  }
}

// Meters a WebDAV download (consume traffic quota → report egress) and renders
// the 422 / 402 responses. Returns null when metering succeeded (or the read is
// zero bytes) and the caller should proceed to stream the body.
async function reserveWebDavTraffic(
  c: DavContext,
  userId: string,
  orgId: string,
  matter: NonNullable<WebDavTarget['matter']>,
  storage: StorageRecord,
  bytes: number,
): Promise<{ error: Response | null; trafficEventId: string }> {
  const trafficEventId = `traffic_${crypto.randomUUID()}`
  const outcome = await meterWebDavDownload(c.get('deps'), {
    cloudBaseUrl: cloudBaseUrl(c),
    orgId,
    userId,
    matterId: matter.id,
    matterName: matter.name,
    storage,
    bytes,
    trafficEventId,
  })
  if (outcome.ok) return { error: null, trafficEventId }
  if (outcome.reason === 'quota_exceeded') return { error: c.text('Traffic quota exceeded', 422), trafficEventId }
  throw insufficientCredits('Insufficient credits', { metadata: { resource: 'storage_egress' } })
}

async function putFile(c: DavContext, auth: DavAuth): Promise<Response> {
  try {
    const target = await resolveWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: davPath(c) })
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
    const contentType = c.req.header('Content-Type') ?? 'application/octet-stream'

    try {
      const result = await putWebDavFile(c.get('deps'), {
        orgId: workspace.id,
        userId: auth.userId,
        target,
        fileName: target.name,
        parent: target.parent,
        contentType,
        contentLength,
        body,
      })
      if (!result.ok) return c.text('Storage not found', 404)
      return new Response(null, { status: result.status })
    } catch (e) {
      const mapped = mapDomainError(e)
      if (mapped) return c.text(mapped.message, mapped.status)
      throw e
    }
  } catch (e) {
    return davError(c, e)
  }
}

async function makeCollection(c: DavContext, auth: DavAuth): Promise<Response> {
  try {
    const target = await resolveWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: davPath(c) })
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
    await createWebDavCollection(c.get('deps'), {
      orgId: workspace.id,
      userId: auth.userId,
      name: target.name,
      parent: target.parent,
    })
    return new Response(null, { status: 201 })
  } catch (e) {
    return davError(c, e)
  }
}

async function deleteMatter(c: DavContext, auth: DavAuth): Promise<Response> {
  try {
    const target = await resolveExistingWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: davPath(c) })
    const workspace = requireWorkspace(target)
    const matter = target.matter
    if (!matter) throw new WebDavPathError('Not found', 404)
    const locked = await lockPrecondition(c, target)
    if (locked) return locked
    const ifFailed = await ifHeaderPrecondition(c, auth, target)
    if (ifFailed) return ifFailed
    await deleteWebDavMatter(c.get('deps'), {
      orgId: workspace.id,
      resourcePath: resourcePath(target),
      matterId: matter.id,
      userId: auth.userId,
    })
    return new Response(null, { status: 204 })
  } catch (e) {
    return davError(c, e)
  }
}

async function moveMatter(c: DavContext, auth: DavAuth): Promise<Response> {
  try {
    const source = await resolveExistingWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: davPath(c) })
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
    const target = await resolveWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: destination })
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
    await moveWebDavMatter(c.get('deps'), {
      orgId: sourceWorkspace.id,
      userId: auth.userId,
      sourceMatterId: source.matter.id,
      sourceResourcePath: resourcePath(source),
      targetName: target.name,
      targetParent: target.parent,
      targetResourcePath: resourcePath(target),
      replacedMatterId: target.matter?.id ?? null,
    })
    return new Response(null, { status: replacingTarget ? 204 : 201 })
  } catch (e) {
    return davError(c, e)
  }
}

async function copyMatterRoute(c: DavContext, auth: DavAuth): Promise<Response> {
  try {
    const source = await resolveExistingWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: davPath(c) })
    const sourceWorkspace = requireWorkspace(source)
    if (!source.matter) throw new WebDavPathError('Not found', 404)
    const sourceMatter = source.matter
    const ifFailed = await ifHeaderPrecondition(c, auth, source)
    if (ifFailed) return ifFailed
    const precondition = preconditionResponse(c, sourceMatter)
    if (precondition) return precondition
    const destination = destinationPath(c)
    if (destination instanceof Response) return destination
    const target = await resolveWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: destination })
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
      const depth = c.req.header('Depth') ?? 'infinity'
      if (depth !== '0' && depth !== 'infinity') return xmlResponse(errorXml('bad-depth'), 400)
      try {
        const result = await copyWebDavCollection(c.get('deps'), {
          orgId: sourceWorkspace.id,
          userId: auth.userId,
          sourceMatter,
          sourceRoot: oldPath,
          targetName: target.name,
          targetParent: target.parent,
          targetResourcePath: resourcePath(target),
          targetMatter: target.matter,
          replacingTarget,
          depth,
        })
        if (!result.ok) return c.text('Storage not found', 404)
        c.header('Location', matterLocation(c, targetWorkspace.pathSegment, result.location))
        return c.body(null, result.status)
      } catch (e) {
        const mapped = mapDomainError(e)
        if (mapped) return c.text(mapped.message, mapped.status)
        throw e
      }
    }

    try {
      const result = await copyWebDavFile(c.get('deps'), {
        orgId: sourceWorkspace.id,
        userId: auth.userId,
        sourceMatter,
        sourceResourcePath: resourcePath(source),
        targetName: target.name,
        targetParent: target.parent,
        targetResourcePath: resourcePath(target),
        replacedMatterId: target.matter?.id ?? null,
        replacingTarget,
      })
      if (!result.ok) return c.text('Storage not found', 404)
      c.header('Location', matterLocation(c, targetWorkspace.pathSegment, result.location))
      return c.body(null, result.status)
    } catch (e) {
      const mapped = mapDomainError(e)
      if (mapped) return c.text(mapped.message, mapped.status)
      throw e
    }
  } catch (e) {
    return davError(c, e)
  }
}

async function lockMatter(c: DavContext, auth: DavAuth): Promise<Response> {
  try {
    const target = await resolveWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: davPath(c) })
    const workspace = requireWorkspace(target)
    const body = await c.req.text()
    const existingToken = lockRefreshToken(c)
    if (existingToken instanceof Response) return existingToken
    if (existingToken) {
      if (body.length > 0) return xmlResponse(errorXml('lock-token-submitted'), 400)
      const refreshed = await refreshWebDavLock(c.get('deps'), {
        orgId: workspace.id,
        resourcePath: resourcePath(target),
        token: existingToken,
        timeoutSeconds: parseTimeout(c.req.header('Timeout')),
      })
      if (!refreshed) return xmlResponse(errorXml('lock-token-submitted'), 412)
      return xmlResponse(lockDiscoveryXml(refreshed), 200)
    }

    const depth = c.req.header('Depth') ?? 'infinity'
    if (depth !== '0' && depth !== 'infinity') return xmlResponse(errorXml('bad-depth'), 400)
    const path = resourcePath(target)
    const conflicts = await conflictingLocks(c.get('deps'), { orgId: workspace.id, resourcePath: path })
    if (conflicts.length > 0) return xmlResponse(errorXml('no-conflicting-lock'), 423)
    let lockInfo: { owner: string }
    try {
      lockInfo = parseLockInfoXml(body)
    } catch (e) {
      return xmlResponse(errorXml('supported-lock', e instanceof Error ? e.message : 'Unsupported lock request.'), 422)
    }
    const isCreate = !target.matter && Boolean(target.name)
    if (isCreate) {
      await ensureParentCollection(c, auth.userId, workspace.slug, target.parent)
    }
    const { lock, created } = await createWebDavLock(c.get('deps'), {
      orgId: workspace.id,
      userId: auth.userId,
      resourcePath: path,
      target,
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
    const target = await resolveExistingWebDavPath(c.get('deps'), { userId: auth.userId, rawPath: davPath(c) })
    const workspace = requireWorkspace(target)
    const token = lockTokenHeader(c)
    if (!token) return xmlResponse(errorXml('lock-token-submitted'), 400)
    const removed = await removeWebDavLock(c.get('deps'), {
      orgId: workspace.id,
      resourcePath: resourcePath(target),
      token,
    })
    if (!removed) return xmlResponse(errorXml('lock-token-matches-request-uri'), 409)
    return new Response(null, { status: 204 })
  } catch (e) {
    return davError(c, e)
  }
}

function matterLocation(c: DavContext, workspaceSegment: string, path: string): string {
  const requestUrl = new URL(c.req.url)
  const mountPath = publicMountPath(c)
  const publicUrl = mountPath === '' ? webDavPublicUrl(c.get('sitePublicOrigin')) : null
  const url = publicUrl ?? requestUrl
  url.pathname = `${mountPath}/${encodeDavPathSegment(workspaceSegment)}/${path
    .split('/')
    .map(encodeDavPathSegment)
    .join('/')}`
  url.search = ''
  return url.toString()
}

export default app
