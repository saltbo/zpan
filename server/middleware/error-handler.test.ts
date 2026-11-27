import type { Context } from 'hono'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import {
  AppError,
  badGateway,
  externalError,
  msg,
  NameConflictError,
  ObjectUploadSessionError,
  textMessage,
} from '../usecases/ports'
import { isHandledError, jsonError, requestLanguage, standaloneJsonError } from './error-handler'
import type { Env } from './platform'

// Build a real Context so jsonError's c.json / c.set behave as in production.
async function ctx(headers: Record<string, string> = {}): Promise<Context<Env>> {
  let captured!: Context<Env>
  const app = new Hono<Env>()
  app.get('/x', (c) => {
    c.set('errorLog', null)
    captured = c as unknown as Context<Env>
    return c.body(null, 200)
  })
  await app.request('/x', { headers })
  return captured
}

describe('jsonError', () => {
  it('renders an AppError as its AIP-193 body + status and records errorLog', async () => {
    const c = await ctx()
    const res = jsonError(c, new AppError(402, 'Insufficient credits', { reason: 'INSUFFICIENT_CREDITS' }))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({
      error: { status: 'FAILED_PRECONDITION', message: 'Insufficient credits' },
    })
    expect(c.get('errorLog')).toEqual({ reason: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' })
  })

  it('keeps authentication diagnostics out of the client response', async () => {
    const c = await ctx()
    const res = jsonError(
      c,
      new AppError(401, 'Unauthorized', {
        diagnostics: { reason: 'OAUTH_DPOP_REPLAY', message: 'DPoP proof jti has already been used' },
      }),
    )

    expect(await res.json()).toMatchObject({ error: { message: 'Unauthorized', status: 'UNAUTHENTICATED' } })
    expect(c.get('errorLog')).toEqual({
      reason: 'UNAUTHENTICATED',
      message: 'DPoP proof jti has already been used',
      diagnostic: 'OAUTH_DPOP_REPLAY',
    })
  })

  it('answers an external failure with a product message and logs the service text [spec: error-messages/external-failure]', async () => {
    const c = await ctx({ 'Accept-Language': 'zh-CN' })
    const res = jsonError(c, externalError(badGateway, 'cloud_request_failed_504', 'Image upload failed'))
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body).toMatchObject({
      error: { message: 'ZPan Cloud 未能完成请求，请稍后再试。', details: [{ reason: 'CLOUD_REQUEST_FAILED' }] },
    })
    expect(JSON.stringify(body)).not.toContain('cloud_request_failed')
    expect(c.get('errorLog')).toEqual({
      reason: 'CLOUD_REQUEST_FAILED',
      message: 'cloud_request_failed_504',
      diagnostic: 'EXTERNAL_ERROR',
    })
  })

  it('answers a storage failure with a product message and logs the provider error [spec: error-messages/external-failure]', async () => {
    const c = await ctx({ 'Accept-Language': 'zh' })
    const cause = 'Storage cleanup failed: AccessDenied: signature mismatch'
    const res = jsonError(c, new ObjectUploadSessionError('storage_failure', cause))
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body).toMatchObject({ error: { message: '存储服务未能完成请求', details: [{ reason: 'STORAGE_FAILURE' }] } })
    expect(JSON.stringify(body)).not.toContain('AccessDenied')
    expect(c.get('errorLog')).toEqual({ reason: 'STORAGE_FAILURE', message: cause })
  })

  it('renders a mapped domain error with its mapped status + reason', async () => {
    const c = await ctx()
    const res = jsonError(c, new NameConflictError('doc.txt', 'id-1'))
    expect(res.status).toBe(409)
    expect(c.get('errorLog')?.reason).toBe('NAME_CONFLICT')
  })

  it('renders an unknown error as a generic 500 while logging the full cause chain', async () => {
    const c = await ctx()
    const err = new Error('top') as Error & { cause?: unknown }
    err.cause = new Error('D1_ERROR: disk full')
    const res = jsonError(c, err)
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Internal Server Error')
    const log = c.get('errorLog')
    expect(log?.reason).toBe('INTERNAL')
    expect(log?.message).toContain('top')
    expect(log?.message).toContain('D1_ERROR: disk full')
  })
})

describe('jsonError language', () => {
  it('answers a Chinese request in Chinese and keeps the log in English', async () => {
    const c = await ctx({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' })
    const res = jsonError(c, new AppError(402, 'Insufficient credits', { reason: 'INSUFFICIENT_CREDITS' }))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({
      error: { status: 'FAILED_PRECONDITION', message: '额度不足', details: [{ reason: 'INSUFFICIENT_CREDITS' }] },
    })
    expect(c.get('errorLog')).toEqual({ reason: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' })
  })

  it('fills template parameters in the requested language', async () => {
    const c = await ctx({ 'Accept-Language': 'zh' })
    const res = jsonError(c, new AppError(400, msg('Unknown builtin provider: {id}', { id: 'gitlab' })))
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('未知的内置登录方式：gitlab')
  })

  it('keeps authentication diagnostics out of a Chinese response', async () => {
    const c = await ctx({ 'Accept-Language': 'zh' })
    const res = jsonError(
      c,
      new AppError(401, 'Unauthorized', {
        diagnostics: { reason: 'OAUTH_DPOP_REPLAY', message: 'DPoP proof jti has already been used' },
      }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { message: '未登录或登录已失效', status: 'UNAUTHENTICATED' } })
    expect(c.get('errorLog')).toEqual({
      reason: 'UNAUTHENTICATED',
      message: 'DPoP proof jti has already been used',
      diagnostic: 'OAUTH_DPOP_REPLAY',
    })
  })

  it('translates a mapped domain error, filling its name', async () => {
    const c = await ctx({ 'Accept-Language': 'zh' })
    const res = jsonError(c, new NameConflictError('doc.txt', 'id-1'))
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('此位置已存在名为“doc.txt”的项目')
  })

  it('answers an unexpected failure with the generic message in Chinese', async () => {
    const c = await ctx({ 'Accept-Language': 'zh' })
    const res = jsonError(c, new Error('D1_ERROR: disk full'))
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('服务器内部错误')
  })

  it('shows text the catalog does not know as is', async () => {
    const c = await ctx({ 'Accept-Language': 'zh' })
    const res = jsonError(c, new AppError(502, textMessage('upstream said no')))
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('upstream said no')
  })
})

describe('requestLanguage', () => {
  const lang = (header?: string) =>
    requestLanguage(new Request('http://x/', { headers: header ? { 'Accept-Language': header } : {} }))

  it('defaults to English [spec: error-messages/english-default]', () => {
    expect(lang()).toBe('en')
    expect(lang('fr-FR,de;q=0.8')).toBe('en')
  })

  it('picks the most preferred supported language', () => {
    expect(lang('zh')).toBe('zh')
    expect(lang('zh-TW')).toBe('zh')
    expect(lang('en-US,zh;q=0.9')).toBe('en')
    expect(lang('fr,zh;q=0.5,en;q=0.4')).toBe('zh')
    expect(lang('en;q=0.3,zh-CN;q=0.8')).toBe('zh')
    expect(lang('zh;q=0,en')).toBe('en')
  })
})

describe('isHandledError', () => {
  it('is true for AppError and mapped domain errors, false otherwise', () => {
    expect(isHandledError(new AppError(400, textMessage('x')))).toBe(true)
    expect(isHandledError(new NameConflictError('a', 'b'))).toBe(true)
    expect(isHandledError(new Error('boom'))).toBe(false)
    expect(isHandledError(null)).toBe(false)
  })
})

describe('standaloneJsonError', () => {
  it('renders an AppError without a Hono context', async () => {
    const res = standaloneJsonError(
      new AppError(429, 'Rate limit exceeded.', { reason: 'RATE_LIMITED', headers: { 'Retry-After': '5' } }),
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('5')
    expect(await res.json()).toMatchObject({
      error: { message: 'Rate limit exceeded.', status: 'RESOURCE_EXHAUSTED' },
    })
  })

  it('answers in the language of the request it is given', async () => {
    const res = standaloneJsonError(
      new AppError(404, 'Not found'),
      new Request('http://x/', { headers: { 'Accept-Language': 'zh' } }),
    )
    expect(await res.json()).toMatchObject({ error: { message: '未找到' } })
  })

  it('does not expose unexpected errors', async () => {
    const res = standaloneJsonError(new Error('database password leaked'))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      error: { message: 'Internal Server Error' },
    })
  })
})
