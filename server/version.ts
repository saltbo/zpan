declare global {
  var __ZPAN_APP_VERSION__: string | undefined
}

export function getAppVersion(): string {
  if (!globalThis.__ZPAN_APP_VERSION__) {
    throw new Error('__ZPAN_APP_VERSION__ is not configured')
  }
  return globalThis.__ZPAN_APP_VERSION__
}
