import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertPreviewDatabaseName,
  buildPreviewReviewerSeedSql,
  buildWranglerExecuteFileArgs,
  buildWranglerMigrateArgs,
  buildWranglerVersionsUploadArgs,
  patchD1BindingConfig,
  previewDatabaseName,
  previewSlug,
  resolvePreviewContext,
} from './cloudflare-branch-preview.mjs'

const scriptPath = path.resolve(process.cwd(), 'scripts/cloudflare-branch-preview.mjs')
const previewRepository = 'saltbo/zpan'
const tempDirs = new Set()

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs.clear()
})

function createHarness(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'zpan-preview-cli-'))
  tempDirs.add(root)

  const workDir = path.join(root, 'work')
  const distDir = path.join(workDir, 'dist', 'zpan')
  const configPath = path.join(distDir, 'wrangler.json')

  const config =
    options.config ??
    {
      name: 'zpan',
      d1_databases: [{ binding: 'DB', database_name: 'zpan-db-staging', database_id: 'staging-id' }],
    }
  const state = {
    calls: [],
    databases: options.databases ?? [],
    uploads: [],
    executedSql: [],
    nextUuid: options.nextUuid ?? 1,
  }

  mkdirSync(distDir, { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  return {
    root,
    workDir,
    configPath,
    async run(args, overrides = {}) {
      const originalArgv = [...process.argv]
      const originalCwd = process.cwd()
      const originalEnv = { ...process.env }
      const originalExit = process.exit
      const originalLog = console.log
      const stdout = []
      let status = 0
      let error = null

      const restore = () => {
        vi.doUnmock('node:child_process')
        vi.resetModules()
        process.argv = originalArgv
        process.chdir(originalCwd)
        process.env = originalEnv
        process.exit = originalExit
        console.log = originalLog
      }

      try {
        const execFileSync = (command, commandArgs, execOptions = {}) => {
          state.calls.push({
            command,
            args: commandArgs,
            cwd: process.cwd(),
            cloudflareEnv: execOptions.env?.CLOUDFLARE_ENV ?? process.env.CLOUDFLARE_ENV ?? null,
          })

          if (command === 'git' && commandArgs[0] === 'branch' && commandArgs[1] === '--show-current') {
            if (process.env.FAKE_GIT_BRANCH_ERROR === '1') throw new Error('fake git failure')
            return `${process.env.FAKE_GIT_BRANCH ?? ''}\n`
          }

          if (command === 'git' && commandArgs[0] === 'remote' && commandArgs[1] === 'get-url' && commandArgs[2] === 'origin') {
            if (process.env.FAKE_GIT_REMOTE_ERROR === '1') throw new Error('fake git remote failure')
            return `${process.env.FAKE_GIT_REMOTE ?? ''}\n`
          }

          if (command !== 'pnpm') throw new Error(`Unexpected command: ${command}`)
          if (commandArgs[0] !== 'exec') throw new Error(`Unsupported fake pnpm invocation: ${commandArgs.join(' ')}`)

          if (commandArgs[1] === 'vite' && commandArgs[2] === 'build') {
            if (process.env.FAKE_VITE_FAIL === '1') throw new Error('fake vite failure')
            return ''
          }

          if (commandArgs[1] !== 'wrangler') throw new Error(`Unsupported fake pnpm command: ${commandArgs.join(' ')}`)

          if (commandArgs[2] === 'd1' && commandArgs[3] === 'list' && commandArgs[4] === '--json') {
            if (process.env.FAKE_LIST_INVALID_JSON === '1') return '{invalid json'
            return JSON.stringify(state.databases)
          }

          if (commandArgs[2] === 'd1' && commandArgs[3] === 'delete') {
            if (process.env.FAKE_DELETE_FAIL === '1') throw new Error('fake delete failure')
            state.databases = state.databases.filter((db) => db.name !== commandArgs[4])
            return ''
          }

          if (commandArgs[2] === 'd1' && commandArgs[3] === 'create') {
            if (process.env.FAKE_CREATE_FAIL === '1') throw new Error('fake create failure')
            if (process.env.FAKE_CREATE_SKIP_REGISTER !== '1') {
              state.databases.push(
                process.env.FAKE_CREATE_REGISTER_WITHOUT_UUID === '1'
                  ? { name: commandArgs[4] }
                  : { name: commandArgs[4], uuid: `uuid-${state.nextUuid}` },
              )
            }
            state.nextUuid += 1
            return ''
          }

          if (commandArgs[2] === 'd1' && commandArgs[3] === 'migrations' && commandArgs[4] === 'apply') {
            if (process.env.FAKE_MIGRATE_FAIL === '1') throw new Error('fake migrate failure')
            return ''
          }

          if (commandArgs[2] === 'd1' && commandArgs[3] === 'execute') {
            if (process.env.FAKE_EXECUTE_FAIL === '1') throw new Error('fake execute failure')
            const fileIndex = commandArgs.indexOf('--file')
            state.executedSql.push({
              configPath: commandArgs[commandArgs.indexOf('--config') + 1],
              sql: readFileSync(commandArgs[fileIndex + 1], 'utf8'),
            })
            return ''
          }

          if (commandArgs[2] === 'versions' && commandArgs[3] === 'upload') {
            if (process.env.FAKE_UPLOAD_FAIL === '1') throw new Error('fake upload failure')
            state.uploads.push({
              configPath: commandArgs[commandArgs.indexOf('--config') + 1],
              alias: commandArgs[commandArgs.indexOf('--preview-alias') + 1],
            })
            return ''
          }

          throw new Error(`Unsupported fake wrangler invocation: ${commandArgs.join(' ')}`)
        }

        vi.resetModules()
        vi.doMock('node:child_process', () => ({ default: { execFileSync }, execFileSync }))
        process.argv = [process.execPath, scriptPath, ...args]
        process.chdir(workDir)
        process.env = { ...process.env, ZPAN_PREVIEW_REPOSITORY: previewRepository, ...overrides.env }
        process.exit = ((code = 0) => {
          throw Object.assign(new Error(`EXIT:${code}`), { exitCode: code })
        })
        console.log = (...parts) => {
          stdout.push(parts.join(' '))
        }

        await import(`${pathToFileURL(scriptPath).href}?test=${Date.now()}-${Math.random()}`)
      } catch (caught) {
        if (caught?.message?.startsWith('EXIT:')) status = caught.exitCode ?? 1
        else {
          status = 1
          error = caught
        }
      } finally {
        restore()
      }

      return { status, stdout: stdout.join('\n'), error }
    },
    readState() {
      return structuredClone(state)
    },
    readConfig() {
      return JSON.parse(readFileSync(configPath, 'utf8'))
    },
  }
}

describe('cloudflare branch preview lifecycle', () => {
  it('derives a stable slug and an isolated preview database name from the branch', () => {
    const source = 'feature/Profile Share Listing!'
    expect(
      resolvePreviewContext({
        ZPAN_PREVIEW_REPOSITORY: previewRepository,
        WORKERS_CI_BRANCH: source,
      }),
    ).toEqual({
      source,
      repository: previewRepository,
      slug: previewSlug(`${previewRepository}-${source}`),
      databaseName: previewDatabaseName(`${previewRepository}:${source}`),
    })
  })

  it('keeps generated preview slugs within the Cloudflare alias budget', () => {
    const slug = previewSlug('very-long-branch-name-with-many-path-segments-and-ticket-identifiers-517')

    expect(slug).toHaveLength(45)
    expect(slug).toMatch(/^very-long-branch-name-with-many-path-[a-f0-9]{8}$/)
  })

  it('normalizes empty and digit-prefixed preview slugs safely', () => {
    expect(previewSlug('!!!')).toBe('branch')
    expect(previewSlug('123 start')).toBe('b-123-start')
  })

  it('builds deterministic preview database names that stay within the D1 limit and resist collisions', () => {
    const branchA =
      'feature/very-long-preview-branch-name-for-collision-testing-ticket-123456-and-more-segments'
    const branchB =
      'feature/very-long-preview-branch-name-for-collision-testing-ticket-123456-and-different-tail'

    const nameA = previewDatabaseName(branchA)
    const nameAAgain = previewDatabaseName(branchA)
    const nameB = previewDatabaseName(branchB)

    expect(nameA).toBe(nameAAgain)
    expect(nameA).not.toBe(nameB)
    expect(nameA.length).toBeLessThanOrEqual(32)
    expect(nameB.length).toBeLessThanOrEqual(32)
    expect(nameA).toMatch(/^zpan-preview-[a-z0-9-]+-[a-f0-9]{8}$/)
    expect(nameB).toMatch(/^zpan-preview-[a-z0-9-]+-[a-f0-9]{8}$/)
  })

  it('isolates the same branch across different repositories', () => {
    const branch = 'feature/shared-branch-name'

    const repoA = previewDatabaseName(`saltbo/zpan:${branch}`)
    const repoB = previewDatabaseName(`otherfork/zpan:${branch}`)

    expect(repoA).not.toBe(repoB)
  })

  it('isolates preview aliases for the same branch across different repositories', () => {
    const branch = 'feature/shared-branch-name'

    const repoA = resolvePreviewContext({
      ZPAN_PREVIEW_REPOSITORY: 'saltbo/zpan',
      WORKERS_CI_BRANCH: branch,
    })
    const repoB = resolvePreviewContext({
      ZPAN_PREVIEW_REPOSITORY: 'otherfork/zpan',
      WORKERS_CI_BRANCH: branch,
    })

    expect(repoA.slug).not.toBe(repoB.slug)
  })

  it('refuses main and non-preview database overrides, and requires a branch outside git', async () => {
    const harness = createHarness()
    const missing = await harness.run(['prepare'], { env: { PATH: process.env.PATH } })

    expect(missing.status).toBe(1)
    expect(missing.error?.message).toContain('A branch name is required to manage a preview database')
    expect(() => resolvePreviewContext({ ZPAN_PREVIEW_REPOSITORY: previewRepository, WORKERS_CI_BRANCH: 'main' })).toThrow(
      'Refusing to manage a preview database for main',
    )
    expect(() =>
      resolvePreviewContext({
        ZPAN_PREVIEW_REPOSITORY: previewRepository,
        WORKERS_CI_BRANCH: 'feature/test',
        ZPAN_PREVIEW_D1_DATABASE: 'zpan-db-staging',
      }),
    ).toThrow(
      'Refusing to manage non-preview D1 database',
    )
    expect(() =>
      resolvePreviewContext({
        ZPAN_PREVIEW_REPOSITORY: previewRepository,
        WORKERS_CI_BRANCH: 'feature/test',
        ZPAN_PREVIEW_D1_DATABASE: 'preview-feature',
      }),
    ).toThrow(
      'Refusing to manage non-preview D1 database',
    )
  })

  it('prefers explicit preview env overrides over git detection', () => {
    expect(
      resolvePreviewContext({
        ZPAN_PREVIEW_NAME: 'feature/from-env',
        ZPAN_PREVIEW_REPOSITORY: previewRepository,
        WORKERS_CI_BRANCH: 'feature/from-workers',
        ZPAN_PREVIEW_D1_DATABASE: 'zpan-preview-custom-env-db',
      }),
    ).toEqual({
      source: 'feature/from-env',
      repository: previewRepository,
      slug: previewSlug(`${previewRepository}-feature/from-env`),
      databaseName: 'zpan-preview-custom-env-db',
    })
  })

  it('derives the repository from git HTTPS origins when no preview repository env is set', async () => {
    const harness = createHarness()

    const result = await harness.run(['upload', '--config', harness.configPath], {
      env: {
        ZPAN_PREVIEW_REPOSITORY: '',
        FAKE_GIT_BRANCH: 'feature/git-https',
        FAKE_GIT_REMOTE: 'https://github.com/SaltBo/ZPan.git',
      },
    })

    expect(result.status).toBe(0)
    expect(harness.readState().uploads).toEqual([
      {
        configPath: harness.configPath,
        alias: previewSlug('saltbo/zpan-feature/git-https'),
      },
    ])
  })

  it('derives the repository from git SSH origins when no preview repository env is set', async () => {
    const harness = createHarness()

    const result = await harness.run(['upload', '--config', harness.configPath], {
      env: {
        ZPAN_PREVIEW_REPOSITORY: '',
        FAKE_GIT_BRANCH: 'feature/git-ssh',
        FAKE_GIT_REMOTE: 'git@github.com:SaltBo/ZPan.git',
      },
    })

    expect(result.status).toBe(0)
    expect(harness.readState().uploads).toEqual([
      {
        configPath: harness.configPath,
        alias: previewSlug('saltbo/zpan-feature/git-ssh'),
      },
    ])
  })

  it('fails when repository detection falls back to a malformed git origin', async () => {
    const harness = createHarness()

    const result = await harness.run(['prepare'], {
      env: {
        ZPAN_PREVIEW_REPOSITORY: '',
        FAKE_GIT_BRANCH: 'feature/bad-origin',
        FAKE_GIT_REMOTE: 'ssh://example.com/not-github.git',
      },
    })

    expect(result.status).toBe(1)
    expect(result.error?.message).toContain('A repository name is required to isolate a preview database')
  })

  it('fails when git origin lookup throws and no preview repository env is set', async () => {
    const harness = createHarness()

    const result = await harness.run(['prepare'], {
      env: {
        ZPAN_PREVIEW_REPOSITORY: '',
        FAKE_GIT_BRANCH: 'feature/no-origin',
        FAKE_GIT_REMOTE_ERROR: '1',
      },
    })

    expect(result.status).toBe(1)
    expect(result.error?.message).toContain('A repository name is required to isolate a preview database')
  })

  it('rejects protected preview-like database names before any mutation can happen', () => {
    expect(() => assertPreviewDatabaseName('zpan-db')).toThrow('Refusing to manage non-preview D1 database')
    expect(() => assertPreviewDatabaseName('zpan-preview-bad-')).toThrow(
      'Refusing to manage non-preview D1 database',
    )
  })

  it('patches exactly one DB binding across generated Wrangler config', () => {
    const config = {
      d1_databases: [{ binding: 'OTHER', database_name: 'other', database_id: 'other-id' }],
      env: {
        staging: {
          d1_databases: [{ binding: 'DB', database_name: 'zpan-db-staging', database_id: 'old-id' }],
        },
      },
    }

    expect(patchD1BindingConfig(config, 'zpan-preview-feature', 'new-id')).toEqual({
      d1_databases: [{ binding: 'OTHER', database_name: 'other', database_id: 'other-id' }],
      env: {
        staging: {
          d1_databases: [{ binding: 'DB', database_name: 'zpan-preview-feature', database_id: 'new-id' }],
        },
      },
    })
  })

  it('fails when generated Wrangler config has zero or multiple DB bindings', () => {
    expect(() => patchD1BindingConfig({ d1_databases: [] }, 'zpan-preview-feature', 'new-id')).toThrow(
      'Expected exactly one D1 binding named DB, found 0',
    )

    expect(() =>
      patchD1BindingConfig(
        {
          d1_databases: [{ binding: 'DB', database_name: 'one', database_id: 'one-id' }],
          env: {
            staging: {
              d1_databases: [{ binding: 'DB', database_name: 'two', database_id: 'two-id' }],
            },
          },
        },
        'zpan-preview-feature',
        'new-id',
      ),
    ).toThrow('Expected exactly one D1 binding named DB, found 2')
  })

  it('builds reviewer seed SQL that enforces the user role and credential password idempotently', () => {
    const sql = buildPreviewReviewerSeedSql({
      email: "reviewer'quoted@zpan.dev",
      passwordHash: "hash'quoted",
      userId: "user'quoted",
      accountId: "account'quoted",
      now: 1771771771771,
    })

    expect(sql).toContain("VALUES ('user''quoted', 'Preview Reviewer', 'reviewer''quoted@zpan.dev', 1, 'user', 0")
    expect(sql).toContain("role = 'user'")
    expect(sql).toContain('ON CONFLICT(email) DO UPDATE SET')
    expect(sql).toContain("SET password = 'hash''quoted'")
    expect(sql).toContain("WHERE provider_id = 'credential'")
    expect(sql).toContain("NOT EXISTS (\n    SELECT 1\n    FROM account AS a")
    expect(sql).not.toContain('BEGIN')
    expect(sql).not.toContain('COMMIT')
  })

  it('builds Wrangler commands against the generated preview config for migrate, seed, and upload', () => {
    expect(buildWranglerMigrateArgs('dist/zpan/wrangler.json')).toEqual([
      'exec',
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'DB',
      '--config',
      'dist/zpan/wrangler.json',
      '--remote',
    ])
    expect(buildWranglerExecuteFileArgs('dist/zpan/wrangler.json', '/tmp/seed.sql')).toEqual([
      'exec',
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--config',
      'dist/zpan/wrangler.json',
      '--remote',
      '--file',
      '/tmp/seed.sql',
    ])
    expect(buildWranglerVersionsUploadArgs('dist/zpan/wrangler.json', 'feature')).toEqual([
      'exec',
      'wrangler',
      'versions',
      'upload',
      '--config',
      'dist/zpan/wrangler.json',
      '--preview-alias',
      'feature',
    ])
  })

  it('prints help for empty and invalid commands', async () => {
    const harness = createHarness()

    const empty = await harness.run([])
    const invalid = await harness.run(['wat'])

    expect(empty.status).toBe(0)
    expect(empty.stdout).toContain('Usage: cloudflare-branch-preview.mjs <build|prepare|upload|deploy|cleanup>')
    expect(invalid.status).toBe(1)
    expect(invalid.stdout).toContain('Commands:')
  })

  it('builds locally without preparing a preview database', async () => {
    const harness = createHarness()

    const result = await harness.run(['build'])

    expect(result.status).toBe(0)
    expect(harness.readState().calls).toEqual([
      expect.objectContaining({
        args: ['exec', 'vite', 'build'],
        cloudflareEnv: null,
      }),
    ])
  })

  it('runs workers preview builds through vite, d1 reset, config patch, migrations, and reviewer seed', async () => {
    const branch = 'feature/Preview Isolation'
    const previewDb = previewDatabaseName(`${previewRepository}:${branch}`)
    const harness = createHarness({
      databases: [{ name: previewDb, uuid: 'old-uuid' }],
    })

    const result = await harness.run(['build', '--config', harness.configPath], {
      env: { WORKERS_CI: '1', WORKERS_CI_BRANCH: branch },
    })

    expect(result.status).toBe(0)

    const state = harness.readState()
    expect(state.calls.map((call) => call.args.slice(0, 4))).toEqual([
      ['exec', 'vite', 'build'],
      ['exec', 'wrangler', 'd1', 'list'],
      ['exec', 'wrangler', 'd1', 'delete'],
      ['exec', 'wrangler', 'd1', 'create'],
      ['exec', 'wrangler', 'd1', 'list'],
      ['exec', 'wrangler', 'd1', 'migrations'],
      ['exec', 'wrangler', 'd1', 'execute'],
    ])
    expect(state.calls[0].cloudflareEnv).toBe('staging')
    expect(harness.readConfig()).toEqual({
      name: 'zpan',
      d1_databases: [{ binding: 'DB', database_name: previewDb, database_id: 'uuid-1' }],
    })
    expect(state.executedSql).toHaveLength(1)
    expect(state.executedSql[0]).toEqual(
      expect.objectContaining({
        configPath: harness.configPath,
        sql: expect.stringContaining("role = 'user'"),
      }),
    )
    expect(state.executedSql[0].sql).toContain("reviewer@zpan.dev")
  })

  it('uploads the generated preview config without resetting D1', async () => {
    const branch = 'feature/Upload Preview'
    const harness = createHarness()

    const result = await harness.run(['upload', '--config', harness.configPath], {
      env: { WORKERS_CI_BRANCH: branch },
    })

    expect(result.status).toBe(0)
    expect(harness.readState().calls.map((call) => call.args.slice(0, 4))).toEqual([['exec', 'wrangler', 'versions', 'upload']])
    expect(harness.readState().uploads).toEqual([
      {
        configPath: harness.configPath,
        alias: previewSlug(`${previewRepository}-${branch}`),
      },
    ])
  })

  it('deploys after prepare and uploads the preview alias with the generated config', async () => {
    const branch = 'feature/Deploy Preview'
    const harness = createHarness()

    const result = await harness.run(['deploy', '--config', harness.configPath], {
      env: { WORKERS_CI_BRANCH: branch },
    })

    expect(result.status).toBe(0)
    expect(harness.readState().uploads).toEqual([
      {
        configPath: harness.configPath,
        alias: previewSlug(`${previewRepository}-${branch}`),
      },
    ])
  })

  it('cleans up preview databases idempotently', async () => {
    const branch = 'feature/Cleanup Preview'
    const previewDb = previewDatabaseName(`${previewRepository}:${branch}`)
    const harness = createHarness({
      databases: [{ name: previewDb, uuid: 'uuid-existing' }],
    })

    const first = await harness.run(['cleanup'], { env: { WORKERS_CI_BRANCH: branch } })
    const second = await harness.run(['cleanup'], { env: { WORKERS_CI_BRANCH: branch } })

    expect(first.status).toBe(0)
    expect(second.status).toBe(0)
    expect(harness.readState().databases).toEqual([])
    expect(second.stdout).toContain(`No existing preview D1 database named ${previewDb}`)
  })

  it('deletes the created preview database again when migrations fail', async () => {
    const branch = 'feature/Migrate Failure'
    const previewDb = previewDatabaseName(`${previewRepository}:${branch}`)
    const harness = createHarness()

    const result = await harness.run(['prepare', '--config', harness.configPath], {
      env: { WORKERS_CI_BRANCH: branch, FAKE_MIGRATE_FAIL: '1' },
    })

    expect(result.status).toBe(1)
    expect(result.error?.message).toContain('fake migrate failure')
    expect(harness.readState().databases).toEqual([])
    expect(harness.readState().calls.map((call) => call.args.slice(0, 4))).toEqual([
      ['exec', 'wrangler', 'd1', 'list'],
      ['exec', 'wrangler', 'd1', 'create'],
      ['exec', 'wrangler', 'd1', 'list'],
      ['exec', 'wrangler', 'd1', 'migrations'],
      ['exec', 'wrangler', 'd1', 'list'],
      ['exec', 'wrangler', 'd1', 'delete'],
    ])
    expect(harness.readConfig().d1_databases[0].database_name).toBe(previewDb)
  })

  it('deletes the created preview database again when reviewer seeding fails', async () => {
    const branch = 'feature/Seed Failure'
    const harness = createHarness()

    const result = await harness.run(['prepare', '--config', harness.configPath], {
      env: { WORKERS_CI_BRANCH: branch, FAKE_EXECUTE_FAIL: '1' },
    })

    expect(result.status).toBe(1)
    expect(result.error?.message).toContain('fake execute failure')
    expect(harness.readState().databases).toEqual([])
  })

  it('fails loudly when the created database cannot be found in wrangler list output', async () => {
    const branch = 'feature/Missing Created Database'
    const harness = createHarness()

    const result = await harness.run(['prepare', '--config', harness.configPath], {
      env: { WORKERS_CI_BRANCH: branch, FAKE_CREATE_SKIP_REGISTER: '1' },
    })

    expect(result.status).toBe(1)
    expect(result.error?.message).toContain('was not returned by wrangler d1 list')
    expect(harness.readState().calls.map((call) => call.args.slice(0, 4))).toEqual([
      ['exec', 'wrangler', 'd1', 'list'],
      ['exec', 'wrangler', 'd1', 'create'],
      ['exec', 'wrangler', 'd1', 'list'],
      ['exec', 'wrangler', 'd1', 'delete'],
    ])
    expect(harness.readState().databases).toEqual([])
  })

  it('fails loudly when wrangler d1 list returns invalid JSON', async () => {
    const branch = 'feature/Bad List JSON'
    const harness = createHarness()

    const result = await harness.run(['prepare', '--config', harness.configPath], {
      env: { WORKERS_CI_BRANCH: branch, FAKE_LIST_INVALID_JSON: '1' },
    })

    expect(result.status).toBe(1)
    expect(result.error?.message).toContain('Expected property name or')
  })

  it('falls back cleanly when git branch detection throws', async () => {
    const harness = createHarness()

    const result = await harness.run(['prepare'], {
      env: { FAKE_GIT_BRANCH_ERROR: '1' },
    })

    expect(result.status).toBe(1)
    expect(result.error?.message).toContain('A branch name is required to manage a preview database')
  })

  it('aggregates create confirmation failure with cleanup failure', async () => {
    const branch = 'feature/Create Cleanup Failure'
    const previewDb = previewDatabaseName(`${previewRepository}:${branch}`)
    const harness = createHarness()

    const result = await harness.run(['prepare', '--config', harness.configPath], {
      env: {
        WORKERS_CI_BRANCH: branch,
        FAKE_CREATE_REGISTER_WITHOUT_UUID: '1',
        FAKE_DELETE_FAIL: '1',
      },
    })

    expect(result.status).toBe(1)
    expect(result.error).toBeInstanceOf(AggregateError)
    expect(result.error?.message).toContain(`Failed to create or clean up preview D1 database: ${previewDb}`)
    expect(result.error?.errors).toHaveLength(2)
    expect(result.error?.errors[0].message).toContain('was not returned by wrangler d1 list')
    expect(result.error?.errors[1].message).toContain('fake delete failure')
  })
})
