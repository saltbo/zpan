const DEFAULT_AUTH_CALLBACK_PATH = '/files'

export function absoluteAuthCallbackURL(callbackURL: string, origin: string): string {
  const fallback = new URL(DEFAULT_AUTH_CALLBACK_PATH, origin).toString()
  try {
    const resolved = new URL(callbackURL, origin)
    return resolved.origin === new URL(origin).origin ? resolved.toString() : fallback
  } catch {
    return fallback
  }
}
