import type { MediaMetadata } from '@shared/schemas'
import { describe, expect, it } from 'vitest'
import { hasMediaImages, metadataWithoutImages, remapMediaImages } from './media-metadata'

const movie: MediaMetadata = {
  kind: 'movie',
  tmdb: { id: 27205, type: 'movie' },
  title: 'Inception',
  poster: 'p1',
  fanart: 'f1',
}

describe('remapMediaImages', () => {
  it('rewrites resolved image ids and drops unresolved ones', () => {
    const ids = new Map([['p1', 'p2']])
    expect(remapMediaImages(movie, (id) => ids.get(id))).toEqual({
      kind: 'movie',
      tmdb: { id: 27205, type: 'movie' },
      title: 'Inception',
      poster: 'p2',
    })
  })

  it('remaps an episode still', () => {
    const episode: MediaMetadata = { kind: 'episode', tmdb: { id: 1, type: 'tv' }, season: 1, episode: 2, still: 's1' }
    expect(remapMediaImages(episode, () => 's2')).toEqual({ ...episode, still: 's2' })
  })
})

describe('metadataWithoutImages', () => {
  it('keeps everything but the image references', () => {
    expect(metadataWithoutImages({ media: movie })).toEqual({
      media: { kind: 'movie', tmdb: { id: 27205, type: 'movie' }, title: 'Inception' },
    })
    expect(metadataWithoutImages({})).toEqual({})
    expect(metadataWithoutImages(null)).toBeNull()
  })
})

describe('hasMediaImages', () => {
  it('tells whether the media references any image', () => {
    expect(hasMediaImages(movie)).toBe(true)
    expect(hasMediaImages({ kind: 'tvshow', tmdb: { id: 1, type: 'tv' }, title: 'Show' })).toBe(false)
  })
})
