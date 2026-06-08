import { execSync } from 'node:child_process'

export function resolveAppVersion() {
  // The Docker build excludes .git from its context, so git describe cannot run
  // there. The release pipeline passes the tag in via ZPAN_APP_VERSION instead.
  if (process.env.ZPAN_APP_VERSION) {
    return process.env.ZPAN_APP_VERSION
  }
  return execSync('git describe --tags --always --dirty', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(resolveAppVersion())
}
