import type { Database } from '../platform/interface'

export type AtomicQuery = {
  all?: () => unknown
  run?: () => unknown
}

type RowsQuery<T> = PromiseLike<T[]> | { all(): T[] }

export async function executeRows<T>(query: RowsQuery<T>): Promise<T[]> {
  if (typeof (query as PromiseLike<T[]>).then === 'function') return await (query as PromiseLike<T[]>)
  return (query as { all(): T[] }).all()
}

function isSyncDatabase(db: Database): boolean {
  return db.constructor.name === 'BetterSQLite3Database'
}

export async function executeWriteTransaction(db: Database, queries: AtomicQuery[]): Promise<void> {
  const batch = (db as unknown as { batch?: (queries: AtomicQuery[]) => Promise<unknown[]> }).batch
  if (batch) {
    await batch.call(db, queries)
    return
  }

  if (!isSyncDatabase(db)) throw new Error('db_transaction_unavailable')

  ;(db as unknown as { transaction<T>(fn: () => T): T }).transaction(() => {
    for (const query of queries) {
      if (query.run) {
        query.run()
        continue
      }
      query.all?.()
    }
  })
}
