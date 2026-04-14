import { DirType } from '@shared/constants'
import { describe, expect, it } from 'vitest'

// ProfilePage is a React rendering component. The project has no jsdom or
// @testing-library/react setup, so we cannot render it here.
// We test the pure logic the component applies:
//   - folder detection from dirtype
//   - folder navigation path construction
//   - breadcrumb path computation per segment index

// ---------------------------------------------------------------------------
// Folder detection — mirrors MatterItem:
//   const isFolder = matter.dirtype !== DirType.FILE
// ---------------------------------------------------------------------------

function isFolder(dirtype: number): boolean {
  return dirtype !== DirType.FILE
}

describe('MatterItem — folder detection', () => {
  it('treats FILE dirtype as not a folder', () => {
    expect(isFolder(DirType.FILE)).toBe(false)
  })

  it('treats USER_FOLDER dirtype as a folder', () => {
    expect(isFolder(DirType.USER_FOLDER)).toBe(true)
  })

  it('treats SYSTEM_FOLDER dirtype as a folder', () => {
    expect(isFolder(DirType.SYSTEM_FOLDER)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Folder navigation path construction — mirrors MatterItem.handleClick:
//   const dir = matter.parent ? `${matter.parent}/${matter.name}` : matter.name
// ---------------------------------------------------------------------------

function buildFolderPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

describe('MatterItem — folder navigation path', () => {
  it('uses name alone when parent is empty', () => {
    expect(buildFolderPath('', 'docs')).toBe('docs')
  })

  it('joins parent and name with slash when parent is set', () => {
    expect(buildFolderPath('projects', 'src')).toBe('projects/src')
  })

  it('handles nested parent path', () => {
    expect(buildFolderPath('projects/src', 'lib')).toBe('projects/src/lib')
  })

  it('handles deeply nested parent path', () => {
    expect(buildFolderPath('a/b/c', 'd')).toBe('a/b/c/d')
  })
})

// ---------------------------------------------------------------------------
// Breadcrumb path computation — mirrors Breadcrumb:
//   const dir = breadcrumb.slice(0, i + 1).join('/')
// ---------------------------------------------------------------------------

function computeBreadcrumbPath(breadcrumb: string[], index: number): string {
  return breadcrumb.slice(0, index + 1).join('/')
}

describe('Breadcrumb — path computation per segment index', () => {
  const breadcrumb = ['projects', 'src', 'lib']

  it('returns first segment alone at index 0', () => {
    expect(computeBreadcrumbPath(breadcrumb, 0)).toBe('projects')
  })

  it('returns first two segments joined at index 1', () => {
    expect(computeBreadcrumbPath(breadcrumb, 1)).toBe('projects/src')
  })

  it('returns full path at last index', () => {
    expect(computeBreadcrumbPath(breadcrumb, 2)).toBe('projects/src/lib')
  })

  it('handles single segment breadcrumb', () => {
    expect(computeBreadcrumbPath(['docs'], 0)).toBe('docs')
  })
})

// ---------------------------------------------------------------------------
// Loading state logic — mirrors ProfilePage:
//   const isLoading = dir ? browseQuery.isPending : false
// ---------------------------------------------------------------------------

function resolveLoadingState(dir: string | undefined, browseIsPending: boolean): boolean {
  return !!dir && browseIsPending
}

describe('ProfilePage — loading state', () => {
  it('not loading when dir is undefined regardless of browse state', () => {
    expect(resolveLoadingState(undefined, true)).toBe(false)
    expect(resolveLoadingState(undefined, false)).toBe(false)
  })

  it('loading when dir is set and browse query is pending', () => {
    expect(resolveLoadingState('docs', true)).toBe(true)
  })

  it('not loading when dir is set but browse query is done', () => {
    expect(resolveLoadingState('docs', false)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Items resolution — mirrors ProfilePage:
//   const items = dir ? browseQuery.data?.items ?? [] : shares
// ---------------------------------------------------------------------------

interface Item {
  id: string
  name: string
}

function resolveItems(dir: string | undefined, browseItems: Item[] | undefined, shares: Item[]): Item[] {
  return dir ? (browseItems ?? []) : shares
}

describe('ProfilePage — items resolution', () => {
  const shares: Item[] = [{ id: '1', name: 'file.txt' }]
  const browseItems: Item[] = [{ id: '2', name: 'subfolder' }]

  it('returns shares when no dir', () => {
    expect(resolveItems(undefined, browseItems, shares)).toBe(shares)
  })

  it('returns browse items when dir is set', () => {
    expect(resolveItems('docs', browseItems, shares)).toBe(browseItems)
  })

  it('returns empty array when dir is set but browse data is undefined', () => {
    expect(resolveItems('docs', undefined, shares)).toEqual([])
  })
})
