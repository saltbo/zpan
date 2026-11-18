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

  it.each<[string, string, string, boolean]>([
    ['rejects another sequel number', 'Toy Story 2', 'Toy Story 3', false],
    ['rejects the first film for a sequel', 'Toy Story 2', 'Toy Story', false],
    ['rejects a sequel for the first film', 'Toy Story', 'Toy Story 2', false],
    ['rejects another roman numeral', 'Rocky II', 'Rocky III', false],
    ['rejects another CJK sequel number', '唐人街探案2', '唐人街探案3', false],
    ['rejects another full-width sequel number', '唐人街探案２', '唐人街探案3', false],
    [
      'rejects another part',
      'Harry Potter and the Deathly Hallows Part 1',
      'Harry Potter and the Deathly Hallows: Part 2',
      false,
    ],
    ['accepts the same sequel number', 'Toy Story 3', 'Toy Story 3', true],
    ['accepts the same roman numeral', 'Rocky II', 'Rocky II', true],
    ['accepts the same CJK sequel number', '唐人街探案2', '唐人街探案２', true],
    ['accepts the same number inside the title', 'Blade Runner 2049', 'Blade Runner 2049', true],
  ])('%s [spec: media-scraping/match-titles]', (_label, title, candidate, matches) => {
    expect(chooseTmdbMatch({ title }, [hit(1, candidate, null)])?.id ?? null).toBe(matches ? 1 : null)
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
