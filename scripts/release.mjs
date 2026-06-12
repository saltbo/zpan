import { execFileSync } from 'node:child_process'

const rawVersion = process.argv[2]?.trim()
if (!rawVersion) {
  throw new Error('Usage: pnpm release <version>, for example pnpm release 2.7.3')
}

const version = rawVersion.replace(/^v/, '')
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid semver version: ${rawVersion}`)
}

const tag = `v${version}`
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
if (status) {
  throw new Error('Working tree must be clean before creating a release.')
}

execFileSync('pnpm', ['version', version, '--no-git-tag-version'], { stdio: 'inherit' })
execFileSync('git', ['add', 'package.json'], { stdio: 'inherit' })
execFileSync('git', ['commit', '-m', `chore(release): ${tag}`], { stdio: 'inherit' })
execFileSync('git', ['tag', tag], { stdio: 'inherit' })

console.log(`Created release commit and tag ${tag}. Push with: git push origin main ${tag}`)
