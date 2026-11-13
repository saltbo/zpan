import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from './platform/interface'
import type { Deps } from './usecases/deps'

const app = { fetch: vi.fn() }
const auth = { api: {} }
const createAppMock = vi.hoisted(() => vi.fn(() => app))
const createAuthMock = vi.hoisted(() => vi.fn(async () => auth))

vi.mock('./app', () => ({ createApp: createAppMock }))
vi.mock('./auth', () => ({ createAuth: createAuthMock }))

import { createBootstrap } from './bootstrap'

describe('Node bootstrap', () => {
  beforeEach(() => {
    createAppMock.mockClear()
    createAuthMock.mockClear()
  })

  it('starts without inspecting optional ID-normalization state', async () => {
    const db = { all: vi.fn(), run: vi.fn() }
    const platform = {
      db,
      getEnv: (name: string) =>
        name === 'BETTER_AUTH_SECRET' ? 'test-secret' : name === 'BETTER_AUTH_URL' ? 'https://zpan.test' : undefined,
    } as unknown as Platform
    const deps = {} as Deps

    await expect(createBootstrap(platform, deps)).resolves.toBe(app)
    expect(createAuthMock).toHaveBeenCalledWith(platform, { secret: 'test-secret' }, 'https://zpan.test', [
      'http://localhost:5185',
    ])
    expect(createAppMock).toHaveBeenCalledWith(platform, auth, deps)
    expect(db.all).not.toHaveBeenCalled()
    expect(db.run).not.toHaveBeenCalled()
  })

  it('passes versioned BETTER_AUTH_SECRETS alongside the legacy secret', async () => {
    const vars: Record<string, string> = { BETTER_AUTH_SECRET: 'test-secret', BETTER_AUTH_SECRETS: '2:new,1:old' }
    const platform = { db: {}, getEnv: (name: string) => vars[name] } as unknown as Platform

    await createBootstrap(platform, {} as Deps)
    expect(createAuthMock).toHaveBeenCalledWith(
      platform,
      {
        secret: 'test-secret',
        secrets: [
          { version: 2, value: 'new' },
          { version: 1, value: 'old' },
        ],
      },
      'http://localhost:5185',
      ['http://localhost:5185'],
    )
  })

  it('requires BETTER_AUTH_SECRET', async () => {
    const platform = { db: {}, getEnv: () => undefined } as unknown as Platform
    await expect(createBootstrap(platform, {} as Deps)).rejects.toThrow('BETTER_AUTH_SECRET is required')
  })
})
