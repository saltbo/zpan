import { describe, expect, it } from 'vitest'
import { isLocalNetworkOrigin } from './local-origin'

describe('isLocalNetworkOrigin', () => {
  it.each([
    'http://localhost:5185',
    'http://app.localhost:3000',
    'http://127.0.0.1:5185',
    'http://127.8.8.8',
    'http://[::1]:5185',
    'http://10.0.0.5:8080',
    'http://172.16.0.1',
    'http://172.31.255.254:443',
    'http://192.168.1.100:5185',
    'https://192.168.1.100',
  ])('trusts %s', (origin) => {
    expect(isLocalNetworkOrigin(origin)).toBe(true)
  })

  it.each([
    'http://example.com',
    'https://zpan.example.com',
    'http://11.0.0.1', // public, adjacent to 10/8
    'http://172.32.0.1', // outside 172.16/12
    'http://192.169.0.1', // outside 192.168/16
    'http://10.evil.com', // domain that merely starts with a private prefix
    'http://192.168.1.1.evil.com',
    'ftp://127.0.0.1', // non-http(s) scheme
    'null',
    'not a url',
    '',
  ])('rejects %s', (origin) => {
    expect(isLocalNetworkOrigin(origin)).toBe(false)
  })
})
