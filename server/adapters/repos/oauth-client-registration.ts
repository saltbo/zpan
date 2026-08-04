import { generateId } from '@shared/ids'
import { and, eq } from 'drizzle-orm'
import { oauthClient, oauthClientRegistration, oauthClientResource, oauthResource } from '../../db/auth-schema'
import { executeWriteTransaction } from '../../db/transaction'
import type { Database } from '../../platform/interface'

export type ManagedOAuthClient = typeof oauthClient.$inferSelect
export type ManagedOAuthClientUpdate = Partial<typeof oauthClient.$inferInsert>

export async function insertOAuthClientRegistration(db: Database, clientId: string, tokenHash: string): Promise<void> {
  await db.insert(oauthClientRegistration).values({ clientId, tokenHash })
}

export async function findManagedOAuthClient(
  db: Database,
  clientId: string,
  tokenHash: string,
): Promise<ManagedOAuthClient | null> {
  const [row] = await db
    .select({ client: oauthClient })
    .from(oauthClientRegistration)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthClientRegistration.clientId))
    .where(and(eq(oauthClientRegistration.clientId, clientId), eq(oauthClientRegistration.tokenHash, tokenHash)))
    .limit(1)
  return row?.client ?? null
}

export async function getManagedOAuthClient(db: Database, clientId: string): Promise<ManagedOAuthClient | null> {
  const [client] = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1)
  return client ?? null
}

export async function deleteManagedOAuthClient(db: Database, clientId: string): Promise<void> {
  await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId))
}

export async function isOAuthResourceAvailable(db: Database, resourceId: string): Promise<boolean> {
  const [resource] = await db
    .select({ disabled: oauthResource.disabled })
    .from(oauthResource)
    .where(eq(oauthResource.identifier, resourceId))
    .limit(1)
  return Boolean(resource && !resource.disabled)
}

export async function replaceManagedOAuthClient(
  db: Database,
  clientId: string,
  update: ManagedOAuthClientUpdate,
  resourceIds: string[],
): Promise<void> {
  const resourceQueries = resourceIds.map((resourceId) =>
    db.insert(oauthClientResource).values({
      id: generateId(),
      clientId,
      resourceId,
    }),
  )
  await executeWriteTransaction(db, [
    db.update(oauthClient).set(update).where(eq(oauthClient.clientId, clientId)),
    db.delete(oauthClientResource).where(eq(oauthClientResource.clientId, clientId)),
    ...resourceQueries,
  ])
}

export async function listManagedOAuthClientResources(db: Database, clientId: string): Promise<string[]> {
  const rows = await db
    .select({ resourceId: oauthClientResource.resourceId })
    .from(oauthClientResource)
    .where(eq(oauthClientResource.clientId, clientId))
  return rows.map((row) => row.resourceId)
}
