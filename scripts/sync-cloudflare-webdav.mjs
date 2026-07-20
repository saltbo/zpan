import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncCloudflareWebDav } from './cloudflare-webdav.mjs'

export function webDavOrigin(result) {
  return result.hostname ? new URL(`https://${result.hostname}`).origin : ''
}

async function main() {
  const result = await syncCloudflareWebDav({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  })
  const origin = webDavOrigin(result)
  if (result.hostname) {
    console.log(`WebDAV custom domain ready: ${origin}/`)
  } else {
    console.log('No primary Worker Custom Domain found; keeping /dav/')
  }
  console.log(`Removed stale WebDAV resources: rules=${result.removedRules} domains=${result.removedDomains}`)
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `origin=${origin}\n`)
}

const entrypoint = path.resolve(process.argv[1] ?? '')
if (entrypoint === fileURLToPath(import.meta.url)) await main()
