import { describe, expect, it } from 'vitest'
import { keysetPage } from './keyset'

describe('keysetPage', () => {
  const boundary = (row: { id: string }) => ({ id: row.id })

  it('returns every row and no boundary when the rows fit in the page', () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    expect(keysetPage(rows, 3, boundary)).toEqual({ rows, next: null })
  })

  it('returns no boundary when the page is exactly full', () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    expect(keysetPage(rows, 2, boundary)).toEqual({ rows, next: null })
  })

  it('drops the look-ahead row and bounds at the last visible row', () => {
    const page = keysetPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, boundary)
    expect(page.rows).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(page.next).toEqual({ id: 'b' })
  })

  it('handles an empty result', () => {
    expect(keysetPage([], 5, boundary)).toEqual({ rows: [], next: null })
  })
})
