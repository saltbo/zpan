# Cloudflare branch preview databases

## Requirements

- While Cloudflare Workers Builds is building a non-production branch, the
  preview must use a D1 database that no other branch or production deployment
  uses.
- When a branch is rebuilt, its database must start empty, receive every
  committed migration, and receive the same reviewer account seed.
- If database creation, migration, seeding, or application build fails, Workers
  Builds must fail before uploading a new preview version.
- When a pull request closes, its branch database must be deleted. Maintainers
  must also have an idempotent manual cleanup command.

## Architecture

### Frontend

The application UI is unchanged. Cloudflare publishes a stable preview alias
derived from the repository and branch, then posts its URL to pull requests.

### Backend and data

`pnpm build` detects a non-main Workers Builds run from `WORKERS_CI=1` and
`WORKERS_CI_BRANCH`. It builds with the staging environment and then:

1. derives a 32-character-or-shorter D1 name from the repository, a sanitized
   branch prefix, and a SHA-256 suffix;
2. deletes any previous database with that exact name;
3. creates a new database and patches only the in-memory build copy of the
   staging D1 binding;
4. applies every migration in `migrations/`;
5. seeds the documented non-production reviewer account with deterministic IDs;
6. patches the generated deploy configuration with the new database UUID.

The subsequent `pnpm preview:d1:upload` uses only the generated configuration.
Preparation deletes a newly created database if creation cannot be confirmed or
if migration, seed, or config patching fails.

The PR-close workflow derives the same database name from the event's head
repository and branch, then deletes it.
`ZPAN_PREVIEW_NAME=<branch> pnpm preview:d1:cleanup` performs the same
idempotent cleanup manually. The repository identity comes from `origin`;
`ZPAN_PREVIEW_REPOSITORY=<owner/repo>` overrides it when needed.

### Security

- Production's D1 UUID is never changed or passed to preview lifecycle code.
- Database lookup and deletion use an exact deterministic name; branch text is
  sanitized and passed to Wrangler without a shell.
- Repository identity is part of the database hash, so equal branch names from
  different forks cannot reset or delete one another's preview data.
- Repository identity is also part of the preview alias, so equal branch names
  from different forks cannot overwrite one another's preview version.
- The seeded reviewer credential is the already-public, non-production
  credential documented in `CONTRIBUTING.md`. No production or private
  credential is copied into preview data.
- The PR-close workflow uses `pull_request_target` only to run trusted base
  branch code. It never checks out or executes pull-request code.
- Preview URLs remain public because anonymous profile acceptance is required.
  They must never contain production data or secrets.

## Cloudflare configuration

Workers Builds must use a user API token that includes:

- Account / D1 / Edit
- Account / Workers Scripts / Edit
- the existing Workers Builds permissions

Cloudflare's automatically generated build token does not include D1 access.
Selecting a token without D1 Edit intentionally makes preview preparation fail
instead of deploying code against stale shared schema.

The existing Workers Builds commands remain:

- Build command: `pnpm build`
- Non-production deploy command: `pnpm preview:d1:upload`

## Acceptance evidence

A schema-changing pull request must record:

- the successful isolated database reset, migration, seed, and Workers build;
- the stable Cloudflare branch preview URL;
- authenticated mutation HTTP statuses;
- anonymous public output;
- screenshots of the golden path and relevant privacy/availability edge cases;
- cleanup confirmation after the preview is no longer needed.

For curated profile shares, the required live journey is: sign in as the
reviewer, create a folder and nested folder, create a landing share with profile
listing enabled, verify the anonymous profile card, navigate the nested landing
folder, unlist the share, verify it disappears publicly, and verify the original
landing URL still works.
