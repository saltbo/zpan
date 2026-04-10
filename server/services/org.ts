import { sql } from 'drizzle-orm'
import type { Database } from '../platform/interface'

export async function findPersonalOrg(db: Database, userId: string): Promise<string | null> {
  const rows = await db.all<{ org_id: string }>(sql`
    SELECT m.organization_id AS org_id
    FROM member m
    INNER JOIN organization o ON o.id = m.organization_id
    WHERE m.user_id = ${userId}
      AND o.metadata LIKE '%"type":"personal"%'
    LIMIT 1
  `)

  return rows[0]?.org_id ?? null
}
