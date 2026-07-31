import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Resolver } from 'node:dns/promises'
import { createRequire } from 'node:module'
import {
  CloudE2eCommandError,
  cloudE2eAttemptCount,
  cloudE2eEndpoints,
  cloudflaredQuickTunnelArgs,
  isRetryableQuickTunnelFailure,
} from './cloud-e2e-resilience.mjs'

const args = process.argv.slice(2)
const require = createRequire(import.meta.url)
const runtime = valueAfter('--runtime') ?? process.env.E2E_RUNTIME ?? 'node'
const project = valueAfter('--project') ?? 'desktop'
const specs = (valueAfter('--spec') ?? 'cloud-store.spec.ts licensing.spec.ts').split(/\s+/).filter(Boolean)
const local = args.includes('--local')
const withS3Mock = args.includes('--with-s3-mock')
const cloudflared = process.env.CLOUDFLARED_BIN ?? 'cloudflared'
const appPort = Number(process.env.E2E_APP_PORT ?? 5185)
const apiPort = Number(process.env.E2E_API_PORT ?? 9222)
const s3MockPort = Number(process.env.E2E_S3_MOCK_PORT ?? 9191)
const localBaseUrl = `http://localhost:${appPort}`
const pidFile = `.cloudflared.${runtime}.pid`
const tunnelUrlPattern = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/
const publicDns = new Resolver()
publicDns.setServers(['1.1.1.1', '1.0.0.1'])

const cloudEnv = {
  ZPAN_CLOUD_URL: process.env.ZPAN_CLOUD_URL ?? 'http://localhost:5186',
  VITE_ZPAN_CLOUD_URL: process.env.VITE_ZPAN_CLOUD_URL ?? 'http://localhost:5186',
}
const credentialsEnv = runtimeCloudCredentials(runtime)

if (runtime === 'cf' && local) rmSync('.wrangler/state/v3/d1', { recursive: true, force: true })

const maxRunAttempts = local ? 1 : cloudE2eAttemptCount(process.env.E2E_TUNNEL_RUN_ATTEMPTS)
for (let attempt = 1; attempt <= maxRunAttempts; attempt += 1) {
  const tunnel = local ? null : await startTunnel(localBaseUrl)
  try {
    const e2eEnv = await buildE2eEnv(tunnel)
    if (runtime === 'cf') {
      writeDevVars(e2eEnv)
      await run('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local'], e2eEnv)
    }

    try {
      await run(
        process.execPath,
        [require.resolve('@playwright/test/cli'), 'test', ...specs, `--project=${project}`],
        e2eEnv,
        true,
      )
      break
    } catch (error) {
      const retryable =
        error instanceof CloudE2eCommandError &&
        tunnel &&
        isRetryableQuickTunnelFailure({
          commandOutput: error.output,
          tunnelOutput: tunnel.output(),
        })
      if (!retryable || attempt === maxRunAttempts) throw error
      console.warn(
        `Quick Tunnel failed during cloud E2E; restarting the tunnel and test harness (${attempt + 1}/${maxRunAttempts})...`,
      )
    }
  } finally {
    stopTunnel(tunnel)
  }
}

async function buildE2eEnv(tunnel) {
  const tunnelHost = tunnel ? new URL(tunnel.url).hostname : ''
  if (tunnel) await waitForPublicTunnelIp(tunnelHost)
  const { browserBaseUrl, publicBaseUrl } = cloudE2eEndpoints(localBaseUrl, tunnel?.url)
  return {
    ...cloudEnv,
    E2E_BASE_URL: browserBaseUrl,
    E2E_LOCAL_BASE_URL: localBaseUrl,
    E2E_PUBLIC_BASE_URL: publicBaseUrl,
    E2E_APP_PORT: String(appPort),
    E2E_API_PORT: String(apiPort),
    BETTER_AUTH_URL: publicBaseUrl,
    TRUSTED_ORIGINS: `${publicBaseUrl},${localBaseUrl}`,
    ...s3MockEnv(),
    ...credentialsEnv,
    ...(runtime === 'cf' ? { E2E_RUNTIME: 'cf' } : {}),
  }
}

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

function runtimeCloudCredentials(runtime) {
  const suffix = runtime === 'cf' ? '_CF' : '_NODE'
  const runtimeEmail =
    process.env[`E2E_CLOUD_BUSINESS_EMAIL${suffix}`]?.trim() ||
    process.env[`E2E_CLOUD_PRO_EMAIL${suffix}`]?.trim()
  const runtimePassword =
    process.env[`E2E_CLOUD_BUSINESS_PASSWORD${suffix}`]?.trim() ||
    process.env[`E2E_CLOUD_PRO_PASSWORD${suffix}`]?.trim()
  if (process.env.CI && (!runtimeEmail || !runtimePassword)) {
    throw new Error(`Missing E2E_CLOUD_BUSINESS_EMAIL${suffix} or E2E_CLOUD_BUSINESS_PASSWORD${suffix}`)
  }
  const email = runtimeEmail || process.env.E2E_CLOUD_BUSINESS_EMAIL || process.env.E2E_CLOUD_PRO_EMAIL
  const password =
    runtimePassword || process.env.E2E_CLOUD_BUSINESS_PASSWORD || process.env.E2E_CLOUD_PRO_PASSWORD
  return email && password
    ? {
        E2E_CLOUD_BUSINESS_EMAIL: email,
        E2E_CLOUD_BUSINESS_PASSWORD: password,
      }
    : {}
}

function s3MockEnv() {
  if (!withS3Mock) return {}
  return {
    E2E_S3_MOCK: '1',
    E2E_S3_MOCK_PORT: String(s3MockPort),
    E2E_STORAGE_ENDPOINT: `http://127.0.0.1:${s3MockPort}`,
    E2E_STORAGE_BUCKET: 'e2e-test',
    E2E_STORAGE_REGION: 'auto',
    E2E_STORAGE_ACCESS_KEY: 'e2e-access-key',
    E2E_STORAGE_SECRET_KEY: 'e2e-secret-key',
  }
}

async function startTunnel(target) {
  const maxAttempts = Number(process.env.E2E_TUNNEL_START_ATTEMPTS ?? 3)
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) console.log(`Retrying cloudflared quick tunnel startup (${attempt}/${maxAttempts})...`)
      return await startTunnelOnce(target)
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts) break
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000))
    }
  }
  throw lastError
}

function startTunnelOnce(target) {
  const child = spawn(cloudflared, cloudflaredQuickTunnelArgs(target), {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  writeFileSync(pidFile, String(child.pid))

  return new Promise((resolve, reject) => {
    let tunnelUrl = null
    let registered = false
    let output = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Timed out waiting for cloudflared tunnel registration'))
    }, 30_000)

    function handleOutput(chunk) {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)
      const match = text.match(tunnelUrlPattern)
      if (match) tunnelUrl = match[0]
      if (text.includes('Registered tunnel connection')) registered = true
      if (!tunnelUrl || !registered) return
      clearTimeout(timeout)
      resolve({ process: child, url: tunnelUrl, output: () => output })
    }

    child.stdout.on('data', handleOutput)
    child.stderr.on('data', handleOutput)
    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`cloudflared exited before tunnel URL was available: ${code}`))
    })
  })
}

function stopTunnel(tunnel) {
  if (tunnel) tunnel.process.kill()
  if (!existsSync(pidFile)) return
  const pid = Number(readFileSync(pidFile, 'utf8'))
  if (Number.isInteger(pid)) {
    try {
      process.kill(pid)
    } catch {}
  }
  rmSync(pidFile, { force: true })
}

function writeDevVars(env) {
  const updates = {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'ci-test-secret-that-is-at-least-32-chars',
    ZPAN_CLOUD_URL: env.ZPAN_CLOUD_URL,
    VITE_ZPAN_CLOUD_URL: env.VITE_ZPAN_CLOUD_URL,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    TRUSTED_ORIGINS: env.TRUSTED_ORIGINS,
  }
  const lines = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8').split(/\r?\n/) : []
  const seen = new Set()
  const next = lines
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const key = line.split('=')[0]
      if (Object.hasOwn(updates, key)) {
        seen.add(key)
        return `${key}=${updates[key]}`
      }
      return line
    })
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`)
  }
  writeFileSync('.dev.vars', `${next.join('\n')}\n`)
}

async function waitForPublicTunnelIp(hostname) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const addresses = await publicDns.resolve4(hostname)
      return addresses[0]
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw new Error(`Timed out waiting for public tunnel DNS: ${hostname}`)
}

function run(command, commandArgs, env = {}, captureOutput = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    })
    let output = ''
    if (captureOutput) {
      for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', (chunk) => {
          const text = chunk.toString()
          output += text
          process.stdout.write(text)
        })
      }
    }
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new CloudE2eCommandError(command, commandArgs, code, output))
    })
  })
}
