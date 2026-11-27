import { describe, expect, it } from 'vitest'
import { layoutProblem, sidecarsOf, stem } from './layout'

const files = [{ fileIdx: 0 }, { fileIdx: 2 }]
const sidecars = new Map([[0, {}]])

describe('layoutProblem', () => {
  it('accepts a layout of real files and uploaded sidecars', () => {
    expect(
      layoutProblem(
        {
          version: 1,
          entries: [
            { kind: 'folder', path: 'Movie (2001)' },
            {
              kind: 'torrent-file',
              path: 'Movie (2001)/Movie.mkv',
              fileIdx: 0,
              media: {
                kind: 'movie',
                tmdb: { id: 1, type: 'movie' },
                title: 'Movie',
                poster: 'Movie (2001)/Movie-poster.jpg',
              },
            },
            { kind: 'sidecar', path: 'Movie (2001)/Movie-poster.jpg', sidecar: 0, video: 'Movie (2001)/Movie.mkv' },
          ],
        },
        files,
        sidecars,
      ),
    ).toBeNull()
  })

  it('names what makes a layout unusable', () => {
    expect(
      layoutProblem({ version: 1, entries: [{ kind: 'sidecar', path: 'a.nfo', sidecar: 4 }] }, files, sidecars),
    ).toMatch(/not uploaded/)
    expect(
      layoutProblem(
        {
          version: 1,
          entries: [
            { kind: 'sidecar', path: 'a.nfo', sidecar: 0 },
            { kind: 'sidecar', path: 'b.nfo', sidecar: 0 },
          ],
        },
        files,
        sidecars,
      ),
    ).toMatch(/appears twice/)
  })
})

describe('layout helpers', () => {
  it('reads sidecar numbers and file stems', () => {
    const extra = { torrentId: 't', size: 1, storageId: 's', objectKey: 'k', uploadedAt: new Date() }
    expect([
      ...sidecarsOf([
        { ...extra, name: 'x/3' },
        { ...extra, name: 'layout.json' },
      ]).keys(),
    ]).toEqual([3])
    expect(stem('Show.S01E01.mkv')).toBe('Show.S01E01')
    expect(stem('.hidden')).toBe('.hidden')
  })
})
