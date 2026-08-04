import { describe, expect, it } from 'vitest'
import { findDefaultNanoidCalls } from './lint-id-generation.mjs'

describe('ID generation lint', () => {
  it('rejects direct default Nano ID calls across whitespace', () => {
    expect(findDefaultNanoidCalls("const id = nanoid()\nconst token = nanoid\n  (32)\n")).toEqual([
      { line: 1, source: 'const id = nanoid()' },
      { line: 2, source: 'const token = nanoid' },
    ])
  })

  it('rejects aliased and namespace imports of the default generator', () => {
    expect(
      findDefaultNanoidCalls(
        "import { nanoid as makeId } from 'nanoid'\nimport * as nano from 'nanoid'\nmakeId()\nnano.nanoid()\n",
      ),
    ).toEqual([
      { line: 3, source: 'makeId()' },
      { line: 4, source: 'nano.nanoid()' },
    ])
  })

  it('allows the central Base62 generator and custom alphabets', () => {
    expect(findDefaultNanoidCalls("const id = generateId()\nconst slug = customAlphabet('abc')()\n")).toEqual([])
  })
})
