import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { downloaderOpenAPIDocument } from '../server/openapi/downloader'

const execFile = promisify(execFileCallback)
const root = process.cwd()

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), 'zpan-downloader-openapi-'))
  try {
    const generatedDocPath = join(tempDir, 'downloader.json')
    const generatedClientPath = join(tempDir, 'client.gen.go')
    const configPath = join(tempDir, 'oapi-codegen.yaml')

    await mkdir(join(root, 'docs/openapi'), { recursive: true })
    await writeFile(
      generatedDocPath,
      `${JSON.stringify(downloaderOpenAPIDocument(), null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      configPath,
      [
        'package: openapi',
        'generate:',
        '  models: true',
        '  client: true',
        `output: ${JSON.stringify(generatedClientPath)}`,
        '',
      ].join('\n'),
      'utf8',
    )

    await execFile(
      'go',
      [
        'run',
        'github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.7.0',
        '-config',
        configPath,
        generatedDocPath,
      ],
      { cwd: root },
    )

    await assertSame(
      'docs/openapi/downloader.json',
      generatedDocPath,
      'Downloader OpenAPI document is stale.',
    )
    await assertSame(
      'cmd/internal/openapi/client.gen.go',
      generatedClientPath,
      'Downloader Go OpenAPI client is stale.',
    )
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}

async function assertSame(path: string, generatedPath: string, message: string) {
  const actual = await readFile(join(root, path), 'utf8')
  const generated = await readFile(generatedPath, 'utf8')
  if (actual !== generated) {
    console.error(message)
    console.error(`Run: pnpm openapi:downloader:go`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
