import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAuthMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('Better Auth must not initialize for image-domain requests')
  }),
)

vi.mock('../server/auth', async () => ({
  ...(await vi.importActual<typeof import('../server/auth')>('../server/auth')),
  createAuth: createAuthMock,
}))

import worker, { isImageDomainFastPathRequest } from './bootstrap'

const testEnv = {
  ...env,
  BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET || 'ci-test-secret-that-is-at-least-32-chars',
  BETTER_AUTH_URL: 'https://drive.fast-path.test',
}

describe('[CF] image-domain Worker fast path', () => {
  beforeEach(() => {
    createAuthMock.mockClear()
  })

  it('recognizes only rewritten custom-domain requests', () => {
    expect(isImageDomainFastPathRequest(new Request('https://img.fast-path.test/ih/folder/image.png'), testEnv)).toBe(
      true,
    )
    expect(isImageDomainFastPathRequest(new Request('https://drive.fast-path.test/ih/folder/image.png'), testEnv)).toBe(
      false,
    )
    expect(isImageDomainFastPathRequest(new Request('https://preview.workers.dev/ih/image.png'), testEnv)).toBe(false)
    expect(isImageDomainFastPathRequest(new Request('https://img.fast-path.test/api/health'), testEnv)).toBe(false)
  })

  it('serves repeated custom-domain requests without initializing Better Auth', async () => {
    const suffix = Date.now().toString(36)
    const orgId = `fastpathorg${suffix}`
    const domain = `img-${suffix}.fast-path.test`
    const now = Date.now()

    await env.DB.batch([
      env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS _zpan_id_normalization_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      ),
      env.DB.prepare(
        "INSERT OR REPLACE INTO _zpan_id_normalization_state (key, value) VALUES ('validation_version', '2')",
      ),
      env.DB.prepare(
        "INSERT OR REPLACE INTO _zpan_id_normalization_state (key, value) VALUES ('completed_at', 'test-fixture')",
      ),
    ])
    await env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, updated_at)
       VALUES (?, 'Fast Path', ?, ?, ?)`,
    )
      .bind(orgId, orgId, now, now)
      .run()
    await env.DB.prepare(
      `INSERT INTO image_hosting_configs
        (org_id, custom_domain, domain_status, domain_verified_at, created_at, updated_at)
       VALUES (?, ?, 'verified', ?, ?, ?)`,
    )
      .bind(orgId, domain, now, now, now)
      .run()

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await worker.fetch(new Request(`https://${domain}/ih/missing.png`), testEnv)
      expect(response.status).toBe(404)
      expect(await response.text()).toContain('Image not found')
    }
    expect(createAuthMock).not.toHaveBeenCalled()
  })
})
