import { describe, expect, it } from 'vitest'
import { episodeNfo, movieNfo, readNfoIdentity, tvShowNfo } from './media-nfo'
import type { TmdbMovie } from './tmdb'

const movie: TmdbMovie = {
  id: 27205,
  title: 'Tom & Jerry\'s "<Best>"',
  originalTitle: '盗梦空间',
  overview: 'A thief\u0007 who steals secrets.',
  date: '2010-07-15',
  genres: ['Action', '科幻'],
  runtime: 148,
  posterPath: null,
  backdropPath: null,
  posters: [],
  backdrops: [],
}

describe('movieNfo', () => {
  it('renders an escaped Kodi movie document [spec: media-scraping/nfo-files]', () => {
    expect(movieNfo(movie)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<movie>',
        '  <title>Tom &amp; Jerry&apos;s &quot;&lt;Best&gt;&quot;</title>',
        '  <originaltitle>盗梦空间</originaltitle>',
        '  <year>2010</year>',
        '  <plot>A thief who steals secrets.</plot>',
        '  <premiered>2010-07-15</premiered>',
        '  <genre>Action</genre>',
        '  <genre>科幻</genre>',
        '  <runtime>148</runtime>',
        '  <uniqueid type="tmdb" default="true">27205</uniqueid>',
        '</movie>',
        '',
      ].join('\n'),
    )
  })

  it('leaves out fields TMDB does not have [spec: media-scraping/nfo-files]', () => {
    const text = movieNfo({ ...movie, overview: '', date: null, runtime: null, genres: [] })
    expect(text).not.toMatch(/<plot>|<year>|<premiered>|<runtime>|<genre>/)
    expect(text).toContain('<uniqueid type="tmdb" default="true">27205</uniqueid>')
  })
})

describe('tvShowNfo and episodeNfo', () => {
  it('render the show and the episode with their own TMDB ids [spec: media-scraping/nfo-files]', () => {
    const show = tvShowNfo({ ...movie, id: 1399, title: '权力的游戏', originalTitle: 'Game of Thrones' })
    expect(show).toContain('<tvshow>\n  <title>权力的游戏</title>\n  <originaltitle>Game of Thrones</originaltitle>')
    expect(show).toContain('<uniqueid type="tmdb" default="true">1399</uniqueid>\n</tvshow>')
    expect(show).not.toContain('<runtime>')

    const episode = episodeNfo({
      id: 63056,
      season: 1,
      episode: 2,
      title: 'The Kingsroad',
      overview: '',
      airDate: '2011-04-24',
      stillPath: null,
    })
    expect(episode).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<episodedetails>',
        '  <title>The Kingsroad</title>',
        '  <season>1</season>',
        '  <episode>2</episode>',
        '  <aired>2011-04-24</aired>',
        '  <uniqueid type="tmdb">63056</uniqueid>',
        '</episodedetails>',
        '',
      ].join('\n'),
    )
  })
})

describe('readNfoIdentity', () => {
  it.each([
    ['our own movie file', movieNfo(movie), { kind: 'movie', tmdbId: 27205 }],
    [
      'a uniqueid with attributes in another order',
      "﻿<?xml version='1.0'?>\n<!-- edited -->\n<tvshow><uniqueid default='true' type='tmdb'> 1399 </uniqueid></tvshow>",
      { kind: 'tvshow', tmdbId: 1399 },
    ],
    [
      'a tmdbid element after other ids',
      '<movie><uniqueid type="imdb">tt1375666</uniqueid><tmdbid>27205</tmdbid></movie>',
      { kind: 'movie', tmdbId: 27205 },
    ],
    [
      'an episode file',
      '<episodedetails><uniqueid type="tmdb">63056</uniqueid></episodedetails>',
      { kind: 'episodedetails', tmdbId: 63056 },
    ],
    [
      'a file without a TMDB id',
      '<movie><uniqueid type="imdb">tt1375666</uniqueid></movie>',
      { kind: 'movie', tmdbId: null },
    ],
    ['text that is not an nfo', 'https://www.themoviedb.org/movie/27205', { kind: null, tmdbId: null }],
    ['malformed XML', '<movie><title>Unclosed<uniqueid type="tmdb">27205</uniqueid>', { kind: 'movie', tmdbId: 27205 }],
  ])('reads %s [spec: media-scraping/nfo-files]', (_label, text, identity) => {
    expect(readNfoIdentity(text)).toEqual(identity)
  })
})
