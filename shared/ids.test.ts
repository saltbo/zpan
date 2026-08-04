import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BASE62_ALPHABET,
  DEFAULT_ID_LENGTH,
  decodeBase62Bytes,
  encodeBase62Bytes,
  generateId,
  generateToken,
  isBase62,
} from './ids'

describe('Base62 identifiers', () => {
  it('uses the fixed 0-9A-Za-z alphabet', () => {
    expect(BASE62_ALPHABET).toBe('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')
  })

  it('generates default identifiers with at least the old Nano ID entropy', () => {
    const values = Array.from({ length: 10_000 }, () => generateId())
    expect(new Set(values)).toHaveLength(values.length)
    expect(values.every((value) => value.length === DEFAULT_ID_LENGTH && isBase62(value))).toBe(true)
    expect(DEFAULT_ID_LENGTH * Math.log2(BASE62_ALPHABET.length)).toBeGreaterThanOrEqual(21 * Math.log2(64))
  })

  it('generates explicit-length Base62 tokens', () => {
    const token = generateToken(43)
    expect(token).toHaveLength(43)
    expect(isBase62(token)).toBe(true)
  })

  it('rejects punctuation and empty values', () => {
    expect(isBase62('Ab09')).toBe(true)
    expect(isBase62('legacy_id')).toBe(false)
    expect(isBase62('legacy-id')).toBe(false)
    expect(isBase62('')).toBe(false)
  })

  it('round-trips binary signed-token envelopes through Base62', () => {
    const value = Uint8Array.from([1, 0, 255, 45, 95, 200])
    const encoded = encodeBase62Bytes(value)
    expect(encoded).toMatch(/^[A-Za-z0-9]+$/)
    expect(decodeBase62Bytes(encoded)).toEqual(value)
  })

  it('keeps every reviewed production creation path on the central Base62 contract', () => {
    const expectedFiles = [
      'scripts/seed-preview-admin.ts',
      'server/adapters/repos/admin-stats-rollup.ts',
      'server/adapters/repos/announcement.ts',
      'server/adapters/repos/audit.ts',
      'server/adapters/repos/background-job.ts',
      'server/adapters/repos/cloud-store.ts',
      'server/adapters/repos/cloud-traffic-report.ts',
      'server/adapters/repos/downloader-bootstrap.ts',
      'server/adapters/repos/image-hosting.ts',
      'server/adapters/repos/instance.ts',
      'server/adapters/repos/invite.ts',
      'server/adapters/repos/license-binding.ts',
      'server/adapters/repos/matter.ts',
      'server/adapters/repos/notification.ts',
      'server/adapters/repos/oauth-client-registration.ts',
      'server/adapters/repos/object-upload-session.ts',
      'server/adapters/repos/remote-download-usage.ts',
      'server/adapters/repos/share.ts',
      'server/adapters/repos/site-invitations.ts',
      'server/adapters/repos/storage-usage-ledger.ts',
      'server/adapters/repos/storage.ts',
      'server/adapters/repos/team-invite.ts',
      'server/adapters/repos/user-admin.ts',
      'server/adapters/repos/webdav-state.ts',
      'server/adapters/repos/x402-capacity-purchase.ts',
      'server/auth.ts',
      'server/auth/oauth-client-registration-management.ts',
      'server/auth/oauth-par.ts',
      'server/http/image-hosting/images.ts',
      'server/lib/path-template.ts',
      'server/usecases/downloads/downloads.ts',
      'server/usecases/image-hosting/config.ts',
      'server/usecases/site/image-domain-provider.ts',
      'server/usecases/store/traffic-metering.ts',
    ]
    const files = execFileSync('git', ['ls-files', 'server', 'scripts', 'shared', 'src', 'workers'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter((file) => file && !/\.(?:test|cf-test|libsql-test)\.[jt]sx?$/.test(file))
    const reviewed: string[] = []
    let calls = 0
    for (const file of files) {
      if (file === 'shared/ids.ts' || file === 'scripts/id-backfill-core.ts') continue
      const source = readFileSync(file, 'utf8')
      const matches = [...source.matchAll(/\b(generateId|generateToken)\(\s*(\d+)?\s*\)/g)]
      if (matches.length === 0) continue
      reviewed.push(file)
      expect(source, `${file} must import only the central generator`).toMatch(
        /from ['"](?:@shared\/ids|\.\.\/(?:\.\.\/)*shared\/ids)['"]/,
      )
      for (const match of matches) {
        const length = match[2] ? Number(match[2]) : DEFAULT_ID_LENGTH
        const value = match[1] === 'generateId' ? generateId(length) : generateToken(length)
        expect(value, `${file}:${match[0]}`).toHaveLength(length)
        expect(isBase62(value), `${file}:${match[0]}`).toBe(true)
        calls += 1
      }
    }

    expect(reviewed.sort()).toEqual(expectedFiles)
    expect(calls).toBe(67)
  })
})
