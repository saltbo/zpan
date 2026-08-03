import { describe, expect, it } from 'vitest'
import { isBlockedUrlHost, isSafeHttpUrl } from './url-safety'

describe('isBlockedUrlHost', () => {
  it('blocks loopback and localhost names', () => {
    expect(isBlockedUrlHost('localhost')).toBe(true)
    expect(isBlockedUrlHost('foo.localhost')).toBe(true)
    expect(isBlockedUrlHost('127.0.0.1')).toBe(true)
    expect(isBlockedUrlHost('127.5.5.5')).toBe(true)
  })

  it('blocks the cloud metadata endpoint and link-local range', () => {
    expect(isBlockedUrlHost('169.254.169.254')).toBe(true)
    expect(isBlockedUrlHost('169.254.0.1')).toBe(true)
  })

  it('blocks RFC 1918, CGNAT, and 0.0.0.0', () => {
    expect(isBlockedUrlHost('10.0.0.1')).toBe(true)
    expect(isBlockedUrlHost('172.16.0.1')).toBe(true)
    expect(isBlockedUrlHost('172.31.255.255')).toBe(true)
    expect(isBlockedUrlHost('192.168.1.1')).toBe(true)
    expect(isBlockedUrlHost('100.64.0.1')).toBe(true)
    expect(isBlockedUrlHost('0.0.0.0')).toBe(true)
  })

  it('blocks IPv6 loopback, ULA, link-local, and mapped v4', () => {
    expect(isBlockedUrlHost('[::1]')).toBe(true)
    expect(isBlockedUrlHost('::1')).toBe(true)
    expect(isBlockedUrlHost('fd00::1')).toBe(true)
    expect(isBlockedUrlHost('fe80::1')).toBe(true)
    expect(isBlockedUrlHost('[::ffff:127.0.0.1]')).toBe(true)
  })

  it('blocks IPv6 transition addresses that embed private IPv4 destinations', () => {
    expect(isBlockedUrlHost('2002:7f00:1::')).toBe(true)
    expect(isBlockedUrlHost('2002:a9fe:a9fe::')).toBe(true)
    expect(isBlockedUrlHost('64:ff9b::c0a8:101')).toBe(true)
    expect(isBlockedUrlHost('2001:0:4136:e378:8000:63bf:5601:5601')).toBe(true)
    expect(isBlockedUrlHost('::ffff:0:a9fe:a9fe')).toBe(true)
    expect(isBlockedUrlHost('::a9fe:a9fe')).toBe(true)
  })

  it('allows transition addresses that embed public IPv4 destinations', () => {
    expect(isBlockedUrlHost('2002:808:808::')).toBe(false)
    expect(isBlockedUrlHost('64:ff9b::808:808')).toBe(false)
    expect(isBlockedUrlHost('2001:0:4136:e378:8000:63bf:f7f7:f7f7')).toBe(false)
    expect(isBlockedUrlHost('::ffff:808:808')).toBe(false)
  })

  it('allows public hosts', () => {
    expect(isBlockedUrlHost('example.com')).toBe(false)
    expect(isBlockedUrlHost('8.8.8.8')).toBe(false)
    expect(isBlockedUrlHost('172.32.0.1')).toBe(false)
    expect(isBlockedUrlHost('173.16.0.1')).toBe(false)
    expect(isBlockedUrlHost('[2001:db8::1]')).toBe(false) // public IPv6
  })

  it('treats malformed IPv4 (octet > 255) as a non-IP host', () => {
    expect(isBlockedUrlHost('256.1.1.1')).toBe(false)
    expect(isBlockedUrlHost('999.0.0.1')).toBe(false)
  })
})

describe('isSafeHttpUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(isSafeHttpUrl('https://example.com/file.zip')).toBe(true)
    expect(isSafeHttpUrl('http://203.0.113.5/a.iso')).toBe(true)
  })

  it('rejects non-http schemes', () => {
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeHttpUrl('gopher://example.com')).toBe(false)
    expect(isSafeHttpUrl('dict://127.0.0.1:11211')).toBe(false)
    expect(isSafeHttpUrl('ftp://example.com/x')).toBe(false)
  })

  it('rejects internal hosts', () => {
    expect(isSafeHttpUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isSafeHttpUrl('http://localhost:8080/admin')).toBe(false)
    expect(isSafeHttpUrl('http://10.0.0.5/')).toBe(false)
    expect(isSafeHttpUrl('http://[::1]/')).toBe(false)
    expect(isSafeHttpUrl('http://[2002:a9fe:a9fe::]/latest/meta-data/')).toBe(false)
    expect(isSafeHttpUrl('http://[64:ff9b::a9fe:a9fe]/latest/meta-data/')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isSafeHttpUrl('not a url')).toBe(false)
    expect(isSafeHttpUrl('')).toBe(false)
  })
})
