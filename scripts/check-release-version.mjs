import packageJson from '../package.json' with { type: 'json' }

const tag = process.env.GITHUB_REF_NAME || process.argv[2]
if (!tag) {
  throw new Error('Release tag is required. Pass it as argv[2] or set GITHUB_REF_NAME.')
}

const expectedTag = `v${packageJson.version}`
if (tag !== expectedTag) {
  const version = tag.replace(/^v/, '')
  console.error(`
✖ Release tag ${tag} does not match package.json version ${packageJson.version}.

This usually means the tag was created by hand without bumping package.json.
Don't tag manually — use the release script, which bumps package.json, commits,
and tags in one step:

    pnpm release ${version}
    git push origin master ${tag}

To recover from this failed release, delete the bad tag and redo it properly:

    git tag -d ${tag}
    git push origin :refs/tags/${tag}
    pnpm release ${version}
    git push origin master ${tag}
`)
  process.exit(1)
}

console.log(`Release version verified: ${tag}`)
