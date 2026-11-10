import { describe, expect, it } from 'vitest'
import { chunk } from './chunk'

describe('chunk', () => {
  it('splits items into runs of at most the given size, keeping order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([1, 2], 2)).toEqual([[1, 2]])
    expect(chunk([], 2)).toEqual([])
  })
})
