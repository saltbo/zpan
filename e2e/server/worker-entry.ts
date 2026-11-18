// E2E-only Workers entry, selected by vite.config.ts for `vite dev` E2E runs only.
import './trust-cloud-fake-key'

export { default } from '../../workers/bootstrap'
