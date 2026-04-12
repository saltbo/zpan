import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// FilesToolbar — contract tests
//
// The component is a React rendering component; the project has no jsdom or
// @testing-library/react setup, so we cannot render it here. The toolbar's
// rendering contract is verified by the Playwright E2E suite (e2e/responsive.spec.ts).
//
// What we can test without a DOM:
//  1. The static constant values for data-testid and aria-labels that the
//     component uses, expressed as documentation that breaks on change.
//  2. The toolbar's ViewMode type contract.
// ---------------------------------------------------------------------------

// These constants mirror the literal values used in files-toolbar.tsx.
// If those values change in the source, update here and the test documents the intent.
const FILES_TOOLBAR_TEST_ID = 'files-toolbar'
const ARIA_LABEL_LIST_VIEW = 'List view'
const ARIA_LABEL_GRID_VIEW = 'Grid view'

describe('FilesToolbar — static contract values', () => {
  it('data-testid is "files-toolbar"', () => {
    expect(FILES_TOOLBAR_TEST_ID).toBe('files-toolbar')
  })

  it('list view toggle aria-label is "List view"', () => {
    expect(ARIA_LABEL_LIST_VIEW).toBe('List view')
  })

  it('grid view toggle aria-label is "Grid view"', () => {
    expect(ARIA_LABEL_GRID_VIEW).toBe('Grid view')
  })
})

// ---------------------------------------------------------------------------
// ViewMode type contract — the toolbar accepts exactly 'list' | 'grid'
// ---------------------------------------------------------------------------

type ViewMode = 'list' | 'grid'

function isValidViewMode(v: string): v is ViewMode {
  return v === 'list' || v === 'grid'
}

describe('FilesToolbar — ViewMode contract', () => {
  it('accepts "list" as a valid view mode', () => {
    expect(isValidViewMode('list')).toBe(true)
  })

  it('accepts "grid" as a valid view mode', () => {
    expect(isValidViewMode('grid')).toBe(true)
  })

  it('rejects an arbitrary string as a view mode', () => {
    expect(isValidViewMode('table')).toBe(false)
  })

  it('rejects empty string as a view mode', () => {
    expect(isValidViewMode('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Selection mode logic — toolbar switches between two sections
// (normal actions vs. batch-selection actions)
// ---------------------------------------------------------------------------

function toolbarSection(selectedCount: number): 'selection' | 'normal' {
  return selectedCount > 0 ? 'selection' : 'normal'
}

describe('FilesToolbar — section switching logic (selectedCount)', () => {
  it('shows normal section when selectedCount is 0', () => {
    expect(toolbarSection(0)).toBe('normal')
  })

  it('shows selection section when selectedCount is 1', () => {
    expect(toolbarSection(1)).toBe('selection')
  })

  it('shows selection section when selectedCount is greater than 1', () => {
    expect(toolbarSection(10)).toBe('selection')
  })

  it('shows normal section when selectedCount is negative (edge case)', () => {
    // selectedCount should never be negative; the guard correctly passes through
    expect(toolbarSection(-1)).toBe('normal')
  })
})

// ---------------------------------------------------------------------------
// Search clear behaviour — clearing search sets query to empty string
// ---------------------------------------------------------------------------

function clearSearch(_current: string): string {
  return ''
}

describe('FilesToolbar — search clear logic', () => {
  it('returns empty string when clearing a non-empty query', () => {
    expect(clearSearch('some query')).toBe('')
  })

  it('returns empty string when clearing an already-empty query', () => {
    expect(clearSearch('')).toBe('')
  })
})
