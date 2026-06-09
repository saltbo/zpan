import { readFileSync } from 'node:fs'

export function resolveAppVersion() {
  // Release/Docker builds pass the exact tag via ZPAN_APP_VERSION. Everything
  // else (Cloudflare Workers Builds, local dev) reads package.json — a source
  // that is present in every build environment, unlike git tags, which are
  // absent from the Workers Builds checkout and from the Docker context.
  if (process.env.ZPAN_APP_VERSION) {
    return process.env.ZPAN_APP_VERSION
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return pkg.version
}
