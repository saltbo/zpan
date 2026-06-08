import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const INTERNAL_TOKEN_ENV = 'ZPAN_INTERNAL_API_TOKEN'
const REPORT_PATH = '/api/internal/instance-telemetry/report'
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
  const deployUrl = resolveDeployUrl()
  putInternalToken(token)
  secretSet = true
  const reported = await reportDeployTelemetry(token, deployUrl)
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

async function reportDeployTelemetry(internalToken, deployUrl) {
  const url = new URL(REPORT_PATH, deployUrl)
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
  const value = process.argv[2]?.trim()
  if (!value) {
    throw new Error('Deploy telemetry URL is required. Usage: node scripts/report-deploy-telemetry.mjs https://your-zpan.example')
  }
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Deploy telemetry URL must use http or https: ${value}`)
  }
  return url.origin
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
