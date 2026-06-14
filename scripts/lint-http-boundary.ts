#!/usr/bin/env tsx
/**
 * lint:http — enforces that http/ handlers never reach into infrastructure
 * directly. The dependency rule for this layer (hono-cf-clean-arch) is:
 *
 *   http/ only validates input, calls a usecase, and serializes the result.
 *
 * dependency-cruiser enforces the *import* side (http must not import
 * adapters/drizzle). But the real leak in this codebase is at *runtime*:
 * handlers pull ports off the request-scoped deps object and orchestrate
 * business logic inline — `c.get('deps').share.create(...)`. That is invisible
 * to an import-graph linter, so we walk the AST here.
 *
 * Rule: inside server/http, the deps object (obtained via `c.get('deps')`) may
 * only be passed *whole* to a usecase function. Reaching into a port on it —
 * `deps.<port>.<method>(...)`, `c.get('deps').<port>`, or destructuring a port
 * out of it — is forbidden. The business logic must live in a usecase.
 *
 * Migration ratchet (mirrors the drizzle ratchet the clean-arch migration
 * used): RATCHET lists handlers not yet converted. CI fails on any violation
 * outside the ratchet, and also fails if a ratcheted file has become clean — so
 * the list only ever shrinks. Remove a file from RATCHET in the same commit that
 * converts it. When RATCHET is empty the boundary is fully locked.
 *
 *   pnpm lint:http          # enforce (CI)
 *   pnpm lint:http --list   # print every violator + count (to maintain RATCHET)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const HTTP_DIR = join(ROOT, 'server/http')

// Handlers still containing direct deps.<port> access. Shrinks to empty as each
// resource is converted to the usecase-per-resource convention. Paths are
// repo-relative with forward slashes.
const RATCHET: ReadonlySet<string> = new Set<string>([
  'server/http/objects.ts',
  'server/http/redirect.ts',
  'server/http/shares.ts',
  'server/http/traffic-metering-utils.ts',
  'server/http/webdav.ts',
])

type Violation = { file: string; line: number; col: number; text: string }

function listHttpFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listHttpFiles(full))
      continue
    }
    if (!entry.endsWith('.ts')) continue
    if (entry.includes('.test.') || entry.includes('.e2e.') || entry.includes('.spec.')) continue
    out.push(full)
  }
  return out
}

function unwrap(node: ts.Expression): ts.Expression {
  let n: ts.Expression = node
  while (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n)) n = n.expression
  return n
}

// `c.get('deps')` — a call to `<x>.get('deps')`.
function isDepsSource(node: ts.Expression): boolean {
  const n = unwrap(node)
  if (!ts.isCallExpression(n)) return false
  const callee = n.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'get') return false
  const arg = n.arguments[0]
  return !!arg && ts.isStringLiteralLike(arg) && arg.text === 'deps'
}

function scanFile(absPath: string): Violation[] {
  const rel = relative(ROOT, absPath).replaceAll('\\', '/')
  const source = ts.createSourceFile(absPath, readFileSync(absPath, 'utf8'), ts.ScriptTarget.Latest, true)
  const depsAliases = new Set<string>()
  const violations: Violation[] = []

  const at = (node: ts.Node) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
    return { line: line + 1, col: character + 1 }
  }
  const report = (node: ts.Node, text: string) => {
    const { line, col } = at(node)
    violations.push({ file: rel, line, col, text })
  }

  // Pass 1: collect identifiers bound to a deps source, and flag any attempt to
  // destructure ports straight out of deps.
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && isDepsSource(node.initializer)) {
      if (ts.isIdentifier(node.name)) depsAliases.add(node.name.text)
      else report(node.name, `destructuring ports out of deps (\`${node.name.getText(source)}\`)`)
    }
    ts.forEachChild(node, collect)
  }
  collect(source)

  // Pass 2: flag every property access that reaches into a port on deps.
  const check = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const obj = unwrap(node.expression)
      if (isDepsSource(obj)) report(node, `c.get('deps').${node.name.text} — call a usecase instead`)
      else if (ts.isIdentifier(obj) && depsAliases.has(obj.text))
        report(node, `${obj.text}.${node.name.text} — call a usecase instead`)
    }
    ts.forEachChild(node, check)
  }
  check(source)

  return violations
}

function main(): void {
  const listMode = process.argv.includes('--list')
  const files = listHttpFiles(HTTP_DIR).sort()
  const byFile = new Map<string, Violation[]>()
  for (const file of files) {
    const v = scanFile(file)
    if (v.length) byFile.set(relative(ROOT, file).replaceAll('\\', '/'), v)
  }

  if (listMode) {
    let total = 0
    for (const [file, v] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`${String(v.length).padStart(4)}  ${file}`)
      total += v.length
    }
    console.log(`\n${total} direct deps.<port> access(es) across ${byFile.size} handler file(s).`)
    return
  }

  const offenders: Violation[] = []
  for (const [file, v] of byFile) {
    if (!RATCHET.has(file)) offenders.push(...v)
  }
  // Stale ratchet entries: listed but now clean — must be removed so the list
  // only shrinks.
  const stale = [...RATCHET].filter((f) => !byFile.has(f)).sort()

  if (offenders.length === 0 && stale.length === 0) {
    console.log(
      RATCHET.size === 0
        ? 'lint:http: http boundary fully locked — no handler reaches into deps ports.'
        : `lint:http: OK — ${RATCHET.size} handler(s) still ratcheted, no new violations.`,
    )
    return
  }

  if (offenders.length) {
    console.error('lint:http: business logic in http handlers — move it into a usecase.\n')
    for (const v of offenders.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.error(`  ${v.file}:${v.line}:${v.col}  ${v.text}`)
    }
  }
  if (stale.length) {
    console.error('\nlint:http: these files are in RATCHET but now clean — remove them from RATCHET:')
    for (const f of stale) console.error(`  ${f}`)
  }
  process.exit(1)
}

main()
