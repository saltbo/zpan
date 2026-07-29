#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SKILL_DIR = join(ROOT, 'skills', 'zpan')

function walkMarkdown(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) files.push(...walkMarkdown(full))
    else if (name.endsWith('.md')) files.push(full)
  }
  return files.sort()
}

const files = walkMarkdown(SKILL_DIR)
const documents = files.map((file) => ({
  file,
  rel: relative(ROOT, file),
  text: readFileSync(file, 'utf8'),
}))
const corpus = documents.map((doc) => doc.text).join('\n\n')
const normalizedCorpus = corpus.toLowerCase()
const failures = []

function requireMatch(label, pattern) {
  if (!pattern.test(corpus)) failures.push(`missing required contract: ${label}`)
}

function requireText(label, text) {
  if (!normalizedCorpus.includes(text.toLowerCase())) {
    failures.push(`missing required contract: ${label}`)
  }
}

function forbidMatch(label, pattern) {
  for (const doc of documents) {
    for (const match of doc.text.matchAll(pattern)) {
      const line = doc.text.slice(0, match.index).split('\n').length
      failures.push(`forbidden contract text: ${label} (${doc.rel}:${line})`)
    }
  }
}

function forbidUnsafeLine(label, pattern) {
  const safePrefix = /\b(do not|don't|never|must not|not|no)\b/i
  for (const doc of documents) {
    const lines = doc.text.split('\n')
    lines.forEach((lineText, index) => {
      if (pattern.test(lineText) && !safePrefix.test(lineText)) {
        failures.push(`unsafe contract guidance: ${label} (${doc.rel}:${index + 1})`)
      }
    })
  }
}

function requireCommandLine(label, pattern) {
  const commandLines = corpus
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('restish '))
  if (!commandLines.some((line) => pattern.test(line))) {
    failures.push(`missing executable command example: ${label}`)
  }
}

function validateSkillFrontmatter() {
  const skill = documents.find((doc) => doc.rel === 'skills/zpan/SKILL.md')
  if (!skill) {
    failures.push('missing skills/zpan/SKILL.md')
    return
  }
  const match = skill.text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!match) {
    failures.push('missing Skill YAML frontmatter')
    return
  }
  const keys = [...match[1].matchAll(/^([A-Za-z0-9_-]+):/gm)].map((entry) => entry[1])
  const extras = keys.filter((key) => key !== 'name' && key !== 'description')
  if (extras.length > 0) {
    failures.push(`unsupported Skill frontmatter key(s): ${extras.join(', ')}`)
  }
}

validateSkillFrontmatter()

requireMatch('Restish v2.3 or later', /Restish v2\.3(?:\+| or later)/i)
requireText('connect exactly /api/openapi.json', '/api/openapi.json')
requireText('plugin install command', 'restish plugin install saltbo/zpan zpan')
requireText('upload command surface', 'restish zpan-upload')

for (const command of [
  'list-objects',
  'get-object',
  'create-object',
  'update-object',
  'copy-object',
  'transfer-object',
  'delete-object',
  'purge-trash-object',
  'list-shares',
  'create-share',
  'revoke-share',
  'get-user-quota',
  'get-storage-usage',
  'list-download-tasks',
  'get-download-task',
  'list-download-task-events',
]) {
  requireCommandLine(`restish zpan ${command}`, new RegExp(`\\brestish\\s+(?:--rsh-profile\\s+\\S+\\s+)?zpan\\s+${command}\\b`))
}

for (const operationId of ['createObject', 'presignObjectUploadParts', 'completeObjectUpload', 'abortObjectUpload']) {
  requireText(`upload plugin validates ${operationId}`, operationId)
}

requireCommandLine('list pagination uses --page-size', /\bzpan\s+list-objects\b.*\s--page-size\s+\d+/)
requireCommandLine('share pagination uses --page-size', /\bzpan\s+list-shares\b.*\s--page-size\s+\d+/)
requireCommandLine('task pagination uses --page-size', /\bzpan\s+list-download-tasks\b.*\s--page-size\s+\d+/)
requireCommandLine('create-object uses positional body input', /\bzpan\s+create-object\s+'[^']*\bname:/)
requireCommandLine('update-object uses positional body input', /\bzpan\s+update-object\s+\S+\s+'[^']*\bname:/)
requireCommandLine('copy-object uses positional body input', /\bzpan\s+copy-object\s+\S+\s+'[^']*\bparent:/)
requireCommandLine('transfer-object uses positional body input', /\bzpan\s+transfer-object\s+\S+\s+'[^']*\btargetOrgId:/)
requireCommandLine('create-share uses positional body input', /\bzpan\s+create-share\s+'[^']*\bmatterId:/)
requireCommandLine('revoke-share uses positional body input', /\bzpan\s+revoke-share\s+\S+\s+'[^']*\bstatus:\s*revoked/)
requireCommandLine('upload passes Restish and plugin profiles', /\brestish\s+--rsh-profile\s+\S+\s+zpan-upload\b.*\s--api\s+zpan\b.*\s--profile\s+\S+/)

requireText('reader profile', '`reader`')
requireText('file-manager profile', '`file-manager`')
requireText('publisher profile', '`publisher`')
requireText('ci profile', '`ci`')
requireMatch('least-privilege profile selection', /(least-privilege|narrowest) profile/i)
requireText('objects read scope', 'objects:read')
requireText('objects write scopes', 'objects:create')
requireText('share publishing scopes', 'shares:create')
requireText('environment-backed Agent API key', 'Environment-backed')

requireMatch('OAuth authorization code with PKCE', /OAuth authorization code \+ PKCE|authorization code\s*\+\s*PKCE/i)
requireMatch('CI Agent API key guidance', /CI[\s\S]{0,240}Agent API key|Agent API key[\s\S]{0,240}CI/i)

requireMatch('confirm target workspace', /confirm[\s\S]{0,120}workspace/i)
requireMatch('confirm conflict policy', /confirm[\s\S]{0,160}(conflict|overwrite|replace)/i)
requireMatch('confirm destructive delete', /confirm[\s\S]{0,160}(destructive|soft delete|delet)/i)
requireMatch('confirm permanent purge', /confirm[\s\S]{0,160}(purge|permanent)/i)
requireMatch('confirm public sharing', /confirm[\s\S]{0,160}public share/i)
requireMatch(
  'confirm plugin executable trust',
  /(?:confirm|ask)[\s\S]{0,200}(trusted local executable|executable Restish plugin|plugin trust)/i,
)

forbidMatch('agent OpenAPI document', /\/api\/openapi\.agent\.json/gi)
forbidMatch('standalone zpan file CLI', /standalone\s+`?zpan`?\s+file CLI/gi)

const openApiDocs = [...corpus.matchAll(/\/api\/openapi(?:\.[a-z0-9-]+)?\.json/gi)].map((match) => match[0])
for (const doc of openApiDocs) {
  if (doc !== '/api/openapi.json') {
    failures.push(`OpenAPI document must be exactly /api/openapi.json, found ${doc}`)
  }
}

forbidUnsafeLine('bearer-token paste flow', /\b(paste|copy\/paste|copy paste)\b.*\bbearer token\b/i)
forbidUnsafeLine('Agent device login as v2.9 flow', /\b(device authorization|device login|device flow)\b.*\bv2\.9\b/i)
forbidUnsafeLine('Skill-handled multipart orchestration', /\b(Skill|agent)\b.*\b(orchestrate|handle|implement)\b.*\bmultipart\b/i)
forbidUnsafeLine('Skill-handled ETag retry loop', /\b(Skill|agent)\b.*\b(ETag|ETags)\b.*\b(retry|retries|loop|loops)\b/i)
forbidUnsafeLine('presigned URL exposure', /\b(expose|return|print|show)\b.*\bpresigned URLs?\b/i)
forbidMatch('silent plugin install approval', /restish\s+plugin\s+install\s+saltbo\/zpan\s+zpan[^\n]*--yes/gi)
forbidMatch('old Restish list limit flag', /\brestish\s+(?:--rsh-profile\s+\S+\s+)?zpan\s+(?:list-objects|list-shares|list-download-tasks)\b[^\n]*\s--limit\b/gi)
forbidMatch('camelCase Restish command example', /\brestish\s+(?:--rsh-profile\s+\S+\s+)?zpan\s+(?:listObjects|getObject|createObject|updateObject|copyObject|transferObject|deleteObject|purgeTrashObject|listShares|createShare|revokeShare|getUserQuota|getStorageUsage|listDownloadTasks|getDownloadTask|listDownloadTaskEvents)\b/gi)
forbidMatch('profile template purge command', /\brestish\s+--rsh-profile\s+(?:reader|file-manager|publisher|ci)\s+zpan\s+purge-trash-object\b/gi)
forbidMatch('upload without plugin profile', /\brestish\s+--rsh-profile\s+\S+\s+zpan-upload\b(?![^\n]*\s--profile\s+\S+)/gi)
forbidMatch(
  'MCP upload control-plane allowlist',
  /restish\s+mcp\s+serve[\s\S]*?--operations[^\n]*(createObject|create-object|presignObjectUploadParts|presign-object-upload-parts|completeObjectUpload|complete-object-upload|abortObjectUpload|abort-object-upload)/gi,
)

if (failures.length > 0) {
  console.error(`ZPan Skill static contract failed with ${failures.length} finding(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`ZPan Skill static contract passed (${documents.length} markdown files checked)`)
