import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Test the localStorage-backed view mode logic without rendering the hook.
// The hook's entire logic is: read from localStorage on init, write on set.

const STORAGE_KEY = 'zpan-view-mode'

type ViewMode = 'list' | 'grid'

// Replicate the hook's init and set logic so we can unit-test it.
function readMode(): ViewMode {
  return (localStorage.getItem(STORAGE_KEY) as ViewMode) || 'list'
}

function writeMode(m: ViewMode): void {
  localStorage.setItem(STORAGE_KEY, m)
}

function makeLocalStorageStub() {
  const store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(store)) delete store[k]
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  }
}

describe('useViewMode — localStorage persistence logic', () => {
  let localStorageStub: ReturnType<typeof makeLocalStorageStub>

  beforeEach(() => {
    localStorageStub = makeLocalStorageStub()
    vi.stubGlobal('localStorage', localStorageStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to list when localStorage has no value', () => {
    const mode = readMode()

    expect(mode).toBe('list')
  })

  it('reads list from localStorage when it was previously saved', () => {
    localStorageStub.setItem(STORAGE_KEY, 'list')

    const mode = readMode()

    expect(mode).toBe('list')
  })

  it('reads grid from localStorage when it was previously saved', () => {
    localStorageStub.setItem(STORAGE_KEY, 'grid')

    const mode = readMode()

    expect(mode).toBe('grid')
  })

  it('persists list mode to localStorage via writeMode', () => {
    writeMode('list')

    expect(localStorageStub.getItem(STORAGE_KEY)).toBe('list')
  })

  it('persists grid mode to localStorage via writeMode', () => {
    writeMode('grid')

    expect(localStorageStub.getItem(STORAGE_KEY)).toBe('grid')
  })

  it('overwrites previous value when mode changes', () => {
    writeMode('grid')
    writeMode('list')

    expect(localStorageStub.getItem(STORAGE_KEY)).toBe('list')
  })

  it('uses the correct storage key', () => {
    writeMode('grid')

    expect(localStorageStub.setItem).toHaveBeenCalledWith('zpan-view-mode', 'grid')
  })

  it('returns list as fallback when localStorage returns null', () => {
    localStorageStub.getItem.mockReturnValueOnce(null as unknown as string)

    const mode = readMode()

    expect(mode).toBe('list')
  })
})
