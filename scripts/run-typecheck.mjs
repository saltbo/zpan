import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tsc = require.resolve('typescript/bin/tsc')
const projects = ['server/tsconfig.json', 'src/tsconfig.json']
const results = await Promise.all(projects.map(runTypecheck))
const failures = results.filter(({ code }) => code !== 0)

if (failures.length > 0) {
  throw new Error(`Typecheck failed: ${failures.map(({ project }) => project).join(', ')}`)
}

function runTypecheck(project) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsc, '--noEmit', '-p', project], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`Typecheck terminated by ${signal}: ${project}`))
      else resolve({ project, code: code ?? 1 })
    })
  })
}
