import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { enumParam, numberOptionParam, pageParam, textParam } from './list-search'

const schema = z.object({
  q: textParam,
  page: pageParam,
  size: numberOptionParam([20, 50, 100]),
  filter: enumParam(['active', 'failed']),
})

describe('list search params', () => {
  it('reads usable values from the URL', () => {
    expect(schema.parse({ q: 'ali', page: 3, size: '50', filter: 'failed' })).toEqual({
      q: 'ali',
      page: 3,
      size: 50,
      filter: 'failed',
    })
  })

  it('reads a numeric search as the text typed', () => {
    expect(schema.parse({ q: 123 }).q).toBe('123')
  })

  it('ignores values the list cannot use [spec: list-state/unusable-values]', () => {
    expect(schema.parse({ q: '', page: 'two', size: 30, filter: 'paused' })).toEqual({
      q: undefined,
      page: undefined,
      size: undefined,
      filter: undefined,
    })
    expect(schema.parse({ page: 0 }).page).toBeUndefined()
    expect(schema.parse({ page: 1.5 }).page).toBeUndefined()
    expect(schema.parse({ q: { nested: true } }).q).toBeUndefined()
  })
})
