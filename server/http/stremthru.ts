// The StremThru Store API (docs/design/torrents.md §8), served under
// /stremthru so community addons such as MediaFusion and Comet use ZPan as their
// Debrid store. Every endpoint exists under both /v0/store/torz (MediaFusion) and
// /v0/store/magnets (Comet). Responses use StremThru's `{data}` and
// `{error:{code,message}}` envelopes, not ZPan's API shapes.

import type { Context } from 'hono'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { StremThruError, storeToken } from '../domain/stremthru'
import { formatError } from '../lib/errors'
import type { Env } from '../middleware/platform'
import { generatorStream, resolveStream, streamFileBytes, streamResponseRange } from '../usecases/torrents/stream'
import {
  addTorz,
  authenticateStoreCaller,
  checkTorz,
  generateTorzLink,
  getStoreUser,
  getTorz,
  listTorz,
  removeTorz,
  type StoreCaller,
  toStremThruError,
} from '../usecases/torrents/stremthru'
import { decodeStreamToken, encodeStreamToken } from './torrent-stream-token'

type StoreEnv = Env & { Variables: { storeCaller: StoreCaller } }
type StoreContext = Context<StoreEnv>

const KINDS = ['torz', 'magnets'] as const

async function body(c: StoreContext): Promise<Record<string, unknown>> {
  const type = c.req.header('Content-Type') ?? ''
  if (type.includes('application/json')) {
    const parsed = await c.req.json().catch(() => null)
    if (!parsed || typeof parsed !== 'object') throw new StremThruError('BAD_REQUEST', 'Invalid JSON body')
    return parsed as Record<string, unknown>
  }
  if (type.includes('form')) {
    const form = await c.req.parseBody().catch(() => ({}))
    return form as Record<string, unknown>
  }
  return {}
}

function stringField(input: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = input[name]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function caller(c: StoreContext): StoreCaller {
  return c.get('storeCaller')
}

const cloudBaseUrl = (c: StoreContext) => c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT

async function generateLink(c: StoreContext) {
  const input = await body(c)
  const data = await generateTorzLink(c.get('deps'), {
    caller: caller(c),
    link: stringField(input, 'link'),
    cloudBaseUrl: cloudBaseUrl(c),
    streamUrl: async (torrentFileId, expiresAt) => {
      const token = await encodeStreamToken(c.get('platform'), torrentFileId, expiresAt)
      return `${new URL(c.req.url).origin}/stremthru/stream/${token}`
    },
  })
  return c.json({ data })
}

// A stream link (docs/design/torrents.md §14): a ready torrent's file redirects
// to its presigned URL; a downloading one is read from its verified chunks as
// they arrive. Every answer is a ranged one, capped so the player asks for the
// next part.
async function streamFile(c: StoreContext) {
  const ref = await decodeStreamToken(c.get('platform'), c.req.param('token') ?? '')
  if (!ref) return c.json({ error: { code: 'NOT_FOUND', message: 'Stream link is invalid or expired' } }, 404)
  const deps = c.get('deps')
  const resolved = await resolveStream(deps, ref)
  if (resolved.kind === 'ready') return c.redirect(resolved.url, 302)
  const { target } = resolved
  const size = target.file.size
  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': target.file.mime || 'application/octet-stream',
  }
  if (c.req.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
  }
  const range = streamResponseRange(c.req.header('Range'), size)
  if (!range) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
  return new Response(generatorStream(streamFileBytes(deps, target, range)), {
    status: 206,
    headers: {
      ...headers,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    },
  })
}

const stremthru = new Hono<StoreEnv>()

stremthru.onError((err, c) => {
  const error = toStremThruError(err)
  if (error instanceof StremThruError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status as 400)
  }
  console.error(`stremthru.unhandled_error code=${formatError(err)}`)
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' } }, 500)
})

// X-StremThru-Store-Name names the Debrid service an addon thinks it talks to;
// ZPan is one store, so it is accepted and ignored.
stremthru.use('/v0/store/*', async (c, next) => {
  const storeCaller = await authenticateStoreCaller(c.get('deps'), {
    auth: c.get('auth'),
    db: c.get('platform').db,
    token: storeToken({
      storeAuthorization: c.req.header('X-StremThru-Store-Authorization'),
      authorization: c.req.header('Authorization'),
    }),
  })
  c.set('storeCaller', storeCaller)
  c.set('userId', storeCaller.userId)
  c.set('orgId', storeCaller.orgId)
  await next()
})

// Players open stream links without a key: the signed token is the grant.
stremthru.on(['GET', 'HEAD'], '/stream/:token', streamFile)

stremthru.get('/v0/store/user', (c) => c.json({ data: getStoreUser(caller(c)) }))

// Comet generates links on the store root rather than under magnets.
stremthru.post('/v0/store/link/generate', generateLink)

for (const kind of KINDS) {
  const base = `/v0/store/${kind}`

  stremthru.get(`${base}/check`, async (c) => {
    // MediaFusion sends `hash`, Comet sends `magnet`; both are comma-separated.
    const values = [...(c.req.queries('hash') ?? []), ...(c.req.queries('magnet') ?? [])]
    const hashes = values.flatMap((value) => value.split(','))
    return c.json({ data: { items: await checkTorz(c.get('deps'), hashes) } })
  })

  stremthru.post(`${base}/link/generate`, generateLink)

  stremthru.post(base, async (c) => {
    const input = await body(c)
    const data = await addTorz(c.get('deps'), caller(c), stringField(input, 'link', 'magnet'))
    return c.json({ data }, 201)
  })

  stremthru.get(base, async (c) => {
    const data = await listTorz(c.get('deps'), caller(c), {
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    })
    return c.json({ data })
  })

  stremthru.get(`${base}/:id`, async (c) =>
    c.json({ data: await getTorz(c.get('deps'), caller(c), c.req.param('id')) }),
  )

  stremthru.delete(`${base}/:id`, async (c) => {
    return c.json({ data: await removeTorz(c.get('deps'), caller(c), c.req.param('id')) })
  })
}

// Mounted sub-apps fall through to the parent's not-found handler, so unknown
// store paths answer here to keep StremThru's envelope.
stremthru.all('*', (c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not Found' } }, 404))

export default stremthru
