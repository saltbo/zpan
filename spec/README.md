# Product specs

Behaviour-first product specs in Gherkin `.feature` files. This directory is the
source of truth for **what ZPan does**, independent of implementation. There is
**no Cucumber runner** — the `.feature` files are documentation, and tests trace
back to scenarios by id.

## Convention

- One `.feature` file per capability (`storages.feature`, `site-invitations.feature`, …).
- Each scenario carries two tags: the **id** `@<capability>/<slug>` and the **layer**
  that proves it (`@domain` / `@usecase` / `@web` / `@api` / `@e2e`):

  ```gherkin
  @storages/create-records-activity @api
  Scenario: Creating a storage records an audit activity
    Given an authenticated admin
    When they create a storage
    Then a storage_create activity is recorded
  ```

- The id never changes once written (rename = new id).
- Verify each scenario at the **cheapest layer that can prove it.** In this repo most
  land at `@api` (the workerd + real-D1 `*.integration.test.ts` / `*.cf-test.ts`
  flows through `app.fetch`) or `@web` (jsdom + MSW). Reserve `@e2e` for the Playwright
  cross-stack journeys. Pure rules sit at `@domain` / `@usecase`.

## Traceability

Each scenario's home test carries `[spec: <id>]` in its name:

```ts
it('records a storage_create activity [spec: storages/create-records-activity]', …)
```

`pnpm lint:spec` (wired into CI) enforces the link both ways: every scenario id must
have a referencing test, and every `[spec: id]` breadcrumb must match a real scenario.

## Status

Specs are authored capability-by-capability alongside the clean-architecture
migration (see `docs/clean-arch-migration.md`). Migrated capabilities are specced
and traced here; the rest land as their slices migrate.

## Escalation

If a non-technical audience ever needs to *run* the Gherkin, wire `playwright-bdd`
(compiles `.feature` → Playwright). These are real `.feature` files, so that step is
drop-in — no rewrite.
