import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [port, envFile] = process.argv.slice(2)

// Playwright runs webServer commands through a shell, so `PORT=x node …` is not
// portable (it fails under Windows cmd). Passing PORT through process.env keeps
// the E2E node server working on every platform.
const nodeArgs = envFile ? [envFile] : []
const child = spawn(
  process.execPath,
  [...nodeArgs, join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'e2e/server/node-entry.ts'],
  { cwd: root, env: { ...process.env, PORT: port }, stdio: 'inherit' },
)
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
