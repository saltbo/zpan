import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let child
let origin

beforeAll(async () => {
  const port = await reservePort()
  origin = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['scripts/zpan-cloud-fake.mjs'], {
    env: { ...process.env, E2E_CLOUD_FAKE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('zpan-cloud fake listening')) resolve()
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Cloud fake exited with ${code}: ${stderr}`)))
  })
})

afterAll(async () => {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))
})

describe('zpan-cloud protocol fake', () => {
  it('separates the test approval control plane from production pairing routes', async () => {
    const pairing = await request('/api/pairings', {
      method: 'POST',
      body: { instance: { id: 'instance-1', url: 'http://zpan.test' } },
    })
    expect(pairing.status).toBe(201)
    const code = pairing.body.data.code

    expect((await request(`/api/pairings/${code}`, { method: 'PATCH', body: { action: 'approve' } })).status).toBe(
      405,
    )
    expect(
      (await request(`/_test/pairings/${code}/approve`, { method: 'PATCH', body: { action: 'approve' } })).status,
    ).toBe(200)
  })

  it('rejects missing bound-client auth and malformed commerce payloads', async () => {
    expect((await request('/api/stores/e2e-store/products')).status).toBe(401)
    expect(
      (
        await request('/api/stores/e2e-store/orders', {
          method: 'POST',
          token: 'e2e-refresh-token',
          body: { items: [] },
        })
      ).status,
    ).toBe(422)
  })
})

async function request(path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    method: options.method,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Could not reserve a port'))
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}
