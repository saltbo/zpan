import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const INTERNAL_TOKEN_ENV = 'ZPAN_INTERNAL_API_TOKEN'
const REPORT_PATH = '/api/internal/instance-telemetry/report'
const DEFAULT_DEPLOY_URL = 'https://zpan.saltbo.workers.dev'
const TOP_LEVEL_ENV_ARG = '--env='

class ReportError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${body}`)
    this.status = status
  }
}

const token = randomBytes(32).toString('hex')
if (process.env.GITHUB_ACTIONS === 'true') {
  console.log(`::add-mask::${token}`)
}

let secretSet = false
let reportError
try {
  putInternalToken(token)
  secretSet = true
  await reportDeployTelemetry(token)
} catch (err) {
  reportError = err
  throw err
} finally {
  if (secretSet) {
    try {
      deleteInternalToken()
    } catch (err) {
      if (!reportError) throw err
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Failed to delete ${INTERNAL_TOKEN_ENV}: ${message}`)
    }
  }
}

function putInternalToken(internalToken) {
  console.log(`Setting ${INTERNAL_TOKEN_ENV}`)
  const res = spawnSync('wrangler', ['secret', 'put', INTERNAL_TOKEN_ENV, TOP_LEVEL_ENV_ARG], {
    input: internalToken,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (res.status !== 0) throw new Error(`wrangler secret put failed status=${res.status ?? 1}`)
}

function deleteInternalToken() {
  console.log(`Deleting ${INTERNAL_TOKEN_ENV}`)
  const res = spawnSync('wrangler', ['secret', 'delete', INTERNAL_TOKEN_ENV, TOP_LEVEL_ENV_ARG], {
    input: 'y\n',
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (res.status !== 0) throw new Error(`wrangler secret delete failed status=${res.status ?? 1}`)
}

async function reportDeployTelemetry(internalToken) {
  const url = new URL(REPORT_PATH, resolveDeployUrl())

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${internalToken}`,
        },
      })
      if (!res.ok) throw new ReportError(res.status, await res.text())
      console.log(`Reported deployed instance telemetry: ${url}`)
      return
    } catch (err) {
      if (attempt === 5) throw err
      if (err instanceof ReportError && err.status === 404) {
        console.warn(`Deploy telemetry endpoint is waiting for secret propagation attempt=${attempt}`)
      } else {
        const code = err instanceof Error ? err.message : String(err)
        console.warn(`Deploy telemetry report failed attempt=${attempt} error=${code}`)
      }
      await sleep(1000 * attempt)
    }
  }
}

function resolveDeployUrl() {
  return process.env.ZPAN_DEPLOY_URL?.trim() || process.env.BETTER_AUTH_URL?.trim() || DEFAULT_DEPLOY_URL
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
