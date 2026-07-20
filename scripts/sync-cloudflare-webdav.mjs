import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncCloudflareWebDav } from './cloudflare-webdav.mjs'

async function main() {
  const result = await syncCloudflareWebDav({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  })
  if (result.hostname) {
    console.log(`WebDAV custom domain ready: https://${result.hostname}/`)
  } else {
    console.log('No primary Worker Custom Domain found; keeping /dav/')
  }
  console.log(`Removed stale WebDAV resources: rules=${result.removedRules} domains=${result.removedDomains}`)
}

const entrypoint = path.resolve(process.argv[1] ?? '')
if (entrypoint === fileURLToPath(import.meta.url)) await main()
