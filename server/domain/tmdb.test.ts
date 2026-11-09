import { describe, expect, it } from 'vitest'
import {
  chooseImage,
  chooseTmdbMatch,
  fanartPreference,
  normalizeTitle,
  posterPreference,
  type TmdbSearchHit,
  titleSimilarity,
} from './tmdb'

function hit(id: number, title: string, year: number | null, originalTitle = title): TmdbSearchHit {
  return { id, title, originalTitle, year }
}

describe('normalizeTitle', () => {
  it.each([
    ['The Matrix', 'matrix'],
    ['Spider-Man: No Way Home', 'spidermannowayhome'],
    ['Amélie', 'amelie'],
    ['Fast & Furious', 'fastandfurious'],
    ['A Quiet Place', 'quietplace'],
    ['流浪地球2', '流浪地球2'],
    ['ＷＡＬＬ·Ｅ', 'walle'],
  ])('normalizes %s [spec: media-scraping/match-titles]', (title, normalized) => {
    expect(normalizeTitle(title)).toBe(normalized)
  })
})

describe('titleSimilarity', () => {
  it('is 1 for titles equal after normalization and 0 for unrelated ones [spec: media-scraping/match-titles]', () => {
    expect(titleSimilarity('the.matrix', 'The Matrix')).toBe(1)
    expect(titleSimilarity('Inception', 'Interstellar')).toBeLessThan(0.5)
    expect(titleSimilarity('', 'Inception')).toBe(0)
    expect(titleSimilarity('权力的游戏', '权力的游戏')).toBe(1)
  })
})

describe('chooseTmdbMatch', () => {
  it.each<[string, { title: string; year?: number }, TmdbSearchHit[], number | null]>([
    ['an exact title and year', { title: 'Inception', year: 2010 }, [hit(1, 'Inception', 2010)], 1],
    [
      'the original title when the localized one differs',
      { title: 'Inception', year: 2010 },
      [hit(2, '盗梦空间', 2010, 'Inception')],
      2,
    ],
    ['a year one off', { title: 'Inception', year: 2011 }, [hit(3, 'Inception', 2010)], 3],
    ['no result more than a year off', { title: 'Dune', year: 2021 }, [hit(4, 'Dune', 1984)], null],
    [
      'the closest year among equal titles',
      { title: 'Dune', year: 2021 },
      [hit(5, 'Dune', 2020), hit(6, 'Dune', 2021)],
      6,
    ],
    ["TMDB's order when nothing else separates", { title: 'Dune' }, [hit(7, 'Dune', 1984), hit(8, 'Dune', 2021)], 7],
    ['a result with an unknown year', { title: 'Untitled Project', year: 2030 }, [hit(9, 'Untitled Project', null)], 9],
    ['nothing for a dissimilar title', { title: 'Home Video' }, [hit(10, 'Home Alone', 1990)], null],
    ['nothing for no results', { title: 'Inception', year: 2010 }, [], null],
    [
      'the more similar title over the first result',
      { title: 'The Office US' },
      [hit(11, 'The Office', 2001), hit(12, 'The Office (US)', 2005)],
      12,
    ],
  ])('matches %s [spec: media-scraping/match-titles]', (_label, query, hits, id) => {
    expect(chooseTmdbMatch(query, hits)?.id ?? null).toBe(id)
  })
})

describe('chooseImage', () => {
  const images = [
    { path: '/en.jpg', language: 'en' },
    { path: '/textless.jpg', language: null },
    { path: '/zh.jpg', language: 'zh' },
  ]

  it('prefers the configured language for posters and textless art for fanart [spec: media-scraping/match-titles]', () => {
    expect(chooseImage(images, posterPreference('zh-CN'))).toBe('/zh.jpg')
    expect(chooseImage(images, fanartPreference('zh-CN'))).toBe('/textless.jpg')
    expect(chooseImage(images.slice(0, 1), posterPreference('ja-JP'))).toBe('/en.jpg')
    expect(chooseImage([{ path: '/fr.jpg', language: 'fr' }], posterPreference('ja-JP'))).toBeNull()
  })
})
