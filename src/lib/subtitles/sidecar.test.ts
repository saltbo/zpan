import { describe, expect, it } from 'vitest'
import {
  baseName,
  decodeSubtitleText,
  matchSidecarSubtitle,
  matchSubtitleFile,
  sanitizeSidecarContent,
} from './sidecar'

describe('matchSidecarSubtitle', () => {
  it('matches subtitle files named after the video', () => {
    expect(matchSidecarSubtitle('Movie.2024.mkv', 'Movie.2024.srt')).toEqual({ format: 'srt', tag: '' })
    expect(matchSidecarSubtitle('Movie.2024.mkv', 'movie.2024.CHS.ASS')).toEqual({ format: 'ass', tag: 'CHS' })
    expect(matchSidecarSubtitle('Movie.mp4', 'Movie.zh.forced.vtt')).toEqual({ format: 'vtt', tag: 'zh.forced' })
  })

  it('ignores other videos’ subtitles and non-subtitle files', () => {
    expect(matchSidecarSubtitle('Movie.2024.mkv', 'Movie.2024.Extras.srt')).toEqual({ format: 'srt', tag: 'Extras' })
    expect(matchSidecarSubtitle('Movie.mkv', 'Movie2.srt')).toBeNull()
    expect(matchSidecarSubtitle('Movie.mkv', 'Movie.nfo')).toBeNull()
    expect(matchSidecarSubtitle('Movie.mkv', 'Movie.sub')).toBeNull()
  })
})

describe('matchSubtitleFile', () => {
  it('accepts any subtitle file and keeps its base name as the tag', () => {
    expect(matchSubtitleFile('2_English.SRT')).toEqual({ format: 'srt', tag: '2_English' })
    expect(matchSubtitleFile('Chinese (Simplified).ass')).toEqual({ format: 'ass', tag: 'Chinese (Simplified)' })
    expect(matchSubtitleFile('cover.jpg')).toBeNull()
  })

  it('exposes base names for folder matching', () => {
    expect(baseName('Show.S01E01.mkv')).toBe('Show.S01E01')
  })
})

describe('decodeSubtitleText', () => {
  it('decodes UTF-8 and UTF-16 with byte order marks', () => {
    expect(decodeSubtitleText(new TextEncoder().encode('﻿简体'))).toBe('简体')
    expect(decodeSubtitleText(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e]))).toBe('中')
    expect(decodeSubtitleText(new Uint8Array([0xfe, 0xff, 0x4e, 0x2d]))).toBe('中')
  })

  it('falls back to GB18030 for GBK files', () => {
    // "简体字幕" in GBK.
    expect(decodeSubtitleText(new Uint8Array([0xbc, 0xf2, 0xcc, 0xe5, 0xd7, 0xd6, 0xc4, 0xbb]))).toBe('简体字幕')
  })
})

describe('sanitizeSidecarContent', () => {
  it('neutralizes markup in SRT and WebVTT files while keeping timings and allowed tags', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,000\r\n<v a" onmouseover="x">Hi</v> <i>there</i>\r\n'
    expect(sanitizeSidecarContent('srt', srt)).toBe('1\n00:00:01,000 --> 00:00:02,000\nHi <i>there</i>\n')
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nx --> <c.a" style="y">z</c>'
    expect(sanitizeSidecarContent('vtt', vtt)).toBe('WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nx --> z')
  })

  it('escapes every "<" in ASS files, whose styling never uses tags', () => {
    const ass = 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\i1}<b onclick=x>hi'
    expect(sanitizeSidecarContent('ass', ass)).toBe(
      'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\i1}&lt;b onclick=x>hi',
    )
  })
})
