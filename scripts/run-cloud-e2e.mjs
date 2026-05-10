import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Resolver } from 'node:dns/promises'

const args = process.argv.slice(2)
const runtime = valueAfter('--runtime') ?? process.env.E2E_RUNTIME ?? 'node'
const project = valueAfter('--project') ?? 'desktop'
const cloudflared = process.env.CLOUDFLARED_BIN ?? 'cloudflared'
const tunnelUrlPattern = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/
const publicDns = new Resolver()
publicDns.setServers(['1.1.1.1', '1.0.0.1'])

const cloudEnv = {
  ZPAN_CLOUD_URL: process.env.ZPAN_CLOUD_URL ?? 'https://zpan-cloud-staging.saltbo.workers.dev',
  VITE_ZPAN_CLOUD_URL: process.env.VITE_ZPAN_CLOUD_URL ?? 'https://zpan-cloud-staging.saltbo.workers.dev',
}

const tunnel = await startTunnel('http://localhost:5173')
const tunnelHost = new URL(tunnel.url).hostname
const tunnelIp = await waitForPublicTunnelIp(tunnelHost)
const tunnelEnv = {
  E2E_BASE_URL: tunnel.url,
  BETTER_AUTH_URL: tunnel.url,
  TRUSTED_ORIGINS: `${tunnel.url},http://localhost:5173`,
  E2E_CHROME_HOST_RESOLVER_RULES: `MAP ${tunnelHost} ${tunnelIp}`,
}
const e2eEnv = {
  ...cloudEnv,
  ...tunnelEnv,
  ...(runtime === 'cf' ? { E2E_RUNTIME: 'cf' } : {}),
}

if (runtime === 'cf') {
  writeDevVars(e2eEnv)
  await run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local'], e2eEnv)
}

try {
  await run('npx', ['playwright', 'test', 'cloud-store.spec.ts', `--project=${project}`], e2eEnv)
} finally {
  try {
    tunnel.process.kill()
  } catch {}
  if (existsSync('.cloudflared.pid')) {
    const pid = Number(readFileSync('.cloudflared.pid', 'utf8'))
    if (Number.isInteger(pid)) {
      try {
        process.kill(pid)
      } catch {}
    }
    rmSync('.cloudflared.pid', { force: true })
  }
}

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

function startTunnel(target) {
  const child = spawn(cloudflared, ['tunnel', '--url', target, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  writeFileSync('.cloudflared.pid', String(child.pid))

  return new Promise((resolve, reject) => {
    let tunnelUrl = null
    let registered = false
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Timed out waiting for cloudflared tunnel registration'))
    }, 30_000)

    function handleOutput(chunk) {
      const text = chunk.toString()
      process.stdout.write(text)
      const match = text.match(tunnelUrlPattern)
      if (match) tunnelUrl = match[0]
      if (text.includes('Registered tunnel connection')) registered = true
      if (!tunnelUrl || !registered) return
      clearTimeout(timeout)
      resolve({ process: child, url: tunnelUrl })
    }

    child.stdout.on('data', handleOutput)
    child.stderr.on('data', handleOutput)
    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`cloudflared exited before tunnel URL was available: ${code}`))
    })
  })
}

function writeDevVars(env) {
  const lines = [
    `BETTER_AUTH_SECRET=${process.env.BETTER_AUTH_SECRET ?? 'ci-test-secret-that-is-at-least-32-chars'}`,
    `ZPAN_CLOUD_URL=${env.ZPAN_CLOUD_URL}`,
    `VITE_ZPAN_CLOUD_URL=${env.VITE_ZPAN_CLOUD_URL}`,
    `BETTER_AUTH_URL=${env.BETTER_AUTH_URL}`,
    `TRUSTED_ORIGINS=${env.TRUSTED_ORIGINS}`,
    '',
  ]
  writeFileSync('.dev.vars', lines.join('\n'))
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

function run(command, commandArgs, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${commandArgs.join(' ')} exited with ${code}`))
    })
  })
}
