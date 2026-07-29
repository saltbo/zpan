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

requireMatch('Restish v2.3 or later', /Restish v2\.3(?:\+| or later)/i)
requireText('connect exactly /api/openapi.json', '/api/openapi.json')
requireText('plugin install command', 'restish plugin install saltbo/zpan zpan')
requireText('upload command surface', 'restish zpan-upload')

for (const operationId of [
  'listObjects',
  'getObject',
  'createObject',
  'presignObjectUploadParts',
  'completeObjectUpload',
  'abortObjectUpload',
  'updateObject',
  'copyObject',
  'transferObject',
  'deleteObject',
  'purgeTrashObject',
  'listShares',
  'createShare',
  'revokeShare',
  'getUserQuota',
  'getStorageUsage',
  'listDownloadTasks',
  'getDownloadTask',
  'listDownloadTaskEvents',
]) {
  requireText(`generated operation ${operationId}`, operationId)
}

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
forbidMatch(
  'MCP upload control-plane allowlist',
  /restish\s+mcp\s+serve[\s\S]*?--operations[^\n]*(createObject|presignObjectUploadParts|completeObjectUpload|abortObjectUpload)/gi,
)

if (failures.length > 0) {
  console.error(`ZPan Skill static contract failed with ${failures.length} finding(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`ZPan Skill static contract passed (${documents.length} markdown files checked)`)
