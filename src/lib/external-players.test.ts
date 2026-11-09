import { describe, expect, it } from 'vitest'
import { detectPlatform, EXTERNAL_PLAYERS, playersForPlatform } from './external-players'

const MEDIA_URL = 'https://s3.example.com/bucket/movie.mkv?X-Amz-Signature=abc&X-Amz-Expires=3600'

function player(id: string) {
  const found = EXTERNAL_PLAYERS.find((p) => p.id === id)
  if (!found) throw new Error(`missing player ${id}`)
  return found
}

describe('detectPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0', 0, 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 0, 'macos'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 5, 'ios'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 5, 'ios'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile', 5, 'android'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0', 0, 'linux'],
  ] as const)('%s (touch %d) → %s', (ua, touch, expected) => {
    expect(detectPlatform(ua, touch)).toBe(expected)
  })
})

describe('playersForPlatform', () => {
  it('offers platform-native players only', () => {
    expect(playersForPlatform('windows').map((p) => p.id)).toEqual(['potplayer', 'vlc'])
    expect(playersForPlatform('macos').map((p) => p.id)).toEqual(['iina', 'vlc', 'infuse'])
    expect(playersForPlatform('ios').map((p) => p.id)).toEqual(['vlc-ios', 'infuse', 'nplayer'])
    expect(playersForPlatform('android').map((p) => p.id)).toEqual(['vlc-android', 'mxplayer'])
    expect(playersForPlatform('linux').map((p) => p.id)).toEqual(['vlc'])
  })
})

describe('player URLs', () => {
  it('prefixes the raw URL for schemes that take it verbatim', () => {
    expect(player('potplayer').buildUrl(MEDIA_URL)).toBe(`potplayer://${MEDIA_URL}`)
    expect(player('vlc').buildUrl(MEDIA_URL)).toBe(`vlc://${MEDIA_URL}`)
    expect(player('nplayer').buildUrl(MEDIA_URL)).toBe(`nplayer-${MEDIA_URL}`)
  })

  it('encodes the URL for x-callback style schemes so the signature survives', () => {
    const encoded = encodeURIComponent(MEDIA_URL)
    expect(player('iina').buildUrl(MEDIA_URL)).toBe(`iina://weblink?url=${encoded}`)
    expect(player('vlc-ios').buildUrl(MEDIA_URL)).toBe(`vlc-x-callback://x-callback-url/stream?url=${encoded}`)
    expect(player('infuse').buildUrl(MEDIA_URL)).toBe(`infuse://x-callback-url/play?url=${encoded}`)
  })

  it('builds Android intents that keep the original scheme', () => {
    const rest = 's3.example.com/bucket/movie.mkv?X-Amz-Signature=abc&X-Amz-Expires=3600'
    expect(player('vlc-android').buildUrl(MEDIA_URL)).toBe(
      `intent://${rest}#Intent;scheme=https;type=video/*;package=org.videolan.vlc;end`,
    )
    expect(player('mxplayer').buildUrl('http://localhost:8787/x.mp4')).toBe(
      'intent://localhost:8787/x.mp4#Intent;scheme=http;type=video/*;package=com.mxtech.videoplayer.ad;end',
    )
  })
})
