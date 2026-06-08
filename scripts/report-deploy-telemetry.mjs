import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const INTERNAL_TOKEN_ENV = 'ZPAN_INTERNAL_API_TOKEN'
const REPORT_PATH = '/api/internal/instance-telemetry/report'
const DEFAULT_DEPLOY_URL = 'https://zpan.saltbo.workers.dev'
const TOP_LEVEL_ENV_ARG = '--env='
const SECRET_PROPAGATION_DELAY_MS = 5000
const REPORT_RETRY_COUNT = 12
const REPORT_RETRY_DELAY_MS = 5000

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
try {
  putInternalToken(token)
  secretSet = true
  const reported = await reportDeployTelemetry(token)
  if (!reported) {
    console.warn('Deploy telemetry report was not delivered after retries; continuing deploy.')
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.warn(`Deploy telemetry setup failed; continuing deploy. error=${message}`)
} finally {
  if (secretSet) {
    deleteInternalToken()
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
  await sleep(SECRET_PROPAGATION_DELAY_MS)

  for (let attempt = 1; attempt <= REPORT_RETRY_COUNT; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${internalToken}`,
        },
      })
      if (!res.ok) throw new ReportError(res.status, await res.text())
      console.log(`Reported deployed instance telemetry: ${url}`)
      return true
    } catch (err) {
      if (err instanceof ReportError && err.status === 404) {
        console.warn(`Deploy telemetry endpoint is waiting for secret propagation attempt=${attempt}`)
      } else {
        const code = err instanceof Error ? err.message : String(err)
        console.warn(`Deploy telemetry report failed attempt=${attempt} error=${code}`)
      }
      if (attempt < REPORT_RETRY_COUNT) await sleep(REPORT_RETRY_DELAY_MS)
    }
  }
  return false
}

function resolveDeployUrl() {
  return process.env.ZPAN_DEPLOY_URL?.trim() || process.env.BETTER_AUTH_URL?.trim() || DEFAULT_DEPLOY_URL
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
