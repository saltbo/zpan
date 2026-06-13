/**
 * Architecture enforcement for the hono-cf-clean-arch layout.
 *
 *   pnpm lint:arch
 *
 * The `drizzle-only-in-repos` rule below carries a RATCHET: a shrinking allowlist
 * of files that still import drizzle outside adapters/repos because they have not
 * been migrated yet (see docs/clean-arch-migration.md). Every migration commit
 * removes entries from MIGRATION_PENDING. When it is empty, delete it — the
 * architecture is then fully locked.
 *
 * Permanent exceptions (NOT part of the ratchet):
 *  - server/db            : the schema + client live here by definition
 *  - server/platform      : the runtime DB/env/binding abstraction owns the
 *                           `Database` driver type
 *  - server/auth.ts       : better-auth owns its own tables and serves requests
 *  - server/test          : test harness/helpers (the suites are exempt anyway)
 */

// --- RATCHET: the last two files that still touch drizzle outside adapters/repos.
// The legacy services/ dir is fully migrated and gone. These two are deliberate
// deferrals, each a self-contained slice; drop the entry when its drizzle moves
// into a repo and the architecture is then fully locked.
const MIGRATION_PENDING = [
  '^server/http/webdav\\.ts', // inline listDescendants/proppatch drizzle in the WebDAV route
  '^server/middleware/auth\\.ts', // session + disabled-user lookup in the auth middleware
].join('|')
// -----------------------------------------------------------------------------

const DRIZZLE_ALLOWED = `^server/(adapters/repos|db|platform|test)|^server/auth\\.ts|${MIGRATION_PENDING}`

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      // Fully enforced: the legacy services/ dir (which carried a pre-existing
      // user <-> org-entitlements cycle) is migrated and gone, so no path is exempt.
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-stays-pure',
      comment: 'domain/ may only import domain/ and shared/. No frameworks, no I/O.',
      severity: 'error',
      from: { path: '^server/domain' },
      to: { pathNot: '^server/domain|^shared' },
    },
    {
      name: 'usecases-no-infrastructure',
      comment: 'usecases/ must not reach outward to adapters, http, db, or composition.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: '^server/(adapters|http|db)|^server/composition' },
    },
    {
      name: 'usecases-no-framework-packages',
      comment: 'usecases/ must not import delivery or persistence frameworks.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: 'node_modules/(hono|drizzle-orm|better-auth)' },
    },
    {
      name: 'adapters-not-into-delivery',
      comment: 'adapters/ implement ports; they never know about http/ or composition.',
      severity: 'error',
      from: { path: '^server/adapters' },
      to: { path: '^server/(http|composition)' },
    },
    {
      name: 'drizzle-only-in-repos',
      comment: 'Persistence is confined to adapters/repos/ and db/ (+ ratchet allowlist).',
      severity: 'error',
      from: { path: '^server', pathNot: DRIZZLE_ALLOWED },
      to: { path: 'node_modules/drizzle-orm|^server/db/(schema|auth-schema)' },
    },
    {
      name: 'http-not-into-adapters',
      comment: 'http/ gets dependencies from context, never constructs adapters.',
      severity: 'error',
      from: { path: '^server/http' },
      to: { path: '^server/adapters' },
    },
    {
      name: 'shared-is-a-leaf',
      comment: 'shared/ is the contract; it imports nothing from server/ or src/.',
      severity: 'error',
      from: { path: '^shared' },
      to: { path: '^server|^src' },
    },
    {
      name: 'frontend-not-into-server',
      comment: 'The SPA talks to the server over HTTP only.',
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^server' },
    },
    {
      name: 'server-not-into-frontend',
      comment: 'The server never reaches into the SPA; the two halves meet only through shared/.',
      severity: 'error',
      from: { path: '^server' },
      to: { path: '^src' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['\\.(test|spec)\\.[jt]sx?$', '\\.(integration|cf-test|libsql-test)\\.[jt]sx?$', '\\.gen\\.[jt]s$'] },
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    tsPreCompilationDeps: true,
  },
}
