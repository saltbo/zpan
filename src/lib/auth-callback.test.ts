import { describe, expect, it } from 'vitest'
import { absoluteAuthCallbackURL } from './auth-callback'

const PREVIEW_ORIGIN = 'https://feat-x402-paid-agent-uploads-zpan.saltbo.workers.dev'

describe('absoluteAuthCallbackURL', () => {
  it('resolves a site path against the current preview origin', () => {
    expect(absoluteAuthCallbackURL('/files', PREVIEW_ORIGIN)).toBe(`${PREVIEW_ORIGIN}/files`)
  })

  it('preserves a same-origin OAuth authorization continuation', () => {
    const continuation = '/api/auth/oauth2/authorize?state=oauth-state&scope=objects%3Aread'
    expect(absoluteAuthCallbackURL(continuation, PREVIEW_ORIGIN)).toBe(`${PREVIEW_ORIGIN}${continuation}`)
  })

  it('preserves an already absolute same-origin callback', () => {
    expect(absoluteAuthCallbackURL(`${PREVIEW_ORIGIN}/files`, PREVIEW_ORIGIN)).toBe(`${PREVIEW_ORIGIN}/files`)
  })

  it.each([
    'https://attacker.example/files',
    '//attacker.example/files',
    'http://[invalid',
  ])('falls back to the current origin for unsafe callback %s', (callbackURL) => {
    expect(absoluteAuthCallbackURL(callbackURL, PREVIEW_ORIGIN)).toBe(`${PREVIEW_ORIGIN}/files`)
  })
})
