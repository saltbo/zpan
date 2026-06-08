import { execSync } from 'node:child_process'

export function resolveAppVersion() {
  return execSync('git describe --tags --always --dirty', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(resolveAppVersion())
}
