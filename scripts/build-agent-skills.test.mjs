import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const skillDirectory = new URL('../agent-skills/use-zpan/', import.meta.url)
const outputDirectory = new URL('../public/.well-known/agent-skills/', import.meta.url)
const wranglerConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')

describe('Agent Skill artifacts', () => {
  it('publishes a digest-pinned archive containing the canonical use-zpan Skill', () => {
    const index = JSON.parse(readFileSync(new URL('index.json', outputDirectory), 'utf8'))
    const archive = readFileSync(new URL('use-zpan.tar.gz', outputDirectory))

    expect(archive[9]).toBe(255)
    expect(index).toEqual({
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: [
        {
          name: 'use-zpan',
          type: 'archive',
          description: expect.stringContaining('through Realmroot'),
          url: '/.well-known/agent-skills/use-zpan.tar.gz',
          digest: `sha256:${createHash('sha256').update(archive).digest('hex')}`,
        },
      ],
    })

    const files = readTarFiles(gunzipSync(archive))
    expect([...files.keys()]).toEqual(['SKILL.md', 'agents/openai.yaml'])
    expect(files.get('SKILL.md')).toEqual(readFileSync(new URL('SKILL.md', skillDirectory)))
    expect(files.get('agents/openai.yaml')).toEqual(
      readFileSync(new URL('agents/openai.yaml', skillDirectory)),
    )
  })

  it('keeps Agent Skill discovery on static assets', () => {
    expect(wranglerConfig).toContain('"/.well-known/oauth-authorization-server/*"')
    expect(wranglerConfig).toContain('"/.well-known/openid-configuration/*"')
    expect(wranglerConfig).toContain('"/.well-known/oauth-protected-resource/*"')
    expect(wranglerConfig).toContain('"/.well-known/zpan-domain-verification/*"')
    expect(wranglerConfig).not.toContain('"/.well-known/*"')
    expect(wranglerConfig).not.toContain('"/.well-known/agent-skills')
    expect(wranglerConfig).not.toMatch(/"!\/\.well-known\//)
  })
})

function readTarFiles(archive) {
  const files = new Map()
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8)
    offset += 512
    files.set(name, archive.subarray(offset, offset + size))
    offset += Math.ceil(size / 512) * 512
  }
  return files
}
