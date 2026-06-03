import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { downloaderOpenAPIDocument } from '../server/openapi/downloader'

const output = resolve('docs/openapi/downloader.json')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(downloaderOpenAPIDocument(), null, 2)}\n`)
