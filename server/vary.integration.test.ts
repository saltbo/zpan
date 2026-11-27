import { describe, expect, it } from 'vitest'
import { createTestApp } from './test/setup.js'

function varyTokens(res: Response): string[] {
  return (res.headers.get('Vary') ?? '').split(',').map((token) => token.trim().toLowerCase())
}

describe('Vary on localized errors [spec: error-messages/vary]', () => {
  it('merges Accept-Language with Origin on an API error', async () => {
    const { app } = await createTestApp({ BETTER_AUTH_URL: 'https://zpan.space' })

    const res = await app.request('/api/teams', {
      headers: { 'Accept-Language': 'zh', Origin: 'https://zpan.space' },
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(varyTokens(res)).toEqual(expect.arrayContaining(['accept-language', 'origin']))
  })

  it('marks a sign-in service error in English too', async () => {
    const { app } = await createTestApp({ BETTER_AUTH_URL: 'https://zpan.space' })

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://zpan.space' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
    })

    expect(res.ok).toBe(false)
    expect(varyTokens(res)).toEqual(expect.arrayContaining(['accept-language', 'origin']))
  })
})
