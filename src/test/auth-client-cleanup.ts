import { cleanStores, type ReadableAtom } from 'nanostores'
import { afterAll, vi } from 'vitest'

// better-auth keeps the session in nanostores atoms. When the last component
// using one unmounts, nanostores runs the atom's teardown 1 second later, and
// that teardown calls window.removeEventListener. A file that finishes inside
// that second has its jsdom window removed first, so the timer throws
// "ReferenceError: window is not defined" as an unhandled error (issue #681).
// Wrap the real auth client so every file that loads it runs that teardown
// while jsdom still exists. A file's own vi.mock('@/lib/auth-client') replaces
// this wrapper, and then no real atoms are loaded.
const authAtoms = vi.hoisted(() => [] as ReadableAtom[])

vi.mock('@/lib/auth-client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth-client')>()
  // $store sits behind better-auth's path proxy, so read the atom by name:
  // the session atom is the one whose teardown touches window.
  authAtoms.push(mod.authClient.$store.atoms.session as ReadableAtom)
  return mod
})

afterAll(() => {
  cleanStores(...authAtoms)
  authAtoms.length = 0
})
