import { createRoute, z } from '@hono/zod-openapi'
import { describe, expect, it } from 'vitest'
import { jsonBody } from './openapi'
import { createRouter } from './router'

const route = createRoute({
  method: 'post',
  path: '/items',
  request: {
    query: z.object({ limit: z.coerce.number().int().optional() }),
    ...jsonBody(
      z.object({
        name: z.string(),
        link: z.object({
          uri: z.string().refine((uri) => uri.startsWith('https://'), 'URL must be a public http(s) address'),
        }),
      }),
    ),
  },
  responses: { 200: { description: 'Created' } },
})

const router = createRouter().openapi(route, (c) => c.body(null, 200))

async function post(body: unknown, headers: Record<string, string> = {}, query = '') {
  const res = await router.request(`/items${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as { error: Record<string, unknown> } }
}

const details = (field: string) => [
  {
    '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
    reason: 'INVALID_ARGUMENT',
    domain: 'zpan.dev',
    metadata: { field },
  },
]

describe('createRouter validation hook [spec: error-messages/invalid-request]', () => {
  it('answers a schema message the catalog knows with that message, in English by default', async () => {
    const { status, body } = await post({ name: 'a', link: { uri: 'http://127.0.0.1/a.zip' } })
    expect(status).toBe(400)
    expect(body).toEqual({
      error: {
        code: 400,
        message: 'URL must be a public http(s) address',
        status: 'INVALID_ARGUMENT',
        details: details('link.uri'),
      },
    })
  })

  it('answers the same message in Chinese for a Chinese request', async () => {
    const { status, body } = await post(
      { name: 'a', link: { uri: 'http://127.0.0.1/a.zip' } },
      { 'Accept-Language': 'zh-CN' },
    )
    expect(status).toBe(400)
    expect(body.error).toMatchObject({
      message: '链接须为公网 http(s) 地址',
      status: 'INVALID_ARGUMENT',
      details: details('link.uri'),
    })
  })

  it("replaces zod's built-in wording with a sentence naming the field", async () => {
    expect((await post({ link: { uri: 'https://a' } })).body.error).toMatchObject({
      message: 'Invalid value for name',
      details: details('name'),
    })
    expect((await post({ link: { uri: 'https://a' } }, { 'Accept-Language': 'zh' })).body.error).toMatchObject({
      message: 'name 的值无效',
      details: details('name'),
    })
  })

  it('covers query parameters too', async () => {
    const { status, body } = await post({ name: 'a', link: { uri: 'https://a' } }, {}, '?limit=many')
    expect(status).toBe(400)
    expect(body.error).toMatchObject({ message: 'Invalid value for limit', details: details('limit') })
  })

  it('says the request is invalid when the issue has no field', async () => {
    const { body } = await post('not an object', { 'Accept-Language': 'zh' })
    expect(body.error).toMatchObject({ code: 400, message: '请求无效', status: 'INVALID_ARGUMENT' })
    expect(body.error.details).toEqual([
      { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'INVALID_ARGUMENT', domain: 'zpan.dev' },
    ])
  })
})
