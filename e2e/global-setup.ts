/**
 * Playwright global setup — runs once before all test files.
 * Registers the first user (auto-promoted to admin) and seeds
 * a storage backend so folder creation works in CI without S3.
 */
async function globalSetup() {
  const baseURL = 'http://localhost:5173'

  // Register first user → becomes admin
  const signUp = await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'E2E Admin',
      email: 'e2e-admin@test.local',
      password: 'password123456',
    }),
  })
  if (!signUp.ok) {
    // User might already exist from a previous run (reused server)
    const body = await signUp.text()
    if (!body.includes('already') && !body.includes('exists')) {
      console.warn(`[global-setup] sign-up returned ${signUp.status}: ${body}`)
    }
  }

  // Sign in to get session cookie
  const signIn = await fetch(`${baseURL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'e2e-admin@test.local',
      password: 'password123456',
    }),
  })
  if (!signIn.ok) {
    console.warn(`[global-setup] sign-in failed: ${signIn.status}`)
    return
  }

  // Extract session cookie
  const cookies = signIn.headers.getSetCookie?.() ?? []
  const cookie = cookies.join('; ')

  // Seed storage backend
  const storage = await fetch(`${baseURL}/api/admin/storages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: 'E2E Storage',
      mode: 'private',
      bucket: 'e2e-test',
      endpoint: 'https://localhost:9000',
      region: 'auto',
      accessKey: 'e2e-access-key',
      secretKey: 'e2e-secret-key',
    }),
  })

  if (storage.ok) {
    console.log('[global-setup] storage seeded')
  } else {
    const body = await storage.text()
    // 409 or similar = already exists, fine
    console.warn(`[global-setup] seed storage: ${storage.status} ${body}`)
  }
}

export default globalSetup
