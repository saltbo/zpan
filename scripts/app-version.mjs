import { execFileSync } from 'node:child_process'
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

export function resolveAppCommit() {
  // Release/Docker builds pass the exact SHA via ZPAN_APP_COMMIT; Cloudflare
  // Workers Builds injects WORKERS_CI_COMMIT_SHA. Local dev has neither, so fall
  // back to git. Returns the short SHA, or '' when no source is available.
  const explicit = process.env.ZPAN_APP_COMMIT ?? process.env.WORKERS_CI_COMMIT_SHA
  if (explicit) {
    return explicit.slice(0, 7)
  }
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
