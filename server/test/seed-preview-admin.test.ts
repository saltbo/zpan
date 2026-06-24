import { describe, expect, it } from 'vitest'
import { buildPreviewAdminSeedSql, buildWranglerArgs } from '../../scripts/seed-preview-admin'

describe('seed-preview-admin script', () => {
  it('builds idempotent SQL for the preview admin account', () => {
    const sql = buildPreviewAdminSeedSql({
      email: "admin'quoted@zpan.space",
      passwordHash: "hash'quoted",
      userId: "user'quoted",
      accountId: "account'quoted",
      now: 1771771771771,
    })

    expect(sql).toContain("VALUES ('user''quoted', 'Admin', 'admin''quoted@zpan.space', 1, 'admin', 0, NULL, NULL")
    expect(sql).toContain('ON CONFLICT(email) DO UPDATE SET')
    expect(sql).toContain('banned = 0')
    expect(sql).toContain('ban_reason = NULL')
    expect(sql).toContain('ban_expires = NULL')
    expect(sql).toContain('UPDATE account')
    expect(sql).toContain("SET password = 'hash''quoted'")
    expect(sql).toContain('INSERT INTO account')
    expect(sql).toContain('AND NOT EXISTS')
    expect(sql).not.toContain('BEGIN')
    expect(sql).not.toContain('COMMIT')
  })

  it('targets only the remote staging D1 database', () => {
    expect(buildWranglerArgs('/tmp/seed.sql')).toEqual([
      'exec',
      'wrangler',
      'd1',
      'execute',
      'zpan-db-staging',
      '--remote',
      '--env',
      'staging',
      '--file',
      '/tmp/seed.sql',
    ])
  })
})
