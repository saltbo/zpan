import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'

const INSTANCE_ID_KEY = 'instance_id'

export async function getOrCreateInstanceId(db: Database): Promise<string> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, INSTANCE_ID_KEY))
    .limit(1)

  if (rows[0]?.value) return rows[0].value

  const id = nanoid(21)
  await db
    .insert(systemOptions)
    .values({ key: INSTANCE_ID_KEY, value: id, public: false })
    .onConflictDoUpdate({ target: systemOptions.key, set: { value: id } })

  return id
}
