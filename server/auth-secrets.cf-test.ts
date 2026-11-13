import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createAuth } from './auth'
import { createCloudflarePlatform } from './platform/cloudflare'

const LEGACY_A = 'preview-a-legacy-secret-at-least-32-characters'
const LEGACY_B = 'preview-b-legacy-secret-at-least-32-characters'
const V1 = 'shared-version-one-secret-at-least-32-chars'
const V2 = 'shared-version-two-secret-at-least-32-chars'

describe('[CF] versioned auth secrets on a shared D1', () => {
  it('lets deployments with divergent legacy secrets share a JWKS encrypted with a listed version', async () => {
    await env.DB.prepare('DELETE FROM jwks').run()
    const platform = createCloudflarePlatform(env)
    const sign = async (config: Parameters<typeof createAuth>[1]) => {
      const auth = await createAuth(platform.db, config, 'http://localhost')
      return auth.api.signJWT({ body: { payload: { sub: 'cf-user' } } })
    }

    // Preview A creates the key under version 1.
    await expect(sign({ secret: LEGACY_A, secrets: [{ version: 1, value: V1 }] })).resolves.toHaveProperty('token')
    // Preview B (different legacy secret, rotated to version 2) still decrypts it.
    await expect(
      sign({
        secret: LEGACY_B,
        secrets: [
          { version: 2, value: V2 },
          { version: 1, value: V1 },
        ],
      }),
    ).resolves.toHaveProperty('token')
    // A deployment that dropped version 1 reproduces the #607 failure.
    await expect(sign({ secret: LEGACY_B, secrets: [{ version: 2, value: V2 }] })).rejects.toThrow(
      'Failed to decrypt private key',
    )
  })
})
