import { afterEach, describe, expect, it } from 'vitest'
import { menuDirection } from './document-direction'

describe('menuDirection', () => {
  afterEach(() => {
    document.documentElement.dir = 'ltr'
  })

  it('follows the document direction so Radix submenus open on the correct side', () => {
    document.documentElement.dir = 'rtl'
    expect(menuDirection()).toBe('rtl')

    document.documentElement.dir = 'ltr'
    expect(menuDirection()).toBe('ltr')
  })
})
