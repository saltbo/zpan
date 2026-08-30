import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const wranglerPackage = require.resolve('wrangler/package.json')
const wrangler = join(dirname(wranglerPackage), 'bin', 'wrangler.js')
const stateDir = mkdtempSync(join(tmpdir(), 'zpan-e2e-'))
const shardArg = process.argv.slice(2).find((arg) => arg.startsWith('--shard='))
const artifactSuffix = `${shardArg?.slice('--shard='.length).replace('/', '-of-') ?? 'run'}-${process.pid}`
const [appPort, apiPort, s3Port, cloudPort] = await Promise.all([
  reservePort(),
  reservePort(),
  reservePort(),
  reservePort(),
])

const appOrigin = `http://127.0.0.1:${appPort}`
const cloudOrigin = `http://127.0.0.1:${cloudPort}`
const env = {
  ...process.env,
  DATABASE_URL: join(stateDir, 'zpan.db'),
  E2E_STATE_DIR: stateDir,
  E2E_ARTIFACT_SUFFIX: artifactSuffix,
  E2E_APP_PORT: String(appPort),
  E2E_API_PORT: String(apiPort),
  E2E_S3_MOCK_PORT: String(s3Port),
  E2E_CLOUD_FAKE_PORT: String(cloudPort),
  E2E_BASE_URL: appOrigin,
  E2E_LOCAL_BASE_URL: appOrigin,
  E2E_PUBLIC_BASE_URL: appOrigin,
  E2E_S3_MOCK: '1',
  E2E_CLOUD_FAKE: '1',
  E2E_STORAGE_ENDPOINT: `http://127.0.0.1:${s3Port}`,
  E2E_STORAGE_BUCKET: 'e2e-test',
  E2E_STORAGE_REGION: 'auto',
  E2E_STORAGE_ACCESS_KEY: 'e2e-access-key',
  E2E_STORAGE_SECRET_KEY: 'e2e-secret-key',
  ZPAN_CLOUD_URL: cloudOrigin,
  VITE_ZPAN_CLOUD_URL: cloudOrigin,
  ZPAN_LICENSE_PUBLIC_KEYS: 'k4.public.H2gYKGNtxgWbMuwgPdDuHoM_sOLzFC-khe23pz2IZfM',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'e2e-auth-secret-that-is-at-least-32-characters',
  BETTER_AUTH_URL: appOrigin,
  TRUSTED_ORIGINS: appOrigin,
}

try {
  if (process.env.E2E_RUNTIME === 'cf') {
    await run(
      process.execPath,
      [
        wrangler,
        'd1',
        'migrations',
        'apply',
        'DB',
        '--local',
        '--persist-to',
        stateDir,
      ],
      { ...env, CI: 'true' },
      ['ignore', 'ignore', 'inherit'],
    )
  }
  await run(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], env)
} finally {
  rmSync(stateDir, { recursive: true, force: true })
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not allocate an E2E port'))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

function run(command, args, childEnv, stdio = 'inherit') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: childEnv, stdio })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Playwright exited with ${signal ?? code}`))
    })
  })
}
