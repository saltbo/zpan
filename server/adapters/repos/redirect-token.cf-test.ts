import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { withRedirectToken } from './redirect-token'

const RESOURCE_TABLE = 'test_redirect_token_resource'
const REGISTRY_TABLE = 'test_redirect_token_registry'

describe('[CF] redirect token collision recovery', () => {
  beforeEach(async () => {
    await env.DB.exec(`
      DROP TABLE IF EXISTS ${RESOURCE_TABLE};
      DROP TABLE IF EXISTS ${REGISTRY_TABLE};
      CREATE TABLE ${RESOURCE_TABLE} (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE);
      CREATE TABLE ${REGISTRY_TABLE} (token TEXT PRIMARY KEY, resource_id TEXT NOT NULL UNIQUE);
      INSERT INTO ${REGISTRY_TABLE} VALUES ('TakenToken1', 'ExistingImage1');
    `)
  })

  it('retries a real D1 uniqueness conflict without inspecting driver error text', async () => {
    const tokens = ['TakenToken1', 'FreshToken2']
    let forcedRace = true
    const isTaken = async (token: string) => {
      if (token === 'TakenToken1' && forcedRace) {
        forcedRace = false
        return false
      }
      return (
        (await env.DB.prepare(
          `SELECT 1 FROM ${RESOURCE_TABLE} WHERE token = ?1 UNION ALL SELECT 1 FROM ${REGISTRY_TABLE} WHERE token = ?1 LIMIT 1`,
        )
          .bind(token)
          .first()) !== null
      )
    }

    const result = await withRedirectToken(
      11,
      async (token) => {
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO ${RESOURCE_TABLE} VALUES (?1, ?2)`).bind(`Resource${token}`, token),
          env.DB.prepare(`INSERT INTO ${REGISTRY_TABLE} VALUES (?1, ?2)`).bind(token, `Resource${token}`),
        ])
        return token
      },
      isTaken,
      () => tokens.shift()!,
    )

    expect(result).toBe('FreshToken2')
    expect(await env.DB.prepare(`SELECT token FROM ${RESOURCE_TABLE}`).all()).toMatchObject({
      results: [{ token: 'FreshToken2' }],
    })
  })
})
