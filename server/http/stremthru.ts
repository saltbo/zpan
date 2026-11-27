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
  })
  return c.json({ data })
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
