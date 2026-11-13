import { describe, expect, it } from 'vitest'
import { createAuth } from './auth.js'
import * as authSchema from './db/auth-schema.js'
import { createTestApp } from './test/setup.js'

const LEGACY = 'legacy-secret-that-is-at-least-32-characters'
const OTHER_LEGACY = 'other-legacy-secret-at-least-32-characters'
const V1 = 'version-one-secret-that-is-at-least-32-chars'
const V2 = 'version-two-secret-that-is-at-least-32-chars'

describe('JWKS encryption across secret rotation', () => {
  async function signWith(ctx: Awaited<ReturnType<typeof createTestApp>>, config: Parameters<typeof createAuth>[1]) {
    const auth = await createAuth(ctx.db, config, 'http://localhost:3000')
    return auth.api.signJWT({ body: { payload: { sub: 'user-1' } } })
  }

  async function storedPrivateKeys(ctx: Awaited<ReturnType<typeof createTestApp>>) {
    const rows = await ctx.db.select({ privateKey: authSchema.jwks.privateKey }).from(authSchema.jwks)
    return rows.map((row) => row.privateKey)
  }

  it('keeps a key encrypted with an older version usable after adding a new version', async () => {
    const ctx = await createTestApp()
    await expect(signWith(ctx, { secret: LEGACY, secrets: [{ version: 1, value: V1 }] })).resolves.toHaveProperty(
      'token',
    )
    const [privateKey] = await storedPrivateKeys(ctx)
    expect(privateKey).toContain('$ba$1$')

    // A deployment sharing the database, with a rotated current version and even
    // a different legacy secret, still decrypts the version-1 key.
    await expect(
      signWith(ctx, {
        secret: OTHER_LEGACY,
        secrets: [
          { version: 2, value: V2 },
          { version: 1, value: V1 },
        ],
      }),
    ).resolves.toHaveProperty('token')
    expect(await storedPrivateKeys(ctx)).toHaveLength(1)
  })

  it('decrypts keys written before versioning through the legacy BETTER_AUTH_SECRET', async () => {
    const ctx = await createTestApp()
    await expect(signWith(ctx, LEGACY)).resolves.toHaveProperty('token')
    const [privateKey] = await storedPrivateKeys(ctx)
    expect(privateKey).not.toContain('$ba$')

    await expect(signWith(ctx, { secret: LEGACY, secrets: [{ version: 1, value: V1 }] })).resolves.toHaveProperty(
      'token',
    )
  })

  it('fails when the secret that encrypted the key is no longer listed', async () => {
    const ctx = await createTestApp()
    await signWith(ctx, { secret: LEGACY, secrets: [{ version: 1, value: V1 }] })
    await expect(signWith(ctx, { secret: LEGACY, secrets: [{ version: 2, value: V2 }] })).rejects.toThrow(
      'Failed to decrypt private key',
    )
  })
})
