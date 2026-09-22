import { spawn } from 'node:child_process'

// Explicit Node development starts both the API and its Vite frontend proxy.
const apiPort = process.env.E2E_API_PORT ?? '8222'
const children = [
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/entry-node.ts'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: apiPort },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--mode', 'node', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, E2E_API_PORT: apiPort },
  }),
]
let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) child.kill('SIGTERM')
}
for (const child of children) {
  child.on('error', (error) => { console.error(error); stop(1) })
  child.on('exit', (code) => stop(code ?? 1))
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
