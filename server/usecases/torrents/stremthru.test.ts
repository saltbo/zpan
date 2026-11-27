import { describe, expect, it, vi } from 'vitest'
import { StremThruError } from '../../domain/stremthru'
import type { Deps } from '../deps'
import { ApiKeyRateLimitError, AppError, DownloadError, type VerifiedApiKey } from '../ports'
import { authenticateStoreCaller, generateTorzLink, toStremThruError } from './stremthru'

const metering = vi.hoisted(() => ({ outcome: { ok: true } as { ok: boolean; reason?: string } }))

vi.mock('../site/licensing', () => ({ loadBindingState: vi.fn(async () => ({ bound: false })) }))
vi.mock('../store/traffic-metering', () => ({
  meterDownloadTraffic: vi.fn(async () => metering.outcome),
  confirmDownloadTraffic: vi.fn(),
  reverseDownloadTraffic: vi.fn(),
}))

const key: VerifiedApiKey = {
  id: 'key-1',
  configId: 'stremthru',
  referenceId: 'user-1',
  scope: { mode: 'workspace', orgId: 'org-1' },
  permissions: { stremthru: ['store'] },
}

function authDeps(overrides: {
  verify?: () => Promise<VerifiedApiKey | null>
  banned?: boolean
  role?: string | null
  personalOrg?: string | null
}) {
  return {
    apiKeys: { verifyApiKey: overrides.verify ?? (async () => key) },
    userAdmin: { isBanned: async () => overrides.banned ?? false },
    org: {
      getMemberRole: async () => (overrides.role === undefined ? 'owner' : overrides.role),
      findPersonalOrg: async () => overrides.personalOrg ?? null,
    },
    licenseBinding: {},
  } as unknown as Deps
}

async function authError(deps: Deps): Promise<unknown> {
  return authenticateStoreCaller(deps, { auth: {} as never, db: {} as never, token: 'zp_key' }).catch((e) => e)
}

describe('authenticateStoreCaller', () => {
  it('maps a rate-limited key to TOO_MANY_REQUESTS and rethrows other failures', async () => {
    const limited = await authError(
      authDeps({
        verify: async () => {
          throw new ApiKeyRateLimitError('Rate limit exceeded.', 1000)
        },
      }),
    )
    const broken = await authError(
      authDeps({
        verify: async () => {
          throw new Error('db down')
        },
      }),
    )

    expect(limited).toMatchObject({ code: 'TOO_MANY_REQUESTS' })
    expect(broken).toMatchObject({ message: 'db down' })
  })

  it('refuses a key of another template, a banned user, and a user outside the workspace', async () => {
    const otherTemplate = await authError(authDeps({ verify: async () => ({ ...key, configId: 'ihost' }) }))
    const banned = await authError(authDeps({ banned: true }))
    const outsider = await authError(authDeps({ role: 'viewer' }))
    const noMember = await authError(authDeps({ role: null, personalOrg: 'org-2' }))

    expect(otherTemplate).toMatchObject({ code: 'FORBIDDEN' })
    expect(banned).toMatchObject({ code: 'UNAUTHORIZED' })
    expect(outsider).toMatchObject({ code: 'FORBIDDEN' })
    expect(noMember).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('accepts the owner of a personal workspace and then requires the entitlement', async () => {
    const unlicensed = await authError(authDeps({ role: null, personalOrg: 'org-1' }))

    expect(unlicensed).toMatchObject({ code: 'PAYMENT_REQUIRED' })
  })
})

describe('toStremThruError', () => {
  it('maps ZPan errors onto StremThru codes', () => {
    const cases: Array<[unknown, string | null]> = [
      [new DownloadError('not_found'), 'NOT_FOUND'],
      [new DownloadError('forbidden'), 'FORBIDDEN'],
      [new DownloadError('invalid_state', 'Only inactive tasks'), 'BAD_REQUEST'],
      [new AppError(404, 'Not found'), 'NOT_FOUND'],
      [new AppError(401, 'Unauthorized'), 'UNAUTHORIZED'],
      [new AppError(403, 'Forbidden'), 'FORBIDDEN'],
      [new AppError(422, 'Quota exceeded'), 'PAYMENT_REQUIRED'],
      [new AppError(429, 'Rate limit exceeded.'), 'TOO_MANY_REQUESTS'],
      [new AppError(409, 'Torrent is not ready'), 'BAD_REQUEST'],
      [new AppError(500, 'Internal error'), null],
      [new Error('boom'), null],
    ]
    for (const [input, code] of cases) {
      const mapped = toStremThruError(input)
      if (code) expect(mapped).toMatchObject({ code })
      else expect(mapped).not.toBeInstanceOf(StremThruError)
    }
    expect(toStremThruError('text')).toMatchObject({ message: 'text' })
  })
})

describe('generateTorzLink', () => {
  const caller = { keyId: 'key-1', userId: 'user-1', orgId: 'org-1' }
  const torrent = { id: 't1', infoHash: 'ab'.repeat(20), storageId: 's1', status: 'ready', sourceTaskId: null }
  const file = {
    id: 'f1',
    torrentId: 't1',
    kind: 'file',
    fileIdx: 0,
    path: 'Show/E01.mkv',
    size: 10,
    objectKey: 'bt/x/f1',
  }

  function linkDeps(overrides: { storage?: unknown; torrentStatus?: string; entry?: boolean } = {}) {
    const view = {
      id: 'e1',
      orgId: 'org-1',
      status: 'ready',
      taskId: null,
      torrent: { ...torrent, status: overrides.torrentStatus ?? 'ready' },
    }
    return {
      workspaceTorrents: { get: async () => (overrides.entry === false ? null : view), update: vi.fn() },
      downloadTasks: { findRecord: async () => null },
      torrents: { listFiles: async () => [file], touch: vi.fn() },
      stremthruLinks: { get: async () => null, save: vi.fn() },
      storages: { get: async () => ('storage' in overrides ? overrides.storage : { id: 's1' }) },
      s3: { presignDownload: async () => 'https://bucket/signed' },
      audit: { record: vi.fn() },
    } as unknown as Deps
  }

  const generate = (deps: Deps, link = 'zpan:st:e1.f1') =>
    generateTorzLink(deps, { caller, link, cloudBaseUrl: 'https://cloud' }).catch((e) => e)

  it('refuses links outside the list, files that do not play yet, and files whose storage is gone', async () => {
    expect(await generate(linkDeps({ entry: false }))).toMatchObject({ code: 'NOT_FOUND' })
    expect(await generate(linkDeps(), 'zpan:st:e1.other')).toMatchObject({ code: 'NOT_FOUND' })
    expect(await generate(linkDeps(), 'zpan:st:e1')).toMatchObject({ code: 'BAD_REQUEST' })
    expect(await generate(linkDeps({ torrentStatus: 'downloading' }))).toMatchObject({ code: 'BAD_REQUEST' })
    expect(await generate(linkDeps({ storage: null }))).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('answers PAYMENT_REQUIRED when traffic is refused', async () => {
    metering.outcome = { ok: false, reason: 'insufficient_credits' }
    expect(await generate(linkDeps())).toMatchObject({ code: 'PAYMENT_REQUIRED', message: 'Insufficient credits' })
    metering.outcome = { ok: false, reason: 'quota_exceeded' }
    expect(await generate(linkDeps())).toMatchObject({ code: 'PAYMENT_REQUIRED', message: 'Traffic quota exceeded' })
    metering.outcome = { ok: true }
    expect(await generate(linkDeps())).toEqual({ link: 'https://bucket/signed' })
  })
})
