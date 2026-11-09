export type ClientPlatform = 'windows' | 'macos' | 'ios' | 'android' | 'linux'

export interface ExternalPlayer {
  id: string
  name: string
  platforms: readonly ClientPlatform[]
  buildUrl: (mediaUrl: string) => string
}

function androidIntent(mediaUrl: string, packageName: string): string {
  const url = new URL(mediaUrl)
  const scheme = url.protocol.slice(0, -1)
  const rest = mediaUrl.slice(url.protocol.length + 2)
  return `intent://${rest}#Intent;scheme=${scheme};type=video/*;package=${packageName};end`
}

export const EXTERNAL_PLAYERS: readonly ExternalPlayer[] = [
  {
    id: 'potplayer',
    name: 'PotPlayer',
    platforms: ['windows'],
    buildUrl: (u) => `potplayer://${u}`,
  },
  {
    id: 'iina',
    name: 'IINA',
    platforms: ['macos'],
    buildUrl: (u) => `iina://weblink?url=${encodeURIComponent(u)}`,
  },
  {
    id: 'vlc',
    name: 'VLC',
    platforms: ['windows', 'macos', 'linux'],
    buildUrl: (u) => `vlc://${u}`,
  },
  {
    id: 'vlc-ios',
    name: 'VLC',
    platforms: ['ios'],
    buildUrl: (u) => `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(u)}`,
  },
  {
    id: 'vlc-android',
    name: 'VLC',
    platforms: ['android'],
    buildUrl: (u) => androidIntent(u, 'org.videolan.vlc'),
  },
  {
    id: 'infuse',
    name: 'Infuse',
    platforms: ['macos', 'ios'],
    buildUrl: (u) => `infuse://x-callback-url/play?url=${encodeURIComponent(u)}`,
  },
  {
    id: 'nplayer',
    name: 'nPlayer',
    platforms: ['ios'],
    buildUrl: (u) => `nplayer-${u}`,
  },
  {
    id: 'mxplayer',
    name: 'MX Player',
    platforms: ['android'],
    buildUrl: (u) => androidIntent(u, 'com.mxtech.videoplayer.ad'),
  },
]

export function detectPlatform(userAgent: string, maxTouchPoints: number): ClientPlatform {
  if (/android/i.test(userAgent)) return 'android'
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios'
  // iPadOS reports a desktop Mac user agent; touch support tells them apart.
  if (/macintosh|mac os x/i.test(userAgent)) return maxTouchPoints > 1 ? 'ios' : 'macos'
  if (/windows/i.test(userAgent)) return 'windows'
  return 'linux'
}

export function playersForPlatform(platform: ClientPlatform): ExternalPlayer[] {
  return EXTERNAL_PLAYERS.filter((player) => player.platforms.includes(platform))
}
