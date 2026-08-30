import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import ts from '@typescript/typescript6'

const ROOT = resolve(import.meta.dirname, '..')
const PRODUCTION_ROOTS = ['server', 'shared', 'src', 'workers', 'scripts']
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs'])
const TEST_FILE = /\.(?:test|integration\.test|cf-test|libsql-test)\.[cm]?[jt]sx?$/

export function findDefaultNanoidCalls(source) {
  const file = ts.createSourceFile('id-generation.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const directBindings = new Set(['nanoid'])
  const namespaceBindings = new Set()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'nanoid') continue
    const clause = statement.importClause
    if (!clause) continue
    if (clause.name) directBindings.add(clause.name.text)
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      namespaceBindings.add(clause.namedBindings.name.text)
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === 'nanoid') directBindings.add(element.name.text)
      }
    }
  }

  const findings = []
  const lines = source.split('\n')
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const direct = ts.isIdentifier(node.expression) && directBindings.has(node.expression.text)
      const namespace =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'nanoid' &&
        ts.isIdentifier(node.expression.expression) &&
        namespaceBindings.has(node.expression.expression.text)
      if (direct || namespace) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
        findings.push({ line: line + 1, source: lines[line]?.trim() ?? '' })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return findings
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name)) || TEST_FILE.test(entry.name)) return []
    return [path]
  })
}

export function lintIdGeneration(root = ROOT) {
  return PRODUCTION_ROOTS.flatMap((directory) => sourceFiles(join(root, directory)))
    .filter((path) => resolve(path) !== resolve(import.meta.filename))
    .flatMap((path) =>
      findDefaultNanoidCalls(readFileSync(path, 'utf8')).map((finding) => ({
        path: relative(root, path),
        ...finding,
      })),
    )
}

function main() {
  const findings = lintIdGeneration()
  if (findings.length === 0) return
  for (const finding of findings) console.error(`${finding.path}:${finding.line}: ${finding.source}`)
  throw new Error(`default_nanoid_generation_forbidden:${findings.length}`)
}

if (process.argv[1] && statSync(process.argv[1]).isFile() && resolve(process.argv[1]) === resolve(import.meta.filename)) main()
