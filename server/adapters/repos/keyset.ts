import { and, type Column, eq, lt, or, type SQL } from 'drizzle-orm'
import type { CreatedAtIdBoundary } from '../../usecases/ports'

// Rows strictly after `after` in (createdAt desc, id desc) order.
export function afterCreatedAtId(
  createdAt: Column,
  id: Column,
  after: CreatedAtIdBoundary | undefined,
): SQL | undefined {
  if (!after) return undefined
  return or(lt(createdAt, after.createdAt), and(eq(createdAt, after.createdAt), lt(id, after.id)))
}

// Repositories fetch pageSize + 1 rows; the extra row only signals that another page exists.
export function keysetPage<T, B>(rows: T[], pageSize: number, boundary: (row: T) => B): { rows: T[]; next: B | null } {
  if (rows.length <= pageSize) return { rows, next: null }
  const page = rows.slice(0, pageSize)
  return { rows: page, next: boundary(page[pageSize - 1]) }
}
