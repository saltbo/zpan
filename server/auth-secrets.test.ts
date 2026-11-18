import { describe, expect, it } from 'vitest'
import { parseAuthSecrets, resolveAuthSecrets } from './auth-secrets.js'

const LEGACY = 'legacy-secret-that-is-at-least-32-characters'
const V1 = 'version-one-secret-that-is-at-least-32-chars'
const V2 = 'version-two-secret-that-is-at-least-32-chars'

const env = (vars: Record<string, string>) => (key: string) => vars[key]

describe('parseAuthSecrets', () => {
  it('returns undefined when unset or blank', () => {
    expect(parseAuthSecrets(undefined)).toBeUndefined()
    expect(parseAuthSecrets('  ')).toBeUndefined()
  })

  it('parses versions in order, current first, trimming whitespace', () => {
    expect(parseAuthSecrets(` 2:${V2} , 1:${V1} `)).toEqual([
      { version: 2, value: V2 },
      { version: 1, value: V1 },
    ])
  })

  it('keeps colons inside the secret value', () => {
    expect(parseAuthSecrets('3:a:b:c')).toEqual([{ version: 3, value: 'a:b:c' }])
  })

  it.each([
    ['missing separator', 'nosep', 'Expected "<version>:<secret>"'],
    ['non-integer version', 'v1:secret', 'Versions must be non-negative integers'],
    ['negative version', '-1:secret', 'Versions must be non-negative integers'],
    ['empty value', '1: ', 'empty secret'],
    ['duplicate version', '1:a,1:b', 'more than once'],
  ])('rejects %s without echoing the secret', (_name, raw, message) => {
    expect(() => parseAuthSecrets(raw)).toThrow(message)
    try {
      parseAuthSecrets(raw)
    } catch (error) {
      expect((error as Error).message).not.toContain('secret:')
    }
  })
})

describe('resolveAuthSecrets', () => {
  it('stays backward compatible with a single BETTER_AUTH_SECRET', () => {
    expect(resolveAuthSecrets(env({ BETTER_AUTH_SECRET: LEGACY }), 'missing')).toEqual({ secret: LEGACY })
  })

  it('adds versioned secrets while keeping the legacy key', () => {
    expect(
      resolveAuthSecrets(env({ BETTER_AUTH_SECRET: LEGACY, BETTER_AUTH_SECRETS: `2:${V2},1:${V1}` }), 'missing'),
    ).toEqual({
      secret: LEGACY,
      secrets: [
        { version: 2, value: V2 },
        { version: 1, value: V1 },
      ],
    })
  })

  it('requires BETTER_AUTH_SECRET even when versioned secrets are set', () => {
    expect(() => resolveAuthSecrets(env({ BETTER_AUTH_SECRETS: `1:${V1}` }), 'secret is missing')).toThrow(
      'secret is missing',
    )
  })
})
