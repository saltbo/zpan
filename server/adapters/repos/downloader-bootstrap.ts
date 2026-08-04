import { generateId } from '@shared/ids'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { downloaderBootstrapCredential, session } from '../../db/auth-schema'
import { downloaders } from '../../db/schema'
import { executeRows, executeWriteTransactionWithResults } from '../../db/transaction'
import { LEGACY_DOWNLOADER_CLIENT_ID, LEGACY_DOWNLOADER_REGISTER_SCOPE } from '../../domain/legacy-downloader-bootstrap'
import type { Database } from '../../platform/interface'
import type { DownloaderBootstrapCredentialRepo, DownloadTokenGateway } from '../../usecases/ports'
import { downloaderInsertValues } from './downloader'

export function createDownloaderBootstrapCredentialRepo(
  db: Database,
  tokens: Pick<DownloadTokenGateway, 'hashDownloadToken'>,
): DownloaderBootstrapCredentialRepo {
  return {
    async issue(input) {
      await db.insert(downloaderBootstrapCredential).values({
        id: generateId(),
        tokenHash: await tokens.hashDownloadToken(input.platform, input.token),
        userId: input.userId,
        deviceCode: input.deviceCode,
        clientId: LEGACY_DOWNLOADER_CLIENT_ID,
        scope: LEGACY_DOWNLOADER_REGISTER_SCOPE,
        expiresAt: input.expiresAt,
        createdAt: new Date(),
      })
    },

    async resolve(platform, token, now) {
      const tokenHash = await tokens.hashDownloadToken(platform, token)
      const [row] = await db
        .select({
          userId: downloaderBootstrapCredential.userId,
          clientId: downloaderBootstrapCredential.clientId,
          scope: downloaderBootstrapCredential.scope,
          expiresAt: downloaderBootstrapCredential.expiresAt,
          consumedAt: downloaderBootstrapCredential.consumedAt,
        })
        .from(downloaderBootstrapCredential)
        .where(
          and(
            eq(downloaderBootstrapCredential.tokenHash, tokenHash),
            eq(downloaderBootstrapCredential.clientId, LEGACY_DOWNLOADER_CLIENT_ID),
            eq(downloaderBootstrapCredential.scope, LEGACY_DOWNLOADER_REGISTER_SCOPE),
          ),
        )
        .limit(1)
      if (!row) return null
      return {
        userId: row.userId,
        clientId: LEGACY_DOWNLOADER_CLIENT_ID,
        scope: LEGACY_DOWNLOADER_REGISTER_SCOPE,
        active: row.consumedAt === null && row.expiresAt > now,
      }
    },

    async consume(platform, token, now) {
      const tokenHash = await tokens.hashDownloadToken(platform, token)
      const [row] = await executeRows<{ userId: string }>({
        all: () =>
          consumeBootstrapQuery(db, tokenHash, now)
            .returning({
              userId: downloaderBootstrapCredential.userId,
            })
            .all(),
      })
      if (!row) return null
      return {
        userId: row.userId,
        clientId: LEGACY_DOWNLOADER_CLIENT_ID,
        scope: LEGACY_DOWNLOADER_REGISTER_SCOPE,
        active: false,
      }
    },

    async registerDownloader(input) {
      const tokenHash = await tokens.hashDownloadToken(input.platform, input.token)
      const consumeBootstrap = {
        all: () =>
          consumeBootstrapQuery(db, tokenHash, input.now)
            .returning({
              userId: downloaderBootstrapCredential.userId,
            })
            .all(),
      }
      const insertDownloader = conditionalDownloaderInsertQuery(db, input.downloader, tokenHash)
      const deleteBootstrapSession = db.delete(session).where(eq(session.token, input.token))
      const [, consumeResult] = await executeWriteTransactionWithResults(
        db,
        [insertDownloader, consumeBootstrap, deleteBootstrapSession],
        [1],
      )
      return Array.isArray(consumeResult) && consumeResult.length === 1
    },
  }
}

function consumeBootstrapQuery(db: Database, tokenHash: string, now: Date) {
  return db
    .update(downloaderBootstrapCredential)
    .set({ consumedAt: now })
    .where(
      and(
        eq(downloaderBootstrapCredential.tokenHash, tokenHash),
        eq(downloaderBootstrapCredential.clientId, LEGACY_DOWNLOADER_CLIENT_ID),
        eq(downloaderBootstrapCredential.scope, LEGACY_DOWNLOADER_REGISTER_SCOPE),
        isNull(downloaderBootstrapCredential.consumedAt),
        gt(downloaderBootstrapCredential.expiresAt, now),
      ),
    )
}

function conditionalDownloaderInsertQuery(
  db: Database,
  input: Parameters<typeof downloaderInsertValues>[0],
  tokenHash: string,
) {
  const values = downloaderInsertValues(input)
  return db.insert(downloaders).select(sql`
    SELECT
      ${values.id},
      ${values.name},
      ${values.tokenHash},
      ${values.tokenJti},
      ${values.status},
      ${values.enabled ? 1 : 0},
      ${values.version},
      ${values.hostname},
      ${values.platform},
      ${values.arch},
      ${values.engine},
      ${values.capabilities},
      ${values.maxConcurrentTasks},
      ${values.currentTasks},
      ${values.downloadBps},
      ${values.uploadBps},
      ${values.freeDiskBytes},
      ${values.remoteDownloadCreditBillingEnabled ? 1 : 0},
      ${values.remoteDownloadCreditUnitBytes},
      ${values.remoteDownloadCreditPerUnit},
      ${values.lastHeartbeatAt},
      ${values.createdBy},
      ${values.createdAt.getTime()},
      ${values.updatedAt.getTime()}
    WHERE EXISTS (
      SELECT 1
      FROM ${downloaderBootstrapCredential}
      WHERE ${downloaderBootstrapCredential.tokenHash} = ${tokenHash}
        AND ${downloaderBootstrapCredential.clientId} = ${LEGACY_DOWNLOADER_CLIENT_ID}
        AND ${downloaderBootstrapCredential.scope} = ${LEGACY_DOWNLOADER_REGISTER_SCOPE}
        AND ${downloaderBootstrapCredential.consumedAt} IS NULL
        AND ${downloaderBootstrapCredential.expiresAt} > ${input.now.getTime()}
    )
  `)
}
