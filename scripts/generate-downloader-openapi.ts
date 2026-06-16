import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildClientSpec } from './build-client-spec'

const output = resolve('docs/openapi/downloader.json')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(await buildClientSpec(), null, 2)}\n`)
// The in-memory app keeps no open handles, but exit explicitly so the script
// never hangs on a stray timer from a transitively-imported module.
process.exit(0)
