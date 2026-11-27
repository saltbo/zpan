// A repository's keyset page: the visible rows and, when another row exists,
// the last visible row's sort key. HTTP handlers turn the boundary into a page token.
export type CreatedAtIdBoundary = { createdAt: Date; id: string }

export interface KeysetPageOpts<B = CreatedAtIdBoundary> {
  pageSize: number
  after?: B
}

export interface KeysetPage<T, B = CreatedAtIdBoundary> {
  items: T[]
  nextBoundary: B | null
}
