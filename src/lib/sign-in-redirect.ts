const OAUTH_AUTHORIZE_PATH = '/api/auth/oauth2/authorize'
const SIGN_IN_REDIRECT_STORAGE_KEY = 'zpan.sign-in.redirect'

interface SignInRedirectStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export function loadSignInRedirect(search: string, origin: string, storage: SignInRedirectStorage): string | null {
  const redirect = resolveSignInRedirect(search, origin)
  if (redirect) {
    storage.setItem(SIGN_IN_REDIRECT_STORAGE_KEY, redirect)
    return redirect
  }

  const stored = storage.getItem(SIGN_IN_REDIRECT_STORAGE_KEY)
  if (!stored) return null

  try {
    const parsed = new URL(stored, origin)
    if (parsed.origin !== origin) {
      storage.removeItem(SIGN_IN_REDIRECT_STORAGE_KEY)
      return null
    }
    return parsed.pathname + parsed.search + parsed.hash
  } catch {
    storage.removeItem(SIGN_IN_REDIRECT_STORAGE_KEY)
    return null
  }
}

export function clearSignInRedirect(storage: SignInRedirectStorage): void {
  storage.removeItem(SIGN_IN_REDIRECT_STORAGE_KEY)
}

export function resolveSignInRedirect(search: string, origin: string): string | null {
  const rawSearch = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(rawSearch)
  const explicitRedirect = params.get('redirect')

  if (explicitRedirect) {
    try {
      const parsed = new URL(explicitRedirect, origin)
      if (parsed.origin !== origin) return null
      return parsed.pathname + parsed.search + parsed.hash
    } catch {
      return null
    }
  }

  if (!isOAuthAuthorizationContinuation(params)) return null

  // Better Auth signs the authorization query before redirecting an
  // unauthenticated user here. Preserve the exact bytes and parameter order.
  return `${OAUTH_AUTHORIZE_PATH}?${rawSearch}`
}

function isOAuthAuthorizationContinuation(params: URLSearchParams): boolean {
  return (
    params.get('response_type') === 'code' &&
    params.has('client_id') &&
    params.has('redirect_uri') &&
    params.has('state') &&
    params.has('code_challenge') &&
    params.get('code_challenge_method') === 'S256' &&
    params.has('sig')
  )
}
