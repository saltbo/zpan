import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCloudflareWebDavUrl, syncCloudflareWebDav } from './cloudflare-webdav.mjs'

async function main() {
  if (process.argv.includes('--validate-only')) {
    const url = parseCloudflareWebDavUrl(process.env.WEBDAV_PUBLIC_URL)
    if (!url) throw new Error('WEBDAV_PUBLIC_URL is required for validation')
    console.log(`Valid WebDAV custom domain configuration: ${url.origin}`)
    return
  }
  const result = await syncCloudflareWebDav({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    publicUrl: process.env.WEBDAV_PUBLIC_URL,
  })
  if (result.hostname) {
    console.log(`WebDAV custom domain ready: https://${result.hostname}/`)
  } else {
    console.log('WebDAV custom domain disabled')
  }
  console.log(`Removed stale WebDAV resources: rules=${result.removedRules} domains=${result.removedDomains}`)
}

const entrypoint = path.resolve(process.argv[1] ?? '')
if (entrypoint === fileURLToPath(import.meta.url)) await main()
