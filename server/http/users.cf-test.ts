import { env } from 'cloudflare:workers'
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { createShareRepo } from '../adapters/repos/share'
import { createApp } from '../app'
import { createAuth } from '../auth'
import { createCloudflarePlatform } from '../platform/cloudflare'

type TestApp = ReturnType<typeof createApp>
type TestDb = ReturnType<typeof createCloudflarePlatform>['db']

async function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return { app: createApp(platform, auth), db: platform.db }
}

async function signUp(app: TestApp, db: TestDb, username: string) {
  const emailLocalPart = `${username}-${nanoid(6)}`.toLowerCase()
  const email = `${emailLocalPart}@example.com`
  const response = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: username, email, password: 'password123456' }),
  })
  expect(response.status).toBe(200)

  const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = ${email} LIMIT 1`)
  const userId = users[0]?.id
  if (!userId) throw new Error(`Missing signed-up user for ${email}`)

  await db.run(sql`UPDATE user SET username = ${username}, display_username = ${username} WHERE id = ${userId}`)
  const organizations = await db.all<{ id: string }>(sql`
    SELECT organization.id
    FROM organization
    INNER JOIN member ON member.organization_id = organization.id
    WHERE member.user_id = ${userId}
      AND COALESCE(organization.metadata, '') LIKE '%"type":"personal"%'
    LIMIT 1
  `)
  const orgId = organizations[0]?.id
  if (!orgId) throw new Error(`Missing personal organization for ${email}`)

  return {
    headers: { Cookie: response.headers.getSetCookie().join('; ') },
    orgId,
    userId,
    username,
  }
}

async function insertMatter(
  db: TestDb,
  orgId: string,
  name: string,
  options: { dirtype?: number; status?: string } = {},
) {
  const id = `matter-${nanoid()}`
  const now = Date.now()
  const dirtype = options.dirtype ?? 0
  await db.run(sql`
    INSERT INTO matters
      (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES
      (
        ${id},
        ${orgId},
        ${`alias-${nanoid()}`},
        ${name},
        ${dirtype === 0 ? 'text/plain' : 'folder'},
        ${dirtype === 0 ? 128 : 0},
        ${dirtype},
        '',
        ${dirtype === 0 ? `objects/${id}` : ''},
        'profile-cf-storage',
        ${options.status ?? 'active'},
        ${now},
        ${now}
      )
  `)
  return id
}

function createShare(app: TestApp, headers: Record<string, string>, body: Record<string, unknown>) {
  return app.request('/api/shares', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('[CF] public profile shares', () => {
  it('lists a landing share by default and making it private leaves the share usable', async () => {
    const { app, db } = await buildApp()
    const owner = await signUp(app, db, `profile-owner-${nanoid(5)}`)
    const matterId = await insertMatter(db, owner.orgId, 'Public guide.txt')

    const creation = await createShare(app, owner.headers, {
      matterId,
      kind: 'landing',
    })
    expect(creation.status).toBe(201)
    const created = (await creation.json()) as { token: string; private: boolean }
    expect(created.private).toBe(false)

    const profile = await app.request(`/api/users/${owner.username}`)
    expect(profile.status).toBe(200)
    expect(await profile.json()).toMatchObject({
      user: { username: owner.username },
      shares: [
        {
          token: created.token,
          name: 'Public guide.txt',
          type: 'text/plain',
          size: 128,
          isFolder: false,
        },
      ],
    })

    const madePrivate = await app.request(`/api/shares/${created.token}/privacy`, {
      method: 'PUT',
      headers: { ...owner.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ private: true }),
    })
    expect(madePrivate.status).toBe(200)

    const afterUnlisting = await app.request(`/api/users/${owner.username}`)
    expect(((await afterUnlisting.json()) as { shares: unknown[] }).shares).toEqual([])

    const underlyingShare = await app.request(`/api/shares/${created.token}`)
    expect(underlyingShare.status).toBe(200)
  })

  it('requires authentication and ownership to change share privacy', async () => {
    const { app, db } = await buildApp()
    const owner = await signUp(app, db, `profile-owner-${nanoid(5)}`)
    const other = await signUp(app, db, `profile-other-${nanoid(5)}`)
    const matterId = await insertMatter(db, owner.orgId, 'Owner only.txt')
    const share = await createShareRepo(db).create({
      matterId,
      orgId: owner.orgId,
      creatorId: owner.userId,
      kind: 'landing',
    })

    const anonymous = await app.request(`/api/shares/${share.token}/privacy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ private: true }),
    })
    expect(anonymous.status).toBe(401)

    const nonOwner = await app.request(`/api/shares/${share.token}/privacy`, {
      method: 'PUT',
      headers: { ...other.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ private: true }),
    })
    expect(nonOwner.status).toBe(403)

    const ownerMutation = await app.request(`/api/shares/${share.token}/privacy`, {
      method: 'PUT',
      headers: { ...owner.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ private: false }),
    })
    expect(ownerMutation.status).toBe(200)

    const profile = await app.request(`/api/users/${owner.username}`)
    expect(((await profile.json()) as { shares: Array<{ token: string }> }).shares.map((item) => item.token)).toEqual([
      share.token,
    ])
  })

  it('rejects ineligible privacy requests and never exposes direct or recipient-targeted shares', async () => {
    const { app, db } = await buildApp()
    const owner = await signUp(app, db, `profile-owner-${nanoid(5)}`)
    const matterId = await insertMatter(db, owner.orgId, 'Privacy boundary.txt')
    const repo = createShareRepo(db)
    const visible = await repo.create({
      matterId,
      orgId: owner.orgId,
      creatorId: owner.userId,
      kind: 'landing',
    })
    const direct = await repo.create({
      matterId,
      orgId: owner.orgId,
      creatorId: owner.userId,
      kind: 'direct',
    })
    const targeted = await repo.create({
      matterId,
      orgId: owner.orgId,
      creatorId: owner.userId,
      kind: 'landing',
      recipients: [{ recipientEmail: 'recipient@example.com' }],
    })

    for (const token of [direct.token, targeted.token]) {
      const mutation = await app.request(`/api/shares/${token}/privacy`, {
        method: 'PUT',
        headers: { ...owner.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ private: true }),
      })
      expect(mutation.status).toBe(400)
    }

    for (const body of [
      { matterId, kind: 'direct', private: true },
      {
        matterId,
        kind: 'landing',
        recipients: [{ recipientEmail: 'recipient@example.com' }],
        private: true,
      },
    ]) {
      const creation = await createShare(app, owner.headers, body)
      expect(creation.status).toBe(201)
    }

    const profile = await app.request(`/api/users/${owner.username}`)
    expect(((await profile.json()) as { shares: Array<{ token: string }> }).shares.map((item) => item.token)).toEqual([
      visible.token,
    ])
  })

  it('filters private, revoked, expired, exhausted, trashed, inactive, and missing targets at read time', async () => {
    const { app, db } = await buildApp()
    const owner = await signUp(app, db, `profile-owner-${nanoid(5)}`)
    const repo = createShareRepo(db)

    async function listedShare(name: string, options: { expiresAt?: Date; downloadLimit?: number } = {}) {
      const matterId = await insertMatter(db, owner.orgId, name)
      const share = await repo.create({
        matterId,
        orgId: owner.orgId,
        creatorId: owner.userId,
        kind: 'landing',
        ...options,
      })
      return { matterId, share }
    }

    const available = await listedShare('Available.txt')
    const revoked = await listedShare('Revoked.txt')
    await listedShare('Expired.txt', { expiresAt: new Date(Date.now() - 60_000) })
    const exhausted = await listedShare('Exhausted.txt', { downloadLimit: 1 })
    const trashed = await listedShare('Trashed.txt')
    const inactive = await listedShare('Inactive.txt')
    const missing = await listedShare('Missing.txt')
    const privateMatterId = await insertMatter(db, owner.orgId, 'Private.txt')
    await repo.create({
      matterId: privateMatterId,
      orgId: owner.orgId,
      creatorId: owner.userId,
      kind: 'landing',
      private: true,
    })

    await db.run(sql`UPDATE shares SET status = 'revoked' WHERE id = ${revoked.share.id}`)
    await db.run(sql`UPDATE shares SET downloads = 1 WHERE id = ${exhausted.share.id}`)
    await db.run(sql`UPDATE matters SET trashed_at = ${Date.now()} WHERE id = ${trashed.matterId}`)
    await db.run(sql`UPDATE matters SET status = 'processing' WHERE id = ${inactive.matterId}`)
    await db.run(sql`DELETE FROM matters WHERE id = ${missing.matterId}`)

    const profile = await app.request(`/api/users/${owner.username}`)
    expect(profile.status).toBe(200)
    expect(((await profile.json()) as { shares: Array<{ token: string }> }).shares.map((item) => item.token)).toEqual([
      available.share.token,
    ])
  })
})
