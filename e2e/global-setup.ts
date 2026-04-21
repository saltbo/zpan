/**
 * Playwright setup project — runs once before all device projects.
 * The webServer is already running when this executes.
 * Ensures an admin user and a storage backend exist.
 */
import { test as setup } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers'

const ADMIN_ACCOUNTS = [
  { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  { email: 'admin@zpan.dev', password: 'adminadmin' },
]

setup('seed admin and storage', async ({ request }) => {
  const headers = { Origin: 'http://localhost:5173' }

  // Try each known admin account
  let authed = false
  for (const cred of ADMIN_ACCOUNTS) {
    const resp = await request.post('/api/auth/sign-in/email', {
      headers,
      data: { email: cred.email, password: cred.password },
    })
    if (resp.ok()) {
      authed = true
      break
    }
  }

  // If none worked, register a new admin (fresh DB in CI)
  if (!authed) {
    await request.post('/api/auth/sign-up/email', {
      headers,
      data: { name: 'E2E Admin', email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    const resp = await request.post('/api/auth/sign-in/email', {
      headers,
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    if (!resp.ok()) {
      console.warn('[setup] could not authenticate admin')
      return
    }
  }

  // E2E specs rely on self-service sign-up to create isolated users. Force the
  // local test environment into OPEN mode so existing dev DB settings do not
  // make the suite depend on invite codes.
  await request.put('/api/system/options/auth_signup_mode', {
    headers,
    data: { value: 'open', public: true },
  })

  // Check if storage already exists
  const list = await request.get('/api/admin/storages', { headers })
  if (list.ok()) {
    const data = await list.json()
    if (data.items?.length > 0) return
  }

  // Seed storage
  await request.post('/api/admin/storages', {
    headers,
    data: {
      title: 'E2E Storage',
      mode: 'private',
      bucket: 'e2e-test',
      endpoint: 'https://localhost:9000',
      region: 'auto',
      accessKey: 'e2e-access-key',
      secretKey: 'e2e-secret-key',
    },
  })
})
