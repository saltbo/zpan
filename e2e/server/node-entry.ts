// E2E-only Node server entry (see playwright.config.ts).
import './trust-cloud-fake-key'

await import('../../server/entry-node')
