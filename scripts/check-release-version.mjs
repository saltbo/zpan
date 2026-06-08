import packageJson from '../package.json' with { type: 'json' }

const tag = process.env.GITHUB_REF_NAME || process.argv[2]
if (!tag) {
  throw new Error('Release tag is required. Pass it as argv[2] or set GITHUB_REF_NAME.')
}

const expectedTag = `v${packageJson.version}`
if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match package.json version ${packageJson.version}. Expected ${expectedTag}.`)
}

console.log(`Release version verified: ${tag}`)
