import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Platform } from './interface'
import { createLibsqlPlatform } from './libsql'

const migrationsFolder = path.join(__dirname, '../../migrations')

let platform: Platform

beforeAll(async () => {
  process.env.MIGRATIONS_DIR = migrationsFolder
  platform = await createLibsqlPlatform({
    TURSO_DATABASE_URL: 'file::memory:',
  })
}, 30_000)

describe('libsql platform', () => {
  it('connects and applies all migrations', () => {
    expect(platform).toBeDefined()
    expect(platform.db).toBeDefined()
  })

  it('returns env values via getEnv', () => {
    process.env.TEST_LIBSQL_KEY = 'hello'
    expect(platform.getEnv('TEST_LIBSQL_KEY')).toBe('hello')
    delete process.env.TEST_LIBSQL_KEY
  })

  it('returns undefined for missing env keys', () => {
    expect(platform.getEnv('__NONEXISTENT_KEY__')).toBeUndefined()
  })

  it('can query the storages table', async () => {
    const rows = await platform.db.query.storages.findMany()
    expect(Array.isArray(rows)).toBe(true)
  })

  it('can query the user table', async () => {
    const rows = await platform.db.query.user.findMany()
    expect(Array.isArray(rows)).toBe(true)
  })
})

describe('createLibsqlPlatform with file:// URL', () => {
  it('boots without TURSO_AUTH_TOKEN', async () => {
    const p = await createLibsqlPlatform({
      TURSO_DATABASE_URL: 'file::memory:',
    })
    expect(p.db).toBeDefined()
  })
})
