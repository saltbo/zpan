import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillDirectory = join(root, 'agent-skills', 'use-zpan')
const outputDirectory = join(root, 'public', '.well-known', 'agent-skills')
const archivePath = join(outputDirectory, 'use-zpan.tar.gz')
const indexPath = join(outputDirectory, 'index.json')
const files = ['SKILL.md', 'agents/openai.yaml'].map((name) => ({
  name,
  content: readFileSync(join(skillDirectory, name)),
}))

const frontmatter = files[0].content.toString('utf8').match(/^---\n([\s\S]*?)\n---/)
if (!frontmatter) throw new Error('use-zpan SKILL.md has no YAML frontmatter')

const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim()
const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
if (name !== 'use-zpan' || !description) throw new Error('use-zpan SKILL.md has invalid metadata')

const archive = gzipSync(createTar(files), { level: 9, mtime: 0 })
archive[9] = 255
const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`
const index = `${JSON.stringify(
  {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: [
      {
        name,
        type: 'archive',
        description,
        url: '/.well-known/agent-skills/use-zpan.tar.gz',
        digest,
      },
    ],
  },
  null,
  2,
)}\n`

mkdirSync(outputDirectory, { recursive: true })
if (process.argv.includes('--check')) {
  if (
    !existsSync(indexPath) ||
    !existsSync(archivePath) ||
    readFileSync(indexPath, 'utf8') !== index ||
    !readFileSync(archivePath).equals(archive)
  ) {
    throw new Error('Generated use-zpan Skill artifact is stale; run pnpm agent-skills:build')
  }
} else {
  writeFileSync(indexPath, index)
  writeFileSync(archivePath, archive)
}

function createTar(entries) {
  const blocks = []
  for (const entry of entries) {
    const header = Buffer.alloc(512)
    writeString(header, entry.name, 0, 100)
    writeOctal(header, 0o644, 100, 8)
    writeOctal(header, 0, 108, 8)
    writeOctal(header, 0, 116, 8)
    writeOctal(header, entry.content.length, 124, 12)
    writeOctal(header, 0, 136, 12)
    header.fill(0x20, 148, 156)
    header[156] = 0x30
    writeString(header, 'ustar', 257, 6)
    writeString(header, '00', 263, 2)
    writeString(header, 'zpan', 265, 32)
    writeString(header, 'zpan', 297, 32)
    writeOctal(header, checksum(header), 148, 8)
    blocks.push(header, entry.content)

    const padding = (512 - (entry.content.length % 512)) % 512
    if (padding > 0) blocks.push(Buffer.alloc(padding))
  }
  blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}

function writeString(buffer, value, offset, length) {
  const bytes = Buffer.from(value)
  if (bytes.length > length) throw new Error(`Tar field is too long: ${value}`)
  bytes.copy(buffer, offset)
}

function writeOctal(buffer, value, offset, length) {
  const encoded = value.toString(8).padStart(length - 1, '0')
  writeString(buffer, `${encoded}\0`, offset, length)
}

function checksum(buffer) {
  let total = 0
  for (const byte of buffer) total += byte
  return total
}
