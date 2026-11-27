import { describe, expect, it } from 'vitest'
import { BencodeError, bencodeText, decodeBencode, encodeBencode, isBencodeDict } from './bencode'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('decodeBencode', () => {
  it('decodes integers, strings, lists, and dictionaries', () => {
    const value = decodeBencode(bytes('d3:agei42e4:listli-1ei0ee4:name4:spame'))
    expect(isBencodeDict(value)).toBe(true)
    if (!isBencodeDict(value)) return
    expect(value.age).toBe(42)
    expect(value.list).toEqual([-1, 0])
    expect(bencodeText(value.name)).toBe('spam')
  })

  it('keeps byte strings as bytes, including non-UTF-8 ones', () => {
    const raw = new Uint8Array([0x33, 0x3a, 0xff, 0x00, 0x80])
    expect(decodeBencode(raw)).toEqual(new Uint8Array([0xff, 0x00, 0x80]))
    expect(bencodeText(new Uint8Array([0xff]))).toBeNull()
  })

  it('round-trips through encodeBencode', () => {
    const encoded = encodeBencode({ b: [1, 'x'], a: new Uint8Array([1, 2]) })
    expect(new TextDecoder().decode(encoded)).toBe('d1:a2:\u0001\u00021:bli1e1:xee')
    expect(encodeBencode(decodeBencode(encoded))).toEqual(encoded)
  })

  it.each([
    ['trailing bytes', 'i1ei2e'],
    ['leading zero', 'i01e'],
    ['negative zero', 'i-0e'],
    ['unterminated integer', 'i12'],
    ['unterminated list', 'li1e'],
    ['unterminated dictionary', 'd1:ai1e'],
    ['string past the end', '5:abc'],
    ['unsorted keys', 'd1:bi1e1:ai2ee'],
    ['duplicate keys', 'd1:ai1e1:ai2ee'],
    ['unexpected byte', 'x'],
    ['negative length', '-1:a'],
    ['empty input', ''],
  ])('rejects %s', (_case, input) => {
    expect(() => decodeBencode(bytes(input))).toThrow(BencodeError)
  })

  it('rejects integers beyond the safe range and absurdly long lengths', () => {
    expect(() => decodeBencode(bytes('i99999999999999999999e'))).toThrow(BencodeError)
    expect(() => decodeBencode(bytes(`${'9'.repeat(30)}:a`))).toThrow(BencodeError)
  })

  it('rejects nesting deeper than the limit', () => {
    expect(() => decodeBencode(bytes(`${'l'.repeat(100)}${'e'.repeat(100)}`))).toThrow(BencodeError)
  })
})
