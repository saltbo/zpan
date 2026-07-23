import { describe, expect, it } from 'vitest'
import { parseNfo } from './nfo'

describe('parseNfo', () => {
  it('parses Kodi movie XML into sections', () => {
    expect(
      parseNfo(`
        <movie>
          <title>Arrival</title>
          <year>2016</year>
          <genre>Science Fiction</genre>
          <genre>Drama</genre>
          <ratings>
            <rating name="imdb"><value>7.9</value></rating>
          </ratings>
          <actor><name>Amy Adams</name><role>Louise Banks</role></actor>
          <actor><name>Jeremy Renner</name><role>Ian Donnelly</role></actor>
        </movie>
      `),
    ).toEqual({
      format: 'xml',
      root: 'movie',
      sections: [
        {
          name: 'movie',
          fields: [
            { name: 'title', values: ['Arrival'] },
            { name: 'year', values: ['2016'] },
            { name: 'genre', values: ['Science Fiction', 'Drama'] },
          ],
        },
        {
          name: 'ratings',
          fields: [{ name: 'rating (imdb) › value', values: ['7.9'] }],
        },
        {
          name: 'actor',
          fields: [
            { name: 'name', values: ['Amy Adams', 'Jeremy Renner'] },
            { name: 'role', values: ['Louise Banks', 'Ian Donnelly'] },
          ],
        },
      ],
    })
  })

  it('parses episode XML without requiring a movie root', () => {
    const document = parseNfo(`
      <episodedetails>
        <title>Sol Regem</title>
        <season>3</season>
        <episode>1</episode>
      </episodedetails>
    `)

    expect(document).toMatchObject({
      format: 'xml',
      root: 'episodedetails',
      sections: [
        {
          fields: [
            { name: 'title', values: ['Sol Regem'] },
            { name: 'season', values: ['3'] },
            { name: 'episode', values: ['1'] },
          ],
        },
      ],
    })
  })

  it('parses MediaInfo text reports', () => {
    expect(
      parseNfo(`General
Complete name                            : Zootopia.mp4
Duration                                 : 1 h 48 min

Video
Format                                   : AVC
Width                                    : 1 920 pixels

Audio
Format                                   : AAC
Channel(s)                               : 2 channels
`),
    ).toEqual({
      format: 'mediainfo',
      sections: [
        {
          name: 'General',
          fields: [
            { name: 'Complete name', values: ['Zootopia.mp4'] },
            { name: 'Duration', values: ['1 h 48 min'] },
          ],
        },
        {
          name: 'Video',
          fields: [
            { name: 'Format', values: ['AVC'] },
            { name: 'Width', values: ['1 920 pixels'] },
          ],
        },
        {
          name: 'Audio',
          fields: [
            { name: 'Format', values: ['AAC'] },
            { name: 'Channel(s)', values: ['2 channels'] },
          ],
        },
      ],
    })
  })

  it('preserves unsupported and malformed NFO content as plain text', () => {
    expect(parseNfo('Release notes')).toEqual({ format: 'text', content: 'Release notes' })
    expect(parseNfo('<movie><title>Broken</movie>')).toEqual({
      format: 'text',
      content: '<movie><title>Broken</movie>',
    })
  })
})
