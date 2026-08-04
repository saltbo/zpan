import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { withRedirectToken } from './redirect-token'

describe('withRedirectToken', () => {
  it('skips candidates already reserved in the token namespace', async () => {
    const tokens = ['FirstToken1', 'SecondToken2', 'ThirdToken3']
    const taken = new Set(['FirstToken1', 'SecondToken2'])
    const operation = vi.fn(async (token: string) => token)

    await expect(
      withRedirectToken(
        11,
        operation,
        async (token) => taken.has(token),
        () => tokens.shift()!,
      ),
    ).resolves.toBe('ThirdToken3')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('fails after the bounded collision budget is exhausted', async () => {
    const operation = vi.fn(async () => {
      throw new Error('driver-specific unique failure')
    })

    await expect(
      withRedirectToken(
        11,
        operation,
        async () => true,
        () => 'SameToken11',
      ),
    ).rejects.toThrow('redirect_token_collision_budget_exhausted')
    expect(operation).not.toHaveBeenCalled()
  })

  it('does not hide unrelated database failures', async () => {
    const failure = new Error('database is locked')
    const operation = vi.fn(async () => {
      throw failure
    })

    await expect(withRedirectToken(11, operation, async () => false)).rejects.toBe(failure)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('retries a real unique conflict after the failed resource transaction rolls back', async () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE resources (id TEXT PRIMARY KEY, token TEXT NOT NULL);
      CREATE TABLE redirect_token_registry (token TEXT PRIMARY KEY, kind TEXT NOT NULL, resource_id TEXT NOT NULL);
      INSERT INTO redirect_token_registry VALUES ('TakenToken1', 'image_hosting', 'ExistingImage1');
    `)
    const tokens = ['TakenToken1', 'FreshToken2']
    let forcedRace = true

    const result = await withRedirectToken(
      11,
      async (token) => {
        db.transaction(() => {
          db.prepare('INSERT INTO resources VALUES (?, ?)').run(`Resource${token}`, token)
          db.prepare("INSERT INTO redirect_token_registry VALUES (?, 'direct_share', ?)").run(token, `Resource${token}`)
        })()
        return token
      },
      async (token) => {
        if (token === 'TakenToken1' && forcedRace) {
          forcedRace = false
          return false
        }
        return db.prepare('SELECT 1 FROM redirect_token_registry WHERE token = ? LIMIT 1').get(token) !== undefined
      },
      () => tokens.shift()!,
    )

    expect(result).toBe('FreshToken2')
    expect(db.prepare('SELECT token FROM resources').all()).toEqual([{ token: 'FreshToken2' }])
    db.close()
  })
})
