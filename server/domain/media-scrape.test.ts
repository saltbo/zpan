import type { MediaInfo } from '@shared/schemas'
import { describe, expect, it } from 'vitest'
import {
  episodeSidecars,
  mediaMatchKey,
  movieSidecars,
  type PreviousMediaScrape,
  reusableScrape,
  showFolderOf,
  showSidecars,
} from './media-scrape'

describe('sidecar layout', () => {
  it('names movie, episode, and show sidecars the Kodi way [spec: media-scraping/sidecar-layout]', () => {
    expect(movieSidecars({ parent: 'Movies', name: 'Inception (2010).mkv' })).toEqual({
      nfo: { parent: 'Movies', name: 'Inception (2010).nfo' },
      poster: { parent: 'Movies', name: 'Inception (2010)-poster.jpg' },
      fanart: { parent: 'Movies', name: 'Inception (2010)-fanart.jpg' },
    })
    expect(episodeSidecars({ parent: 'TV/Show/Season 1', name: 'Show.S01E02.1080p.mkv' })).toEqual({
      nfo: { parent: 'TV/Show/Season 1', name: 'Show.S01E02.1080p.nfo' },
      thumb: { parent: 'TV/Show/Season 1', name: 'Show.S01E02.1080p-thumb.jpg' },
    })
    expect(showSidecars('TV/Show', 0)).toEqual({
      nfo: { parent: 'TV/Show', name: 'tvshow.nfo' },
      poster: { parent: 'TV/Show', name: 'poster.jpg' },
      fanart: { parent: 'TV/Show', name: 'fanart.jpg' },
      seasonPoster: { parent: 'TV/Show', name: 'season00-poster.jpg' },
    })
    expect(showSidecars('TV/Show', 12).seasonPoster.name).toBe('season12-poster.jpg')
  })
})

describe('showFolderOf', () => {
  it.each<[string, string, string, string | null]>([
    ['TV/Breaking Bad/Season 1', 'TV', 'Breaking Bad', 'TV/Breaking Bad'],
    ['TV/Breaking Bad (2008)/S01', 'TV', 'Breaking Bad', 'TV/Breaking Bad (2008)'],
    ['TV/庆余年/第1季', 'TV', '庆余年', 'TV/庆余年'],
    ['TV/Doctor Who/Specials', 'TV', 'Doctor Who', 'TV/Doctor Who'],
    ['TV/The Office (US)', 'TV', 'The Office US', 'TV/The Office (US)'],
    ['Breaking Bad/Season 2', 'Breaking Bad', 'Breaking Bad', 'Breaking Bad'],
    ['Breaking Bad', 'Breaking Bad', 'Breaking Bad', 'Breaking Bad'],
    ['TV', 'TV', 'Breaking Bad', null],
    ['TV/Season 1', 'TV/Season 1', 'Breaking Bad', null],
    ['TV/Downloads/Season 1', 'TV', 'Breaking Bad', null],
  ])('resolves the show folder of an episode in %s [spec: media-scraping/sidecar-layout]', (folder, root, title, show) => {
    expect(showFolderOf(folder, root, title)).toBe(show)
  })
})

describe('reusableScrape', () => {
  const movie: MediaInfo = { type: 'movie', title: 'Inception', year: 2010 }
  const matched: PreviousMediaScrape = {
    result: { status: 'matched', source: 'search', match: { type: 'movie', id: 27205 } },
    matchKey: mediaMatchKey(movie),
    language: 'en-US',
  }
  const unmatched: PreviousMediaScrape = {
    result: { status: 'unmatched', source: 'search' },
    matchKey: mediaMatchKey(movie),
    language: 'en-US',
  }

  it('ignores cosmetic title changes in the match key [spec: media-scraping/reuse-previous]', () => {
    expect(mediaMatchKey({ type: 'movie', title: 'inception', year: 2010 })).toBe(mediaMatchKey(movie))
    expect(mediaMatchKey({ type: 'movie', title: 'Inception', year: 2011 })).not.toBe(mediaMatchKey(movie))
    expect(mediaMatchKey({ type: 'episode', title: 'Show', season: 1, episode: 2 })).toBe(
      mediaMatchKey({ type: 'episode', title: 'Show', season: 3, episode: 4 }),
    )
  })

  it.each<[string, PreviousMediaScrape | null, { matchKey: string; language: string }, boolean]>([
    ['no earlier scrape', null, { matchKey: matched.matchKey, language: 'en-US' }, false],
    ['a match with the same parsed title', matched, { matchKey: matched.matchKey, language: 'en-US' }, true],
    ['a match in another language', matched, { matchKey: matched.matchKey, language: 'zh-CN' }, true],
    ['a match for another parsed title', matched, { matchKey: 'movie:interstellar:2014', language: 'en-US' }, false],
    ['no match in the same language', unmatched, { matchKey: unmatched.matchKey, language: 'en-US' }, true],
    ['no match in another language', unmatched, { matchKey: unmatched.matchKey, language: 'zh-CN' }, false],
  ])('reuses %s: %s [spec: media-scraping/reuse-previous]', (_label, previous, current, reused) => {
    expect(reusableScrape(previous, current)).toBe(reused ? previous?.result : null)
  })
})
