import { DirType } from '@shared/constants'
import { describe, expect, it } from 'vitest'

// ProfilePage is a React rendering component. The project has no jsdom or
// @testing-library/react setup, so we cannot render it here.
// We test the pure logic the component applies:
//   - folder detection from dirtype

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
