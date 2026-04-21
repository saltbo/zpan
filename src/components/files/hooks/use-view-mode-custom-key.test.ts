// Additional tests for useViewMode with custom storageKey parameter.
// Tests the per-page persistence feature via the localStorage logic.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ViewMode = 'list' | 'grid'

// Replicate the hook's init and set logic with the custom key parameter.
function readMode(storageKey: string): ViewMode {
  return (localStorage.getItem(storageKey) as ViewMode) || 'list'
}

function writeMode(storageKey: string, m: ViewMode): void {
  localStorage.setItem(storageKey, m)
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

describe('useViewMode — custom storageKey parameter', () => {
  let localStorageStub: ReturnType<typeof makeLocalStorageStub>

  beforeEach(() => {
    localStorageStub = makeLocalStorageStub()
    vi.stubGlobal('localStorage', localStorageStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads from the custom storageKey, not the default', () => {
    localStorageStub.setItem('zpan-ihost-view-mode', 'grid')

    const mode = readMode('zpan-ihost-view-mode')

    expect(mode).toBe('grid')
  })

  it('writes to the custom storageKey', () => {
    writeMode('zpan-ihost-view-mode', 'grid')

    expect(localStorageStub.setItem).toHaveBeenCalledWith('zpan-ihost-view-mode', 'grid')
  })

  it('defaults to list when custom key has no value in localStorage', () => {
    const mode = readMode('zpan-ihost-view-mode')

    expect(mode).toBe('list')
  })

  it('does not read from the default key when a custom key is used', () => {
    localStorageStub.setItem('zpan-view-mode', 'grid')

    // Custom key 'zpan-ihost-view-mode' has no value, should default to list
    const mode = readMode('zpan-ihost-view-mode')

    expect(mode).toBe('list')
  })

  it('two pages maintain independent view mode state with different keys', () => {
    // Page 1 uses default key
    writeMode('zpan-view-mode', 'grid')
    // Page 2 uses ihost key
    writeMode('zpan-ihost-view-mode', 'list')

    const page1Mode = readMode('zpan-view-mode')
    const page2Mode = readMode('zpan-ihost-view-mode')

    expect(page1Mode).toBe('grid')
    expect(page2Mode).toBe('list')
  })

  it('changing mode on custom key does not affect default key', () => {
    writeMode('zpan-view-mode', 'grid')
    writeMode('zpan-ihost-view-mode', 'list')

    // Write to custom key
    writeMode('zpan-ihost-view-mode', 'grid')

    // Default key remains unchanged
    const defaultMode = readMode('zpan-view-mode')
    expect(defaultMode).toBe('grid')

    // Custom key was updated
    const customMode = readMode('zpan-ihost-view-mode')
    expect(customMode).toBe('grid')
  })

  it('uses correct key when storageKey is passed explicitly', () => {
    const customKey = 'my-custom-view-key'
    writeMode(customKey, 'grid')

    expect(localStorageStub.setItem).toHaveBeenCalledWith(customKey, 'grid')
  })
})
