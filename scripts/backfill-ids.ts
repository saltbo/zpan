import { writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import {
  applyBackfill,
  backfillPlanDigest,
  createBackfillPlan,
  finalizeBackfill,
  inspectBackfill,
  pendingBackfillDigest,
  rollbackBackfill,
} from './id-backfill-core'

interface Options {
  database: string
  mode: 'dry-run' | 'apply' | 'rollback' | 'finalize'
  planFile?: string
  batchFile?: string
  mappingFile?: string
  confirmInvalidation: boolean
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

function parseOptions(argv: string[]): Options {
  const database = valueAfter(argv, '--sqlite')
  if (!database) usage()
  const modes = ['--apply', '--rollback', '--finalize'].filter((flag) => argv.includes(flag))
  if (modes.length > 1) usage()
  return {
    database,
    mode: modes[0]?.slice(2) as Options['mode'] | undefined ?? 'dry-run',
    planFile: valueAfter(argv, '--plan-file'),
    batchFile: valueAfter(argv, '--batch-file'),
    mappingFile: valueAfter(argv, '--mapping-file'),
    confirmInvalidation: argv.includes('--confirm-credential-invalidation'),
  }
}

function usage(): never {
  throw new Error(
    'Usage: pnpm ids:backfill -- --sqlite <export.sqlite> [--apply|--rollback|--finalize] [--confirm-credential-invalidation] [--plan-file <sql>] [--batch-file <json>] [--mapping-file <json>]',
  )
}

function writePrivate(path: string, contents: string): void {
  writeFileSync(path, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
}

function main(): void {
  const options = parseOptions(process.argv.slice(2))
  const db = new Database(options.database, options.mode === 'dry-run' ? { readonly: true } : undefined)
  try {
    db.pragma('foreign_keys = ON')
    if (options.mode === 'rollback') {
      const after = rollbackBackfill(db)
      console.log(JSON.stringify({ mode: 'rollback-complete', after }, null, 2))
      return
    }
    if (options.mode === 'finalize') {
      finalizeBackfill(db)
      console.log(JSON.stringify({ mode: 'finalize-complete' }, null, 2))
      return
    }
    if (options.mode === 'apply' && pendingBackfillDigest(db)) {
      const after = applyBackfill(db)
      console.log(JSON.stringify({ mode: 'apply-already-complete', after }, null, 2))
      return
    }

    const plan = createBackfillPlan(db)
    console.log(JSON.stringify({ mode: options.mode, before: plan.before, statements: plan.sql.length }, null, 2))
    if (options.planFile) writePrivate(options.planFile, `${plan.sql.join('\n')}\n`)
    if (options.batchFile) {
      const digest = backfillPlanDigest(plan)
      writePrivate(options.batchFile, `${JSON.stringify({ version: 1, digest, statements: plan.sql }, null, 2)}\n`)
    }
    if (options.mappingFile) writePrivate(options.mappingFile, `${JSON.stringify(plan.mappings, null, 2)}\n`)
    if (options.mode === 'dry-run') return
    if (plan.before.credentialsToInvalidate > 0 && !options.confirmInvalidation) {
      throw new Error('credential_invalidation_confirmation_required')
    }
    const after = applyBackfill(db, plan)
    console.log(JSON.stringify({ mode: 'apply-complete', before: plan.before, after }, null, 2))
  } finally {
    db.close()
  }
}

main()
