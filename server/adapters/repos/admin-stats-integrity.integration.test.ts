import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { currentTrafficPeriod } from '../../domain/quota'
import { authedHeaders, createTestApp } from '../../test/setup'
import {
  assertAdminStatsSourceIntegrity,
  ensureAdminStatsIntegrityOpening,
  inspectAdminStatsSourceIntegrity,
} from './admin-stats-integrity'
import { createCloudTrafficReportRepo } from './cloud-traffic-report'
import { createShareRepo } from './share'
import { ensureStorageUsageIntegrityOpeningBalances, ensureStorageUsageOpeningBalances } from './storage-usage-ledger'

describe('admin stats source integrity', () => {
  it('accepts the user row and share event produced by the real creation paths', async () => {
    const { app, db } = await createTestApp()
    const opening = await ensureAdminStatsIntegrityOpening(db, new Date(Date.now() - 2_000))
    await authedHeaders(app, 'stats-pipeline@example.com')
    const [identity] = await db.all<{ orgId: string; userId: string }>(sql`
      SELECT m.organization_id AS orgId, u.id AS userId
      FROM user u
      INNER JOIN member m ON m.user_id = u.id
      WHERE u.email = 'stats-pipeline@example.com'
    `)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (
        id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at
      ) VALUES (
        'stats-pipeline-file', ${identity.orgId}, 'stats-pipeline-file-alias', 'pipeline.txt',
        'text/plain', 42, 0, '', 'pipeline.txt', 'storage-1', 'active', ${now}, ${now}
      )
    `)
    await createShareRepo(db).create({
      matterId: 'stats-pipeline-file',
      orgId: identity.orgId,
      creatorId: identity.userId,
      kind: 'landing',
    })
    const integrity = await inspectAdminStatsSourceIntegrity(db, opening)

    expect(integrity).toMatchObject({
      missingDownloadTaskTerminalEvents: 0,
      backgroundJobsMissingFinishedAt: 0,
      invalidIssuedTrafficReports: 0,
      invalidAuditEvents: 0,
    })
    const userRows = await db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM user WHERE id = ${identity.userId}`,
    )
    expect(userRows).toEqual([{ count: 1 }])
  })

  it('accepts idempotent, fully linked facts produced after the opening', async () => {
    const { db } = await createTestApp()
    const opening = await ensureAdminStatsIntegrityOpening(db, new Date('2026-07-21T12:00:00.000Z'))
    const reports = createCloudTrafficReportRepo(db)
    const issuedAt = new Date('2026-07-21T12:05:00.000Z')
    await reports.insert({
      orgId: 'org-1',
      period: currentTrafficPeriod(issuedAt),
      source: 'object_download',
      sourceId: 'matter-1',
      eventId: 'traffic-integrity-ok',
      bytes: 128,
      storageId: 'storage-1',
      unitBytes: null,
      creditsPerUnit: null,
      status: 'not_required',
      now: issuedAt,
    })
    await reports.markIssued('traffic-integrity-ok', issuedAt)
    await reports.markIssued('traffic-integrity-ok', new Date('2026-07-21T12:06:00.000Z'))

    const integrity = await inspectAdminStatsSourceIntegrity(db, opening)

    expect(integrity).toMatchObject({
      missingDownloadTaskTerminalEvents: 0,
      backgroundJobsMissingFinishedAt: 0,
      invalidIssuedTrafficReports: 0,
      invalidAuditEvents: 0,
    })
    expect(() => assertAdminStatsSourceIntegrity(integrity)).not.toThrow()
    const rows = await db.all<{ events: number; issuedAt: number }>(sql`
      SELECT
        (SELECT COUNT(*) FROM audit_events WHERE id = 'event:download_issued:traffic-integrity-ok') AS events,
        (SELECT issued_at FROM cloud_traffic_reports WHERE event_id = 'traffic-integrity-ok') AS issuedAt
    `)
    expect(rows).toEqual([{ events: 0, issuedAt: issuedAt.getTime() }])
  })

  it('validates issued traffic from the earlier traffic-ledger boundary', async () => {
    const { db } = await createTestApp()
    const reports = createCloudTrafficReportRepo(db)
    await reports.ensureLedgerOpening(new Date('2026-07-21T10:05:00.000Z'))
    const opening = await ensureAdminStatsIntegrityOpening(db, new Date('2026-07-21T12:00:00.000Z'))
    const issuedAt = Date.parse('2026-07-21T11:30:00.000Z')
    await db.run(sql`
      INSERT INTO cloud_traffic_reports (
        id, org_id, period, source, source_id, event_id, bytes, status, issued_at, created_at, updated_at
      ) VALUES (
        'traffic-before-global-invalid', 'org-1', '2026-07', 'unknown', 'matter-1',
        'traffic-before-global-invalid', 10, 'not_required', ${issuedAt}, ${issuedAt}, ${issuedAt}
      )
    `)

    const integrity = await inspectAdminStatsSourceIntegrity(db, opening)

    expect(integrity.invalidIssuedTrafficReports).toBe(1)
  })

  it('rejects missing traffic reports without creating a duplicate event', async () => {
    const { db } = await createTestApp()
    const reports = createCloudTrafficReportRepo(db)
    const now = new Date('2026-07-21T12:05:00.000Z')
    await reports.insert({
      orgId: 'org-1',
      period: currentTrafficPeriod(now),
      source: 'object_download',
      sourceId: 'matter-1',
      eventId: 'traffic-activity-mismatch',
      bytes: 128,
      storageId: 'storage-1',
      unitBytes: null,
      creditsPerUnit: null,
      status: 'not_required',
      now,
    })
    await reports.markIssued('traffic-activity-mismatch', now)
    await expect(reports.markIssued('traffic-does-not-exist', now)).rejects.toThrow('traffic_report_not_found')
    const rows = await db.all<{ issuedAt: number | null; events: number }>(sql`
      SELECT issued_at AS issuedAt,
        (SELECT COUNT(*) FROM audit_events WHERE id LIKE 'event:download_issued:traffic-%') AS events
      FROM cloud_traffic_reports
      WHERE event_id = 'traffic-activity-mismatch'
    `)
    expect(rows).toEqual([{ issuedAt: now.getTime(), events: 0 }])
  })

  it('establishes an exact storage boundary and detects any later unledgered mutation', async () => {
    const { db } = await createTestApp()
    const opening = await ensureAdminStatsIntegrityOpening(db, new Date('2026-07-21T12:00:00.000Z'))
    const createdAtMs = new Date('2026-07-21T12:05:00.000Z').getTime()
    const createdAtSec = Math.floor(createdAtMs / 1000)
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
      VALUES ('storage-org', 'Storage Org', 'storage-org', '{"type":"team"}', ${createdAtMs}, ${createdAtMs})
    `)
    await db.run(sql`
      INSERT INTO matters (
        id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at
      ) VALUES (
        'storage-matter', 'storage-org', 'storage-matter', 'file.bin', 'application/octet-stream',
        10, 0, '', 'file.bin', 'storage-1', 'active', ${createdAtSec}, ${createdAtSec}
      )
    `)
    await ensureStorageUsageOpeningBalances(db, opening)
    await ensureStorageUsageIntegrityOpeningBalances(db, opening)

    const exact = await inspectAdminStatsSourceIntegrity(db, opening)
    expect(exact.storageLedgerDriftSpaces).toBe(0)
    expect(exact.storageLedgerDriftBytes).toBe(0)

    await db.run(sql`UPDATE matters SET size = 15 WHERE id = 'storage-matter'`)
    const broken = await inspectAdminStatsSourceIntegrity(db, opening)
    expect(broken.storageLedgerDriftSpaces).toBe(1)
    expect(broken.storageLedgerDriftBytes).toBe(5)
    expect(() => assertAdminStatsSourceIntegrity(broken)).toThrow('admin_stats_source_integrity_failed')
  })

  it('detects malformed authoritative sources after the opening', async () => {
    const { db } = await createTestApp()
    const opening = await ensureAdminStatsIntegrityOpening(db, new Date('2026-07-21T12:00:00.000Z'))
    const createdAtMs = new Date('2026-07-21T12:10:00.000Z').getTime()
    const createdAtSec = Math.floor(createdAtMs / 1000)
    await db.run(sql`
      INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('missing-signup-user', 'Missing Signup', 'missing-signup@example.com', 1, ${createdAtMs}, ${createdAtMs})
    `)
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
      VALUES ('org-1', 'Integrity Org', 'integrity-org', '{"type":"team"}', ${createdAtMs}, ${createdAtMs})
    `)
    await db.run(sql`
      INSERT INTO matters (
        id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at
      ) VALUES (
        'matter-1', 'org-1', 'matter-1', 'file.txt', 'text/plain', 10, 0, '', 'file.txt',
        'storage-1', 'active', ${createdAtSec}, ${createdAtSec}
      )
    `)
    await db.run(sql`
      INSERT INTO shares (
        id, token, kind, matter_id, org_id, creator_id, views, downloads, status, created_at
      ) VALUES (
        'missing-share-fact', 'missing-share-token', 'landing', 'matter-1', 'org-1',
        'missing-signup-user', 0, 0, 'active', ${createdAtSec}
      )
    `)
    await db.run(sql`
      INSERT INTO cloud_traffic_reports (
        id, org_id, period, source, source_id, event_id, bytes, status, issued_at, created_at, updated_at
      ) VALUES (
        'report-without-event', 'org-1', '2026-07', 'unknown', 'matter-1',
        'traffic-without-event', 10, 'not_required', ${createdAtMs}, ${createdAtMs}, ${createdAtMs}
      )
    `)
    await db.run(sql`
      INSERT INTO background_jobs (
        id, org_id, user_id, type, status, retryable, cancelable, created_at, updated_at, finished_at
      ) VALUES (
        'job-without-fact', 'org-1', 'missing-signup-user', 'archive', 'failed', 0, 0,
        ${createdAtMs}, ${createdAtMs}, NULL
      )
    `)
    await db.run(sql`
      INSERT INTO download_tasks (
        id, org_id, created_by_user_id, source_type, source_uri, target_folder, tags, status,
        created_at, updated_at, finished_at
      ) VALUES (
        'task-without-fact', 'org-1', 'missing-signup-user', 'http', 'https://example.com/file', '', '[]',
        'completed', ${createdAtMs}, ${createdAtMs}, ${createdAtMs}
      )
    `)
    await db.run(sql`UPDATE download_tasks SET events = '[{}]' WHERE id = 'task-without-fact'`)
    await db.run(sql`
      INSERT INTO audit_events (
        id, org_id, user_id, actor_type, action, target_type, target_id, target_name, metadata, created_at
      ) VALUES
        ('invalid-upload', 'org-1', 'missing-signup-user', 'user', 'upload_confirm',
          'file', 'matter-2', 'broken.txt', '{}', ${createdAtSec})
    `)

    const integrity = await inspectAdminStatsSourceIntegrity(db, opening)

    expect(integrity).toMatchObject({
      missingDownloadTaskTerminalEvents: 1,
      invalidDownloadTaskEvents: 1,
      backgroundJobsMissingFinishedAt: 1,
      invalidIssuedTrafficReports: 1,
      invalidAuditEvents: 1,
      storageLedgerDriftSpaces: 1,
      storageLedgerDriftBytes: 10,
    })
    expect(() => assertAdminStatsSourceIntegrity(integrity)).toThrow('admin_stats_source_integrity_failed')
  })
})
