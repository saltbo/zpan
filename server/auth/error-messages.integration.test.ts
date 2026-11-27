import { captcha } from 'better-auth/plugins'
import { describe, expect, it } from 'vitest'
import * as schema from '../db/schema.js'
import { adminHeaders, createTestApp } from '../test/setup.js'
import { localizeAuthErrorMessage, ZH_AUTH_ERROR_MESSAGES } from './error-messages.js'

type TestCtx = Awaited<ReturnType<typeof createTestApp>>
type Language = 'en' | 'zh'

function post(ctx: TestCtx, path: string, body: unknown, language: Language, headers: HeadersInit = {}) {
  const merged = new Headers(headers)
  merged.set('Content-Type', 'application/json')
  merged.set('Accept-Language', language)
  return ctx.app.request(`/api/auth${path}`, { method: 'POST', headers: merged, body: JSON.stringify(body) })
}

async function errorOf(response: Response | Promise<Response>) {
  const res = await response
  const body = (await res.json()) as { message: string; code?: string }
  return { status: res.status, code: body.code, message: body.message }
}

// Each failure is sent once in English and once in Chinese; the status and code
// stay the same and only the message follows the request.
async function expectLocalized(send: (language: Language) => Response | Promise<Response>, en: string, zh: string) {
  const english = await errorOf(send('en'))
  const chinese = await errorOf(send('zh'))
  expect(english.message).toBe(en)
  expect(chinese.message).toBe(zh)
  expect(chinese.status).toBe(english.status)
  expect(chinese.code).toBe(english.code)
}

const account = { name: 'Second User', email: 'second@example.com', password: 'password123456', username: 'second' }

describe('Better Auth errors in the request language [spec: error-messages/auth]', () => {
  it('sign-in with a wrong password', async () => {
    const ctx = await createTestApp()
    await adminHeaders(ctx.app)
    await expectLocalized(
      (lang) => post(ctx, '/sign-in/email', { email: 'admin@example.com', password: 'wrong-password' }, lang),
      'Invalid email or password',
      '邮箱或密码错误',
    )
    await expectLocalized(
      (lang) => post(ctx, '/sign-in/username', { username: 'nobody', password: 'wrong-password' }, lang),
      'Invalid username or password',
      '用户名或密码错误',
    )
  })

  it('sign-up with a short password, a taken email, or a malformed email', async () => {
    const ctx = await createTestApp()
    await adminHeaders(ctx.app)
    await expectLocalized(
      (lang) => post(ctx, '/sign-up/email', { ...account, password: 'short' }, lang),
      'Password too short',
      '密码太短',
    )
    await expectLocalized(
      (lang) => post(ctx, '/sign-up/email', { ...account, email: 'admin@example.com' }, lang),
      'User already exists. Use another email.',
      '该邮箱已被注册，请换一个邮箱',
    )
    await expectLocalized(
      (lang) => post(ctx, '/sign-up/email', { ...account, email: 'not-an-email' }, lang),
      'Invalid value for email',
      'email 的值无效',
    )
  })

  it('sign-up that the registration gate refuses names the reason', async () => {
    const ctx = await createTestApp()
    await adminHeaders(ctx.app)
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await expectLocalized(
      (lang) => post(ctx, '/sign-up/email', account, lang),
      'An invite code is required to register',
      '需要邀请码才能注册',
    )
    await expectLocalized(
      (lang) => post(ctx, '/sign-up/email', { ...account, inviteCode: 'BADCODE001' }, lang),
      'Invalid invite code',
      '邀请码无效',
    )
  })

  it('password reset with an invalid link', async () => {
    const ctx = await createTestApp()
    await expectLocalized(
      (lang) => post(ctx, '/reset-password', { token: 'not-a-token', newPassword: 'password123456' }, lang),
      'Invalid token',
      '链接无效或已过期',
    )
  })

  it('API keys: a missing key and a workspace the user cannot edit', async () => {
    const ctx = await createTestApp()
    const headers = await adminHeaders(ctx.app)
    await expectLocalized(
      (lang) => post(ctx, '/api-key/delete', { configId: 'ihost', keyId: 'missing' }, lang, headers),
      'API Key not found',
      '未找到 API 密钥',
    )
    await expectLocalized(
      (lang) =>
        post(ctx, '/api-key/create', { configId: 'ihost', organizationId: 'missing', name: 'k' }, lang, headers),
      'Editor access to the workspace is required',
      '需要该空间的编辑权限',
    )
  })

  it('teams: a taken slug and the free team limit', async () => {
    const ctx = await createTestApp()
    const headers = await adminHeaders(ctx.app)
    const created = await post(ctx, '/organization/create', { name: 'Team A', slug: 'team-a' }, 'en', headers)
    expect(created.status).toBe(200)
    await expectLocalized(
      (lang) => post(ctx, '/organization/create', { name: 'Team A', slug: 'team-a' }, lang, headers),
      'Organization already exists',
      '团队已存在',
    )
    await expectLocalized(
      (lang) => post(ctx, '/organization/create', { name: 'Team B', slug: 'team-b' }, lang, headers),
      'Team limit reached. Free includes one personal workspace plus one extra team. Upgrade to Pro for unlimited teams.',
      '团队数量已达上限。免费版包含一个个人空间和一个额外团队，升级到 Pro 可创建不限数量的团队。',
    )
  })

  it('leaves successful responses and requests without a language untouched', async () => {
    const ctx = await createTestApp()
    const res = await ctx.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
    })
    expect(await res.json()).toEqual({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' })
    const ok = await ctx.app.request('/api/auth/get-session', { headers: { 'Accept-Language': 'zh' } })
    expect(ok.status).toBe(200)
  })
})

describe('Better Auth error catalog [spec: error-messages/catalog-complete]', () => {
  it('has Chinese text for every code the configured auth can answer', async () => {
    const ctx = await createTestApp()
    const captchaCodes = captcha({ provider: 'cloudflare-turnstile', secretKey: 'unused' }).$ERROR_CODES
    const codes = [...Object.keys(ctx.auth.$ERROR_CODES), ...Object.keys(captchaCodes)]
    const missing = codes.filter((code) => !ZH_AUTH_ERROR_MESSAGES[code]?.trim())
    expect(missing).toEqual([])
  })

  it('never shows the code itself as the message', () => {
    for (const [code, text] of Object.entries(ZH_AUTH_ERROR_MESSAGES)) {
      expect(text, code).not.toMatch(/^[A-Z_]+$/)
    }
    expect(localizeAuthErrorMessage({ code: 'VALIDATION_ERROR', message: 'Validation Error' }, 'en')).toBe(
      'Invalid request',
    )
    expect(localizeAuthErrorMessage({ code: 'SOMETHING_NEW', message: 'Something new' }, 'zh')).toBe('Something new')
  })
})
